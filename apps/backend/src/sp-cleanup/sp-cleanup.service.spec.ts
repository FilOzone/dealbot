import { Logger } from "@nestjs/common";
import { ContractFunctionRevertedError } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trickleTierRates } from "../config/constants.js";
import type { INetworkConfig } from "../config/index.js";
import type { StorageProviderRepository } from "../providers/repositories/storage-provider.repository.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { SpCleanupService } from "./sp-cleanup.service.js";

vi.mock("../data-set-lifecycle/data-set-lifecycle.service.js", () => ({
  terminateServiceSync: vi.fn(),
}));

vi.mock("@filoz/synapse-core/pay", () => ({
  getRail: vi.fn(),
  settleRail: vi.fn(),
  settleTerminatedRailWithoutValidationCall: vi.fn(),
}));

vi.mock("@filoz/synapse-core/chains", () => ({
  asChain: vi.fn(),
}));

vi.mock("@filoz/synapse-core/utils", () => ({
  toReadClient: vi.fn((client: unknown) => client),
}));

// Only the network calls are stubbed. `findMatchingDataSets` and `metadataMatches` stay real:
// pruning delegates slot resolution to them, so exercising the SDK's own matcher is the point.
vi.mock("@filoz/synapse-core/warm-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@filoz/synapse-core/warm-storage")>()),
  getDataSet: vi.fn(),
  getPdpDataSets: vi.fn(),
}));

vi.mock("viem/actions", () => ({
  getBlockNumber: vi.fn(),
  multicall: vi.fn(),
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    encodeFunctionData: vi.fn(() => "0xcalldata"),
    keccak256: vi.fn(() => "0xchecksum"),
    stringToBytes: vi.fn(() => new Uint8Array()),
  };
});

vi.mock("../common/synapse-factory.js", () => ({
  createSynapseFromConfig: vi.fn(),
}));

const { terminateServiceSync } = await import("../data-set-lifecycle/data-set-lifecycle.service.js");
const { settleRail, settleTerminatedRailWithoutValidationCall } = await import("@filoz/synapse-core/pay");
const { asChain } = await import("@filoz/synapse-core/chains");
const { getDataSet, getPdpDataSets } = await import("@filoz/synapse-core/warm-storage");
const { getBlockNumber, multicall, readContract, simulateContract, writeContract, waitForTransactionReceipt } =
  await import("viem/actions");

const DEFAULT_NETWORK = "calibration";

function makeNetworkConfig(overrides: Partial<INetworkConfig> = {}): INetworkConfig {
  return {
    network: DEFAULT_NETWORK,
    walletAddress: "0xWaLLet000000000000000000000000000000000",
    walletPrivateKey: "0xkey",
    blockedSpIds: new Set<string>(),
    blockedSpAddresses: new Set<string>(),
    fullRateSpIds: new Set<string>(),
    fullRateSpAddresses: new Set<string>(),
    useOnlyApprovedProviders: false,
    minNumDataSetsForChecks: 15,
    excessDataSetBuffer: 5,
    dataSetLifecycleCheckJobTimeoutSeconds: 600,
    ...overrides,
  } as unknown as INetworkConfig;
}

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    serviceProvider: "0xsp0000000000000000000000000000000000001",
    payee: "0xpayee",
    name: "Test SP",
    isApproved: false,
    pdp: { serviceURL: "https://sp.example.com" },
    ...overrides,
  };
}

/**
 * The metadata a slot's data set actually carries on-chain. Verified against mainnet, where
 * every one of dealbot's 236 data sets has exactly `{source, withIPFSIndexing}` or
 * `{source, withIPFSIndexing, dealbotDS}`.
 *
 * `source` is added by the SDK, not by our callers, so a fixture that omits it would let these
 * tests pass against a reconstruction that matches nothing in production.
 */
function slotMeta(index: number): Record<string, string> {
  return {
    source: "dealbot",
    withIPFSIndexing: "",
    ...(index > 0 ? { dealbotDS: String(index) } : {}),
  };
}

/** `getPdpDataSets` resolves each data set's provider from the SP registry on-chain. */
function makeProviderFor(address: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    serviceProvider: address,
    name: "Test SP",
    pdp: { serviceURL: "https://sp.example.com" },
    ...overrides,
  };
}

function makeDataSet(overrides: Record<string, unknown> = {}) {
  const serviceProvider = (overrides.serviceProvider as string) ?? "0xsp0000000000000000000000000000000000001";
  return {
    dataSetId: 1n,
    serviceProvider,
    provider: makeProviderFor(serviceProvider, (overrides.providerOverrides as Record<string, unknown>) ?? {}),
    pdpEndEpoch: 0n,
    pdpRailId: 100n,
    providerId: 1n,
    // The SDK's matcher only considers sets that are live in PDPVerifier and listened to by FWSS.
    live: true,
    managed: true,
    metadata: slotMeta(0),
    activePieceCount: 0n,
    ...overrides,
  };
}

/**
 * Stands in for the sweep's Multicall3 read batches. Values are matched by `functionName`;
 * an array supplies one value per data set, a scalar applies to all, and an `Error` value
 * becomes a per-item revert (`status: "failure"`), which is how a finalized rail reports.
 */
function mockBatchedReads(values: Record<string, unknown>) {
  const queues = new Map<string, unknown[]>();
  for (const [fn, value] of Object.entries(values)) {
    queues.set(fn, Array.isArray(value) ? [...value] : [value]);
  }
  vi.mocked(multicall).mockImplementation((async (_client: unknown, opts: any) =>
    opts.contracts.map((call: any) => {
      const queue = queues.get(call.functionName);
      const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      return next instanceof Error ? { status: "failure", error: next } : { status: "success", result: next };
    })) as never);
}

const fakeChain = {
  id: 314159,
  contracts: {
    pdp: { address: "0xpdpverifier", abi: [] },
    filecoinPay: { address: "0xfilecoinpay", abi: [] },
  },
};

describe("SpCleanupService", () => {
  let service: SpCleanupService;
  let configService: { get: ReturnType<typeof vi.fn> };
  let walletSdkService: {
    tryGetSynapse: ReturnType<typeof vi.fn>;
    tryGetSynapseClient: ReturnType<typeof vi.fn>;
  };
  let storageProviderRepository: {
    findAllByNetwork: ReturnType<typeof vi.fn>;
    findActiveAddresses: ReturnType<typeof vi.fn>;
    findByAddress: ReturnType<typeof vi.fn>;
  };
  let attemptsCounter: { inc: ReturnType<typeof vi.fn> };
  let stuckGauge: { set: ReturnType<typeof vi.fn> };
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const networkConfig = makeNetworkConfig();
    configService = {
      get: vi.fn((key: string) => {
        if (key === "networks") return { [DEFAULT_NETWORK]: networkConfig };
        return undefined;
      }),
    };

    walletSdkService = {
      tryGetSynapse: vi.fn(() => ({ client: { chain: fakeChain }, sessionClient: undefined })),
      tryGetSynapseClient: vi.fn(() => ({ chain: fakeChain, account: { address: "0xsession" } })),
    };

    storageProviderRepository = {
      findAllByNetwork: vi.fn(async () => []),
      findActiveAddresses: vi.fn(async () => []),
      findByAddress: vi.fn(async () => undefined),
    };

    attemptsCounter = { inc: vi.fn() };
    stuckGauge = { set: vi.fn() };

    service = new SpCleanupService(
      configService as unknown as ConstructorParameters<typeof SpCleanupService>[0],
      walletSdkService as unknown as WalletSdkService,
      storageProviderRepository as unknown as StorageProviderRepository,
      attemptsCounter as unknown as ConstructorParameters<typeof SpCleanupService>[3],
      stuckGauge as unknown as ConstructorParameters<typeof SpCleanupService>[4],
    );

    vi.mocked(asChain).mockReturnValue(fakeChain as any);
    vi.mocked(terminateServiceSync).mockResolvedValue({} as any);
    // Pruning re-reads each planned data set right before terminating it; by default it is
    // still active, so the plan is carried out as computed.
    vi.mocked(getDataSet).mockResolvedValue({ pdpEndEpoch: 0n } as any);
    mockBatchedReads({ getDataSetLastProvenEpoch: 0n, getRail: { settledUpTo: 100n, endEpoch: 500n } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runDataSetPruning (Job A)", () => {
    it("terminates every active data set for a blocked SP down to 0", async () => {
      const networkConfig = makeNetworkConfig({
        blockedSpAddresses: new Set(["0xsp0000000000000000000000000000000000001"]),
      });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );

      const blockedProvider = makeProvider();
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([blockedProvider]);

      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 5n }),
        makeDataSet({ dataSetId: 6n }),
      ] as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      expect(terminateServiceSync).toHaveBeenCalledTimes(2);
      expect(terminateServiceSync).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dataSetId: 5n }));
      expect(terminateServiceSync).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dataSetId: 6n }));
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "success",
        reason: "blocked",
      });
      expect(attemptsCounter.inc).toHaveBeenCalledTimes(2);
    });

    it("prunes a trickle-tier SP down to trickleTierRates.minNumDataSetsForChecks", async () => {
      const trickleAddress = "0xtrickle000000000000000000000000000000001";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 2n, serviceProvider: trickleAddress, name: "Trickle SP", isApproved: false }),
      ]);

      // trickle target=1 -> one baseline slot survives; buffer=5 (default fixture) means the
      // remaining 7 surplus copies have to exceed 5 before anything is pruned.
      const dataSets = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n].map((id) =>
        makeDataSet({ dataSetId: id, serviceProvider: trickleAddress, metadata: slotMeta(0) }),
      );
      vi.mocked(getPdpDataSets).mockResolvedValueOnce(dataSets as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      // One set per required slot survives; every other copy is surplus.
      const expectedTerminated = dataSets.length - trickleTierRates.minNumDataSetsForChecks;
      expect(terminateServiceSync).toHaveBeenCalledTimes(expectedTerminated);
      // The SDK resolves this slot to the lowest data-set id, so that is the one kept.
      expect(terminateServiceSync).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ dataSetId: 1n }),
      );
      expect(attemptsCounter.inc).toHaveBeenCalledTimes(expectedTerminated);
      for (const call of vi.mocked(attemptsCounter.inc).mock.calls) {
        expect(call[0]).toMatchObject({ reason: "trickle" });
      }
    });

    it("terminates a leaked lifecycle-check data set and keeps the real slot, even though the leak is newer", async () => {
      const networkConfig = makeNetworkConfig({ excessDataSetBuffer: 0 });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );
      const trickleAddress = "0xtrickle000000000000000000000000000000002";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 6n, serviceProvider: trickleAddress, isApproved: false }),
      ]);

      // Naive newest-first retention would keep the leaked set (id 10) and terminate the
      // baseline slot (id 5) — exactly backwards.
      const realSlot = makeDataSet({ dataSetId: 5n, serviceProvider: trickleAddress, metadata: slotMeta(0) });
      const leakedSet = makeDataSet({
        dataSetId: 10n,
        serviceProvider: trickleAddress,
        // Tagged long enough ago that no lifecycle-check job could still be using it.
        metadata: { dealbotLifecycleCheck: "1234567890" },
      });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([realSlot, leakedSet] as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      expect(terminateServiceSync).toHaveBeenCalledTimes(1);
      expect(terminateServiceSync).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dataSetId: 10n }));
    });

    it("spares a lifecycle-check data set young enough that its job could still be running", async () => {
      const networkConfig = makeNetworkConfig({ excessDataSetBuffer: 0, dataSetLifecycleCheckJobTimeoutSeconds: 600 });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );
      const trickleAddress = "0xtrickle000000000000000000000000000000003";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 7n, serviceProvider: trickleAddress, isApproved: false }),
      ]);

      // Pruning shares no per-provider lock with SP_WORK_QUEUE, so a set tagged one minute ago
      // may belong to a lifecycle check running right now. It is left for the next run.
      const realSlot = makeDataSet({ dataSetId: 5n, serviceProvider: trickleAddress, metadata: slotMeta(0) });
      const inFlight = makeDataSet({
        dataSetId: 11n,
        serviceProvider: trickleAddress,
        metadata: { dealbotLifecycleCheck: String(Date.now() - 60_000) },
      });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([realSlot, inFlight] as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      expect(terminateServiceSync).not.toHaveBeenCalled();
    });

    it("leaves a full-rate SP within its target untouched", async () => {
      const fullRateAddress = "0xfullrate00000000000000000000000000000001";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 3n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 99n, serviceProvider: fullRateAddress }),
      ] as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      expect(getPdpDataSets).toHaveBeenCalledTimes(1);
      expect(getPdpDataSets).toHaveBeenCalledWith(expect.anything(), {
        address: "0xWaLLet000000000000000000000000000000000",
      });
      expect(terminateServiceSync).not.toHaveBeenCalled();
    });

    it("leaves a full-rate SP alone while its surplus is still within the excess buffer", async () => {
      // target=15 (default fixture): 15 slots claim one set each, leaving 4 surplus <= buffer 5.
      const fullRateAddress = "0xfullrate00000000000000000000000000000002";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 4n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      const slots = Array.from({ length: 15 }, (_, i) =>
        makeDataSet({ dataSetId: BigInt(i + 1), serviceProvider: fullRateAddress, metadata: slotMeta(i) }),
      );
      const surplus = Array.from({ length: 4 }, (_, i) =>
        makeDataSet({ dataSetId: BigInt(100 + i), serviceProvider: fullRateAddress, metadata: slotMeta(1) }),
      );
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([...slots, ...surplus] as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      expect(terminateServiceSync).not.toHaveBeenCalled();
    });

    it("prunes a full-rate SP's surplus once it exceeds the buffer — safety net independent of root cause", async () => {
      // target=15, buffer=5: 15 slots survive, and the 6 duplicate copies exceed the buffer.
      const fullRateAddress = "0xfullrate00000000000000000000000000000003";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 5n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      const slots = Array.from({ length: 15 }, (_, i) =>
        makeDataSet({ dataSetId: BigInt(i + 1), serviceProvider: fullRateAddress, metadata: slotMeta(i) }),
      );
      const duplicateIds = [101n, 102n, 103n, 104n, 105n, 106n];
      const duplicates = duplicateIds.map((id) =>
        makeDataSet({ dataSetId: id, serviceProvider: fullRateAddress, metadata: slotMeta(1) }),
      );
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([...slots, ...duplicates] as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      expect(terminateServiceSync).toHaveBeenCalledTimes(6);
      // Only the duplicate copies go; every slot keeps the set the SDK resolves it to.
      for (const id of duplicateIds) {
        expect(terminateServiceSync).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ dataSetId: id }),
        );
      }
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "success",
        reason: "full_rate",
      });
      expect(attemptsCounter.inc).toHaveBeenCalledTimes(6);
    });

    it("keeps one set per required slot instead of the newest N — the newest can all be one slot", async () => {
      // The regression this guards: with target=3, the three newest sets all belong to slot 1.
      // Age-based retention would keep those and terminate the only baseline and slot-2 copies,
      // which data_set_creation then re-provisions, looping forever.
      const networkConfig = makeNetworkConfig({ minNumDataSetsForChecks: 3, excessDataSetBuffer: 0 });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );
      const fullRateAddress = "0xfullrate00000000000000000000000000000004";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 8n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 10n, serviceProvider: fullRateAddress, metadata: slotMeta(0) }),
        makeDataSet({ dataSetId: 11n, serviceProvider: fullRateAddress, metadata: slotMeta(2) }),
        makeDataSet({ dataSetId: 20n, serviceProvider: fullRateAddress, metadata: slotMeta(1) }),
        makeDataSet({ dataSetId: 21n, serviceProvider: fullRateAddress, metadata: slotMeta(1) }),
        makeDataSet({ dataSetId: 22n, serviceProvider: fullRateAddress, metadata: slotMeta(1) }),
      ] as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      // Baseline (10), slot 2 (11) and slot 1's lowest id (20) survive; the extra slot-1 copies go.
      expect(terminateServiceSync).toHaveBeenCalledTimes(2);
      for (const id of [21n, 22n]) {
        expect(terminateServiceSync).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ dataSetId: id }),
        );
      }
    });

    it("keeps the copy holding pieces when a slot has several, matching the SDK's own resolution", async () => {
      const networkConfig = makeNetworkConfig({ minNumDataSetsForChecks: 1, excessDataSetBuffer: 0 });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );
      const fullRateAddress = "0xfullrate00000000000000000000000000000005";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 9n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 30n, serviceProvider: fullRateAddress, metadata: slotMeta(0), activePieceCount: 0n }),
        makeDataSet({ dataSetId: 31n, serviceProvider: fullRateAddress, metadata: slotMeta(0), activePieceCount: 4n }),
      ] as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      // createContext prefers the lowest-id set that still holds pieces, so 31 is the live one.
      expect(terminateServiceSync).toHaveBeenCalledTimes(1);
      expect(terminateServiceSync).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dataSetId: 30n }));
    });

    it("skips a planned data set that another job already terminated before the relay call", async () => {
      const networkConfig = makeNetworkConfig({ minNumDataSetsForChecks: 1, excessDataSetBuffer: 0 });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );
      const fullRateAddress = "0xfullrate00000000000000000000000000000006";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 10n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 40n, serviceProvider: fullRateAddress, metadata: slotMeta(0) }),
        makeDataSet({ dataSetId: 41n, serviceProvider: fullRateAddress, metadata: slotMeta(0) }),
      ] as any);
      // The snapshot said 41 was active; by the time pruning reaches it, it is terminated.
      vi.mocked(getDataSet).mockResolvedValueOnce({ pdpEndEpoch: 123n } as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      expect(terminateServiceSync).not.toHaveBeenCalled();
      expect(attemptsCounter.inc).not.toHaveBeenCalled();
    });

    it("prunes a provider that has no registry row, using the provider on the data set", async () => {
      const networkConfig = makeNetworkConfig({ minNumDataSetsForChecks: 1, excessDataSetBuffer: 0 });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );
      const orphanAddress = "0xorphan0000000000000000000000000000000001";
      // Nothing in the registry: deregistered, or filtered out of registry sync.
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([]);
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 77n, serviceProvider: orphanAddress, metadata: slotMeta(0) }),
        makeDataSet({ dataSetId: 78n, serviceProvider: orphanAddress, metadata: slotMeta(0) }),
      ] as any);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      // Previously these were skipped entirely for want of a service URL; the on-chain provider
      // record carries one, so the surplus copy is terminated like any other.
      expect(terminateServiceSync).toHaveBeenCalledTimes(1);
      expect(terminateServiceSync).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ dataSetId: 78n, serviceURL: "https://sp.example.com" }),
      );
    });

    it("propagates an abort raised on the last data set instead of reporting success", async () => {
      const networkConfig = makeNetworkConfig({ minNumDataSetsForChecks: 1, excessDataSetBuffer: 0 });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );
      const fullRateAddress = "0xfullrate00000000000000000000000000000007";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 11n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 50n, serviceProvider: fullRateAddress, metadata: slotMeta(0) }),
        makeDataSet({ dataSetId: 51n, serviceProvider: fullRateAddress, metadata: slotMeta(0) }),
      ] as any);

      const controller = new AbortController();
      vi.mocked(terminateServiceSync).mockImplementationOnce(async () => {
        controller.abort(new Error("sp_data_set_pruning job timeout"));
        throw new Error("aborted mid-relay");
      });

      // Without the abort re-throw this would be swallowed as a per-data-set failure and the
      // job would be recorded as successful despite the timeout.
      await expect(service.runDataSetPruning(DEFAULT_NETWORK, controller.signal)).rejects.toThrow();
    });

    it("fetches the wallet's data sets exactly once regardless of how many blocked/trickle SPs there are", async () => {
      const networkConfig = makeNetworkConfig({
        blockedSpAddresses: new Set([
          "0xsp0000000000000000000000000000000000001",
          "0xsp0000000000000000000000000000000000002",
        ]),
      });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );
      const trickleAddress = "0xtrickle000000000000000000000000000000001";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 1n, serviceProvider: "0xsp0000000000000000000000000000000000001" }),
        makeProvider({ id: 2n, serviceProvider: "0xsp0000000000000000000000000000000000002" }),
        makeProvider({ id: 3n, serviceProvider: trickleAddress, isApproved: false }),
      ]);
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([]);

      await service.runDataSetPruning(DEFAULT_NETWORK);

      expect(getPdpDataSets).toHaveBeenCalledTimes(1);
    });

    it("continues the batch when a provider-relay termination attempt fails", async () => {
      const networkConfig = makeNetworkConfig({
        blockedSpAddresses: new Set(["0xsp0000000000000000000000000000000000001"]),
      });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );

      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([makeProvider()]);

      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 7n }),
        makeDataSet({ dataSetId: 8n }),
      ] as any);

      vi.mocked(terminateServiceSync)
        .mockRejectedValueOnce(new Error("SP unreachable"))
        .mockResolvedValueOnce({} as any);

      await expect(service.runDataSetPruning(DEFAULT_NETWORK)).resolves.toBeUndefined();

      expect(terminateServiceSync).toHaveBeenCalledTimes(2);
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "failure",
        reason: "blocked",
      });
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "success",
        reason: "blocked",
      });
    });

    it("stops relaying more excess data sets for the same provider once the signal aborts mid-batch", async () => {
      const networkConfig = makeNetworkConfig({
        blockedSpAddresses: new Set(["0xsp0000000000000000000000000000000000001"]),
      });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );

      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([makeProvider()]);

      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 30n }),
        makeDataSet({ dataSetId: 31n }),
        makeDataSet({ dataSetId: 32n }),
      ] as any);

      const controller = new AbortController();
      vi.mocked(terminateServiceSync).mockImplementationOnce(async () => {
        controller.abort(new Error("sp_data_set_pruning job timeout"));
        return {} as any;
      });

      await expect(service.runDataSetPruning(DEFAULT_NETWORK, controller.signal)).rejects.toThrow();

      // Only the first of the 3 excess data sets was relayed — the abort fired inside that call,
      // and the per-data-set check at the top of the next loop iteration caught it.
      expect(terminateServiceSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("runAbandonedDataSetSweep (Job B)", () => {
    it("deletes an abandoned data set directly via PDPVerifier.deleteDataSet with no signature (zero pieces, no cleanupPieces follow-up needed)", async () => {
      const dataSet = makeDataSet({ dataSetId: 10n, pdpEndEpoch: 0n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      // Last proven epoch far in the past -> outside the 86400-block activity window.
      mockBatchedReads({ getDataSetLastProvenEpoch: 1000n });
      const notInCleanupModeError = new ContractFunctionRevertedError({ abi: [], functionName: "cleanupPieces" });
      notInCleanupModeError.data = { errorName: "DataSetNotInCleanupMode", args: [] } as any;
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        // Zero remaining pieces: deleteDataSet already finalized directly, so cleanupPieces isn't
        // in cleanup mode and reverts — this is the expected, common case, not a failure.
        .mockRejectedValueOnce(notInCleanupModeError);
      vi.mocked(writeContract).mockResolvedValueOnce("0xtxhash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(multicall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          allowFailure: true,
          contracts: [expect.objectContaining({ functionName: "getDataSetLastProvenEpoch", args: [10n] })],
        }),
      );
      expect(simulateContract).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({ functionName: "deleteDataSet", args: [10n, "0x"] }),
      );
      expect(simulateContract).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ functionName: "cleanupPieces", args: [10n, 100n] }),
      );
      expect(writeContract).toHaveBeenCalledTimes(1); // only deleteDataSet actually wrote a tx
      expect(writeContract).toHaveBeenCalledWith(expect.anything(), { fake: "deleteDataSet-request" });
      // No provider-relay signature/POST path used for the abandonment branch.
      expect(terminateServiceSync).not.toHaveBeenCalled();
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "success",
        reason: "abandonment",
      });
    });

    it("loops cleanupPieces until done=true when pieces remain after deleteDataSet", async () => {
      const dataSet = makeDataSet({ dataSetId: 12n, pdpEndEpoch: 0n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      mockBatchedReads({ getDataSetLastProvenEpoch: 1000n });
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        .mockResolvedValueOnce({ request: { fake: "cleanup-1" }, result: false } as any) // cleanupPieces batch 1
        .mockResolvedValueOnce({ request: { fake: "cleanup-2" }, result: true } as any); // cleanupPieces batch 2 (done)
      vi.mocked(writeContract)
        .mockResolvedValueOnce("0xdelete-hash" as any)
        .mockResolvedValueOnce("0xcleanup-hash-1" as any)
        .mockResolvedValueOnce("0xcleanup-hash-2" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as any);

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(simulateContract).toHaveBeenCalledTimes(3);
      expect(writeContract).toHaveBeenCalledTimes(3);
      expect(simulateContract).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ functionName: "cleanupPieces", args: [12n, 100n] }),
      );
      expect(simulateContract).toHaveBeenNthCalledWith(
        3,
        expect.anything(),
        expect.objectContaining({ functionName: "cleanupPieces", args: [12n, 100n] }),
      );
    });

    it("retries a transient cleanupPieces failure within the same sweep instead of giving up immediately", async () => {
      const dataSet = makeDataSet({ dataSetId: 16n, pdpEndEpoch: 0n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      mockBatchedReads({ getDataSetLastProvenEpoch: 1000n });
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        .mockRejectedValueOnce(new Error("fetch failed: RPC timeout")) // cleanupPieces attempt 1 (transient)
        .mockResolvedValueOnce({ request: { fake: "cleanup-2" }, result: true } as any); // cleanupPieces attempt 2 (done)
      vi.mocked(writeContract)
        .mockResolvedValueOnce("0xdelete-hash" as any)
        .mockResolvedValueOnce("0xcleanup-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as any);

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      // Transient failure didn't write a tx (simulate itself rejected) — only the two successful
      // simulateContract calls (delete + the retried cleanup) actually reached writeContract.
      expect(simulateContract).toHaveBeenCalledTimes(3);
      expect(writeContract).toHaveBeenCalledTimes(2);
    });

    it("gives up after 5 consecutive cleanupPieces failures and does not retry indefinitely", async () => {
      const dataSet = makeDataSet({ dataSetId: 17n, pdpEndEpoch: 0n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      mockBatchedReads({ getDataSetLastProvenEpoch: 1000n });
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        .mockRejectedValue(new Error("fetch failed: RPC timeout")); // every cleanupPieces attempt fails
      vi.mocked(writeContract).mockResolvedValueOnce("0xdelete-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

      await expect(service.runAbandonedDataSetSweep(DEFAULT_NETWORK)).resolves.toBeUndefined();

      // 1 deleteDataSet simulate + 5 failed cleanupPieces simulates, then gives up.
      expect(simulateContract).toHaveBeenCalledTimes(6);
    });

    it("propagates an abort raised mid-cleanupPieces without relabeling the already-successful delete as failed", async () => {
      const dataSet = makeDataSet({ dataSetId: 18n, pdpEndEpoch: 0n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      mockBatchedReads({ getDataSetLastProvenEpoch: 1000n });

      const controller = new AbortController();
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        .mockImplementationOnce(async () => {
          // Simulate the deadline passing while cleanupPieces batch 1 is in flight.
          controller.abort(new Error("abandoned_data_set_sweep job timeout"));
          return { request: { fake: "cleanup-1" }, result: false } as any;
        });
      vi.mocked(writeContract)
        .mockResolvedValueOnce("0xdelete-hash" as any)
        .mockResolvedValueOnce("0xcleanup-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as any);

      await expect(service.runAbandonedDataSetSweep(DEFAULT_NETWORK, controller.signal)).rejects.toThrow();

      // deleteDataSet succeeded and was recorded as such — the abort must not also record a
      // "delete failed" attempt for the same data set.
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "success",
        reason: "abandonment",
      });
      expect(attemptsCounter.inc).not.toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "failure",
        reason: "abandonment",
      });
    });

    it("treats a reverted-but-mined deleteDataSet receipt as a failure, skipping the cleanupPieces follow-up", async () => {
      const dataSet = makeDataSet({ dataSetId: 15n, pdpEndEpoch: 0n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      mockBatchedReads({ getDataSetLastProvenEpoch: 1000n });
      vi.mocked(simulateContract).mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any);
      vi.mocked(writeContract).mockResolvedValueOnce("0xtxhash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "reverted" } as any);

      await expect(service.runAbandonedDataSetSweep(DEFAULT_NETWORK)).resolves.toBeUndefined();

      // Only the deleteDataSet simulate — no cleanupPieces follow-up, since the delete itself
      // never actually succeeded on-chain despite the tx getting mined.
      expect(simulateContract).toHaveBeenCalledTimes(1);
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "failure",
        reason: "abandonment",
      });
    });

    it("does not abort the sweep when getDataSetLastProvenEpoch fails for one data set — later data sets still run", async () => {
      const badDataSet = makeDataSet({ dataSetId: 13n, pdpEndEpoch: 0n });
      const stuckDataSet = makeDataSet({ dataSetId: 14n, pdpEndEpoch: 500n, pdpRailId: 995n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([badDataSet, stuckDataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n); // > 500 (strict) for the second data set
      mockBatchedReads({
        getDataSetLastProvenEpoch: new Error("RPC timeout"),
        getRail: { settledUpTo: 100n, endEpoch: 500n },
      });
      vi.mocked(settleRail).mockRejectedValueOnce(
        new ContractFunctionRevertedError({ abi: [], functionName: "settleRail" }),
      );
      vi.mocked(settleTerminatedRailWithoutValidationCall).mockReturnValueOnce({
        abi: [],
        address: "0xfilecoinpay",
        functionName: "settleTerminatedRailWithoutValidation",
        args: [995n],
      } as any);

      await expect(service.runAbandonedDataSetSweep(DEFAULT_NETWORK)).resolves.toBeUndefined();

      expect(simulateContract).not.toHaveBeenCalled();
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "failure",
        reason: "abandonment",
      });
      // The second data set (branch 2) still gets evaluated — the read failure on the first one
      // must not abort the loop.
      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 1);
    });

    it("skips a data set still inside the PDPVerifier activity window", async () => {
      const dataSet = makeDataSet({ dataSetId: 11n, pdpEndEpoch: 0n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      // Proven recently -> still within the 86400-block activity window.
      mockBatchedReads({ getDataSetLastProvenEpoch: 199000n });

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(simulateContract).not.toHaveBeenCalled();
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("resolves a stuck-looking rail automatically via permissionless settleRail — no human needed", async () => {
      const dataSet = makeDataSet({ dataSetId: 19n, pdpEndEpoch: 500n, pdpRailId: 993n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      mockBatchedReads({ getRail: { settledUpTo: 100n, endEpoch: 500n } });
      vi.mocked(settleRail).mockResolvedValueOnce("0xsettle-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(settleRail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ railId: 993n, untilEpoch: 500n }),
      );
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "success",
        reason: "settlement",
      });
      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: "stuck_terminations_detected" }));
    });

    it("still calls settleRail when settledUpTo >= endEpoch — a fully-settled-but-not-finalized rail needs one more call", async () => {
      const dataSet = makeDataSet({ dataSetId: 26n, pdpEndEpoch: 500n, pdpRailId: 994n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      // getRail succeeding at all means the rail is still active (not finalized/zeroed yet) —
      // settledUpTo >= endEpoch here means "fully settled but still needs finalizeTerminatedRail",
      // not "nothing to do".
      mockBatchedReads({ getRail: { settledUpTo: 500n, endEpoch: 500n } });
      vi.mocked(settleRail).mockResolvedValueOnce("0xfinalize-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(settleRail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ railId: 994n, untilEpoch: 500n }),
      );
      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "success",
        reason: "settlement",
      });
      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
    });

    it("does not flag as stuck on a transient settleRail failure — retries next sweep instead", async () => {
      const dataSet = makeDataSet({ dataSetId: 25n, pdpEndEpoch: 500n, pdpRailId: 993n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      mockBatchedReads({ getRail: { settledUpTo: 100n, endEpoch: 500n } });
      vi.mocked(settleRail).mockRejectedValueOnce(new Error("fetch failed: RPC timeout"));

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "failure",
        reason: "settlement",
      });
      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: "stuck_terminations_detected" }));
    });

    it("logs stuck_terminations_detected with the full batch payload only when settleRail itself genuinely reverts (validator stuck)", async () => {
      const dataSet = makeDataSet({ dataSetId: 20n, pdpEndEpoch: 500n, pdpRailId: 999n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n); // > pdpEndEpoch (strict)
      mockBatchedReads({ getRail: { settledUpTo: 100n, endEpoch: 500n } });
      vi.mocked(settleRail).mockRejectedValueOnce(
        new ContractFunctionRevertedError({ abi: [], functionName: "settleRail" }),
      );
      vi.mocked(settleTerminatedRailWithoutValidationCall).mockReturnValueOnce({
        abi: [],
        address: "0xfilecoinpay",
        functionName: "settleTerminatedRailWithoutValidation",
        args: [999n],
      } as any);

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "failure",
        reason: "settlement",
      });
      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "stuck_terminations_detected",
          network: DEFAULT_NETWORK,
          count: 1,
          items: [expect.objectContaining({ dataSetId: "20", railId: "999" })],
          batch: expect.objectContaining({
            transactions: [expect.objectContaining({ to: "0xfilecoinpay", value: "0", data: "0xcalldata" })],
          }),
        }),
      );
      // The escalation is logged for a human — dealbot never calls settleTerminatedRailWithoutValidation itself.
      expect(writeContract).not.toHaveBeenCalled();
      expect(simulateContract).not.toHaveBeenCalled();
    });

    it("flags a mined-but-reverted settleRail receipt as stuck, not a transient failure", async () => {
      const dataSet = makeDataSet({ dataSetId: 21n, pdpEndEpoch: 500n, pdpRailId: 991n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      mockBatchedReads({ getRail: { settledUpTo: 100n, endEpoch: 500n } });
      vi.mocked(settleRail).mockResolvedValueOnce("0xreverted-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "reverted" } as any);
      vi.mocked(settleTerminatedRailWithoutValidationCall).mockReturnValueOnce({
        abi: [],
        address: "0xfilecoinpay",
        functionName: "settleTerminatedRailWithoutValidation",
        args: [991n],
      } as any);

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(attemptsCounter.inc).toHaveBeenCalledWith({
        network: DEFAULT_NETWORK,
        outcome: "failure",
        reason: "settlement",
      });
      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "stuck_terminations_detected",
          items: [expect.objectContaining({ dataSetId: "21", railId: "991" })],
        }),
      );
    });

    it("does not log and resets the gauge to 0 when nothing is stuck", async () => {
      const dataSet = makeDataSet({ dataSetId: 21n, pdpEndEpoch: 500n, pdpRailId: 998n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      mockBatchedReads({ getRail: { settledUpTo: 500n, endEpoch: 500n } });

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: "stuck_terminations_detected" }));
    });

    it("treats a reverting getRail call as already-finalized and skips it silently (no persistence needed)", async () => {
      const dataSet = makeDataSet({ dataSetId: 22n, pdpEndEpoch: 500n, pdpRailId: 997n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      // A finalized rail reverts, which Multicall3 reports as a per-item failure.
      mockBatchedReads({
        getRail: new ContractFunctionRevertedError({ abi: [], functionName: "getRail" }),
      });

      await expect(service.runAbandonedDataSetSweep(DEFAULT_NETWORK)).resolves.toBeUndefined();

      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: "stuck_terminations_detected" }));
      expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: "sp_cleanup_get_rail_read_failed" }));
    });

    it("does NOT treat a transient rail-read failure as finalized — the whole batch fails instead", async () => {
      const dataSet = makeDataSet({ dataSetId: 24n, pdpEndEpoch: 500n, pdpRailId: 994n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      // A transport failure fails the eth_call itself. Multicall3 only reports a per-item
      // failure when that specific call reverted on-chain, so "reverted" cannot be produced by
      // an RPC timeout — the distinction the previous per-rail read had to make by hand.
      vi.mocked(multicall).mockRejectedValueOnce(new Error("fetch failed: RPC timeout"));

      await expect(service.runAbandonedDataSetSweep(DEFAULT_NETWORK)).rejects.toThrow("fetch failed");

      // Never silently recorded as resolved.
      expect(settleRail).not.toHaveBeenCalled();
    });

    it("retries with a smaller batch when a multicall exhausts node gas, rather than reading it as all-reverted", async () => {
      const dataSets = [10n, 11n].map((id) => makeDataSet({ dataSetId: id, pdpEndEpoch: 500n, pdpRailId: 900n + id }));
      vi.mocked(getPdpDataSets).mockResolvedValueOnce(dataSets as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);

      // Gas exhaustion marks *every* item failed, which is indistinguishable from "they all
      // reverted" — and reading it that way would silently skip every rail, every run.
      const outOfGas = new Error("message execution failed (exit=[SysErrOutOfGas(7)], vm error=...)");
      vi.mocked(multicall)
        .mockResolvedValueOnce(dataSets.map(() => ({ status: "failure", error: outOfGas })) as never)
        .mockResolvedValue([{ status: "success", result: { settledUpTo: 100n, endEpoch: 500n } }] as never);
      vi.mocked(settleRail).mockResolvedValue("0xsettle" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as any);

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: "sp_cleanup_multicall_out_of_gas", batchSize: 2, retryBatchSize: 1 }),
      );
      // Both rails still get settled after the split — none silently dropped.
      expect(settleRail).toHaveBeenCalledTimes(2);
    });

    it("propagates an abort raised during settlement instead of counting it as a failed attempt", async () => {
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([]);
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 60n, pdpEndEpoch: 100n, pdpRailId: 900n }),
      ] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200n);

      const controller = new AbortController();
      vi.mocked(multicall).mockImplementationOnce((async () => {
        controller.abort(new Error("abandoned_data_set_sweep job timeout"));
        throw new Error("aborted mid-read");
      }) as never);

      await expect(service.runAbandonedDataSetSweep(DEFAULT_NETWORK, controller.signal)).rejects.toThrow();
      expect(attemptsCounter.inc).not.toHaveBeenCalled();
    });

    it("does not escalate a data set still within its normal lockup (currentBlock <= pdpEndEpoch)", async () => {
      const dataSet = makeDataSet({ dataSetId: 23n, pdpEndEpoch: 500n, pdpRailId: 996n });
      vi.mocked(getPdpDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(500n); // equal, not strictly greater

      await service.runAbandonedDataSetSweep(DEFAULT_NETWORK);

      // Filtered out before the batched rail read is even assembled.
      expect(multicall).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ contracts: [expect.objectContaining({ functionName: "getRail" })] }),
      );
      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
    });
  });
});
