import { Logger } from "@nestjs/common";
import { ContractFunctionRevertedError } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trickleTierRates } from "../config/constants.js";
import type { INetworkConfig } from "../config/index.js";
import type { StorageProviderRepository } from "../providers/repositories/storage-provider.repository.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { SpCleanupService } from "./sp-cleanup.service.js";

vi.mock("filecoin-pin/core/data-set", () => ({
  listDataSets: vi.fn(),
}));

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

vi.mock("viem/actions", () => ({
  getBlockNumber: vi.fn(),
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

const { listDataSets } = await import("filecoin-pin/core/data-set");
const { terminateServiceSync } = await import("../data-set-lifecycle/data-set-lifecycle.service.js");
const { getRail, settleRail, settleTerminatedRailWithoutValidationCall } = await import("@filoz/synapse-core/pay");
const { asChain } = await import("@filoz/synapse-core/chains");
const { getBlockNumber, readContract, simulateContract, writeContract, waitForTransactionReceipt } = await import(
  "viem/actions"
);

const DEFAULT_NETWORK = "calibration";

function makeNetworkConfig(overrides: Partial<INetworkConfig> = {}): INetworkConfig {
  return {
    network: DEFAULT_NETWORK,
    walletAddress: "0xwallet0000000000000000000000000000000000",
    walletPrivateKey: "0xkey",
    blockedSpIds: new Set<string>(),
    blockedSpAddresses: new Set<string>(),
    fullRateSpIds: new Set<string>(),
    fullRateSpAddresses: new Set<string>(),
    useOnlyApprovedProviders: false,
    minNumDataSetsForChecks: 15,
    excessDatasetBuffer: 5,
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

function makeDataSet(overrides: Record<string, unknown> = {}) {
  return {
    dataSetId: 1n,
    serviceProvider: "0xsp0000000000000000000000000000000000001",
    pdpEndEpoch: 0n,
    pdpRailId: 100n,
    providerId: 1n,
    ...overrides,
  };
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
    getSynapseClient: ReturnType<typeof vi.fn>;
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
      getSynapseClient: vi.fn(() => ({ chain: fakeChain, account: { address: "0xsession" } })),
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runDatasetPruning (Job A)", () => {
    it("terminates every active data set for a blocked SP down to 0", async () => {
      const networkConfig = makeNetworkConfig({
        blockedSpAddresses: new Set(["0xsp0000000000000000000000000000000000001"]),
      });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );

      const blockedProvider = makeProvider();
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([blockedProvider]);

      vi.mocked(listDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 5n }),
        makeDataSet({ dataSetId: 6n }),
      ] as any);

      await service.runDatasetPruning(DEFAULT_NETWORK);

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

      // trickle target=1, buffer=5 (default fixture) -> need > 6 active to trigger a prune.
      const dataSets = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n].map((id) =>
        makeDataSet({ dataSetId: id, serviceProvider: trickleAddress }),
      );
      vi.mocked(listDataSets).mockResolvedValueOnce(dataSets as any);

      await service.runDatasetPruning(DEFAULT_NETWORK);

      // trickleTierRates.minNumDataSetsForChecks is kept; the rest (oldest first) are terminated.
      const expectedTerminated = dataSets.length - trickleTierRates.minNumDataSetsForChecks;
      expect(terminateServiceSync).toHaveBeenCalledTimes(expectedTerminated);
      expect(attemptsCounter.inc).toHaveBeenCalledTimes(expectedTerminated);
      for (const call of vi.mocked(attemptsCounter.inc).mock.calls) {
        expect(call[0]).toMatchObject({ reason: "trickle" });
      }
    });

    it("leaves a full-rate SP within its target untouched", async () => {
      const fullRateAddress = "0xfullrate00000000000000000000000000000001";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 3n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      vi.mocked(listDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 99n, serviceProvider: fullRateAddress }),
      ] as any);

      await service.runDatasetPruning(DEFAULT_NETWORK);

      expect(listDataSets).toHaveBeenCalledTimes(1);
      expect(listDataSets).toHaveBeenCalledWith(expect.anything(), {});
      expect(terminateServiceSync).not.toHaveBeenCalled();
    });

    it("leaves a full-rate SP alone when it's over target but still within the excess buffer", async () => {
      // target=15 (default fixture), buffer=5 -> 19 active is <= 15+5, no prune.
      const fullRateAddress = "0xfullrate00000000000000000000000000000002";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 4n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      const dataSets = Array.from({ length: 19 }, (_, i) =>
        makeDataSet({ dataSetId: BigInt(i + 1), serviceProvider: fullRateAddress }),
      );
      vi.mocked(listDataSets).mockResolvedValueOnce(dataSets as any);

      await service.runDatasetPruning(DEFAULT_NETWORK);

      expect(terminateServiceSync).not.toHaveBeenCalled();
    });

    it("prunes a full-rate SP back to target once it exceeds target + buffer — safety net independent of root cause", async () => {
      // target=15, buffer=5 -> 21 active exceeds 20, prunes the oldest 6 down to 15.
      const fullRateAddress = "0xfullrate00000000000000000000000000000003";
      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([
        makeProvider({ id: 5n, serviceProvider: fullRateAddress, isApproved: true }),
      ]);
      const dataSets = Array.from({ length: 21 }, (_, i) =>
        makeDataSet({ dataSetId: BigInt(i + 1), serviceProvider: fullRateAddress }),
      );
      vi.mocked(listDataSets).mockResolvedValueOnce(dataSets as any);

      await service.runDatasetPruning(DEFAULT_NETWORK);

      expect(terminateServiceSync).toHaveBeenCalledTimes(6);
      // Oldest (lowest dataSetId) 6 are terminated, keeping the newest 15.
      for (const id of [1n, 2n, 3n, 4n, 5n, 6n]) {
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
      vi.mocked(listDataSets).mockResolvedValueOnce([]);

      await service.runDatasetPruning(DEFAULT_NETWORK);

      expect(listDataSets).toHaveBeenCalledTimes(1);
    });

    it("continues the batch when a provider-relay termination attempt fails", async () => {
      const networkConfig = makeNetworkConfig({
        blockedSpAddresses: new Set(["0xsp0000000000000000000000000000000000001"]),
      });
      configService.get.mockImplementation((key: string) =>
        key === "networks" ? { [DEFAULT_NETWORK]: networkConfig } : undefined,
      );

      storageProviderRepository.findAllByNetwork.mockResolvedValueOnce([makeProvider()]);

      vi.mocked(listDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 7n }),
        makeDataSet({ dataSetId: 8n }),
      ] as any);

      vi.mocked(terminateServiceSync)
        .mockRejectedValueOnce(new Error("SP unreachable"))
        .mockResolvedValueOnce({} as any);

      await expect(service.runDatasetPruning(DEFAULT_NETWORK)).resolves.toBeUndefined();

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

      vi.mocked(listDataSets).mockResolvedValueOnce([
        makeDataSet({ dataSetId: 30n }),
        makeDataSet({ dataSetId: 31n }),
        makeDataSet({ dataSetId: 32n }),
      ] as any);

      const controller = new AbortController();
      vi.mocked(terminateServiceSync).mockImplementationOnce(async () => {
        controller.abort(new Error("sp_dataset_pruning job timeout"));
        return {} as any;
      });

      await expect(service.runDatasetPruning(DEFAULT_NETWORK, controller.signal)).rejects.toThrow();

      // Only the first of the 3 excess data sets was relayed — the abort fired inside that call,
      // and the per-data-set check at the top of the next loop iteration caught it.
      expect(terminateServiceSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("runAbandonedDatasetSweep (Job B)", () => {
    it("deletes an abandoned data set directly via PDPVerifier.deleteDataSet with no signature (zero pieces, no cleanupPieces follow-up needed)", async () => {
      const dataSet = makeDataSet({ dataSetId: 10n, pdpEndEpoch: 0n });
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      // Last proven epoch far in the past -> outside the 86400-block activity window.
      vi.mocked(readContract).mockResolvedValueOnce(1000n as any);
      const notInCleanupModeError = new ContractFunctionRevertedError({ abi: [], functionName: "cleanupPieces" });
      notInCleanupModeError.data = { errorName: "DataSetNotInCleanupMode", args: [] } as any;
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        // Zero remaining pieces: deleteDataSet already finalized directly, so cleanupPieces isn't
        // in cleanup mode and reverts — this is the expected, common case, not a failure.
        .mockRejectedValueOnce(notInCleanupModeError);
      vi.mocked(writeContract).mockResolvedValueOnce("0xtxhash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

      expect(readContract).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ functionName: "getDataSetLastProvenEpoch", args: [10n] }),
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
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      vi.mocked(readContract).mockResolvedValueOnce(1000n as any);
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        .mockResolvedValueOnce({ request: { fake: "cleanup-1" }, result: false } as any) // cleanupPieces batch 1
        .mockResolvedValueOnce({ request: { fake: "cleanup-2" }, result: true } as any); // cleanupPieces batch 2 (done)
      vi.mocked(writeContract)
        .mockResolvedValueOnce("0xdelete-hash" as any)
        .mockResolvedValueOnce("0xcleanup-hash-1" as any)
        .mockResolvedValueOnce("0xcleanup-hash-2" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as any);

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

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
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      vi.mocked(readContract).mockResolvedValueOnce(1000n as any);
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        .mockRejectedValueOnce(new Error("fetch failed: RPC timeout")) // cleanupPieces attempt 1 (transient)
        .mockResolvedValueOnce({ request: { fake: "cleanup-2" }, result: true } as any); // cleanupPieces attempt 2 (done)
      vi.mocked(writeContract)
        .mockResolvedValueOnce("0xdelete-hash" as any)
        .mockResolvedValueOnce("0xcleanup-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as any);

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

      // Transient failure didn't write a tx (simulate itself rejected) — only the two successful
      // simulateContract calls (delete + the retried cleanup) actually reached writeContract.
      expect(simulateContract).toHaveBeenCalledTimes(3);
      expect(writeContract).toHaveBeenCalledTimes(2);
    });

    it("gives up after 5 consecutive cleanupPieces failures and does not retry indefinitely", async () => {
      const dataSet = makeDataSet({ dataSetId: 17n, pdpEndEpoch: 0n });
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      vi.mocked(readContract).mockResolvedValueOnce(1000n as any);
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        .mockRejectedValue(new Error("fetch failed: RPC timeout")); // every cleanupPieces attempt fails
      vi.mocked(writeContract).mockResolvedValueOnce("0xdelete-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

      await expect(service.runAbandonedDatasetSweep(DEFAULT_NETWORK)).resolves.toBeUndefined();

      // 1 deleteDataSet simulate + 5 failed cleanupPieces simulates, then gives up.
      expect(simulateContract).toHaveBeenCalledTimes(6);
    });

    it("propagates an abort raised mid-cleanupPieces without relabeling the already-successful delete as failed", async () => {
      const dataSet = makeDataSet({ dataSetId: 18n, pdpEndEpoch: 0n });
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      vi.mocked(readContract).mockResolvedValueOnce(1000n as any);

      const controller = new AbortController();
      vi.mocked(simulateContract)
        .mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any) // deleteDataSet
        .mockImplementationOnce(async () => {
          // Simulate the deadline passing while cleanupPieces batch 1 is in flight.
          controller.abort(new Error("abandoned_dataset_sweep job timeout"));
          return { request: { fake: "cleanup-1" }, result: false } as any;
        });
      vi.mocked(writeContract)
        .mockResolvedValueOnce("0xdelete-hash" as any)
        .mockResolvedValueOnce("0xcleanup-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as any);

      await expect(service.runAbandonedDatasetSweep(DEFAULT_NETWORK, controller.signal)).rejects.toThrow();

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
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      vi.mocked(readContract).mockResolvedValueOnce(1000n as any);
      vi.mocked(simulateContract).mockResolvedValueOnce({ request: { fake: "deleteDataSet-request" } } as any);
      vi.mocked(writeContract).mockResolvedValueOnce("0xtxhash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "reverted" } as any);

      await expect(service.runAbandonedDatasetSweep(DEFAULT_NETWORK)).resolves.toBeUndefined();

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
      vi.mocked(listDataSets).mockResolvedValueOnce([badDataSet, stuckDataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n); // > 500 (strict) for the second data set
      vi.mocked(readContract).mockRejectedValueOnce(new Error("RPC timeout"));
      vi.mocked(getRail).mockResolvedValueOnce({ settledUpTo: 100n, endEpoch: 500n } as any);
      vi.mocked(settleRail).mockRejectedValueOnce(
        new ContractFunctionRevertedError({ abi: [], functionName: "settleRail" }),
      );
      vi.mocked(settleTerminatedRailWithoutValidationCall).mockReturnValueOnce({
        abi: [],
        address: "0xfilecoinpay",
        functionName: "settleTerminatedRailWithoutValidation",
        args: [995n],
      } as any);

      await expect(service.runAbandonedDatasetSweep(DEFAULT_NETWORK)).resolves.toBeUndefined();

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
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      // Proven recently -> still within the 86400-block activity window.
      vi.mocked(readContract).mockResolvedValueOnce(199000n as any);

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

      expect(simulateContract).not.toHaveBeenCalled();
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("resolves a stuck-looking rail automatically via permissionless settleRail — no human needed", async () => {
      const dataSet = makeDataSet({ dataSetId: 19n, pdpEndEpoch: 500n, pdpRailId: 993n });
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      vi.mocked(getRail).mockResolvedValueOnce({ settledUpTo: 100n, endEpoch: 500n } as any);
      vi.mocked(settleRail).mockResolvedValueOnce("0xsettle-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

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
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      // getRail succeeding at all means the rail is still active (not finalized/zeroed yet) —
      // settledUpTo >= endEpoch here means "fully settled but still needs finalizeTerminatedRail",
      // not "nothing to do".
      vi.mocked(getRail).mockResolvedValueOnce({ settledUpTo: 500n, endEpoch: 500n } as any);
      vi.mocked(settleRail).mockResolvedValueOnce("0xfinalize-hash" as any);
      vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

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
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      vi.mocked(getRail).mockResolvedValueOnce({ settledUpTo: 100n, endEpoch: 500n } as any);
      vi.mocked(settleRail).mockRejectedValueOnce(new Error("fetch failed: RPC timeout"));

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

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
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n); // > pdpEndEpoch (strict)
      vi.mocked(getRail).mockResolvedValueOnce({ settledUpTo: 100n, endEpoch: 500n } as any);
      vi.mocked(settleRail).mockRejectedValueOnce(
        new ContractFunctionRevertedError({ abi: [], functionName: "settleRail" }),
      );
      vi.mocked(settleTerminatedRailWithoutValidationCall).mockReturnValueOnce({
        abi: [],
        address: "0xfilecoinpay",
        functionName: "settleTerminatedRailWithoutValidation",
        args: [999n],
      } as any);

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

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

    it("does not log and resets the gauge to 0 when nothing is stuck", async () => {
      const dataSet = makeDataSet({ dataSetId: 21n, pdpEndEpoch: 500n, pdpRailId: 998n });
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      vi.mocked(getRail).mockResolvedValueOnce({ settledUpTo: 500n, endEpoch: 500n } as any);

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: "stuck_terminations_detected" }));
    });

    it("treats a reverting getRail call as already-finalized and skips it silently (no persistence needed)", async () => {
      const dataSet = makeDataSet({ dataSetId: 22n, pdpEndEpoch: 500n, pdpRailId: 997n });
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      const revertError = new ContractFunctionRevertedError({
        abi: [],
        functionName: "getRail",
      });
      vi.mocked(getRail).mockRejectedValueOnce(revertError);

      await expect(service.runAbandonedDatasetSweep(DEFAULT_NETWORK)).resolves.toBeUndefined();

      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: "stuck_terminations_detected" }));
      expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: "sp_cleanup_get_rail_read_failed" }));
    });

    it("does NOT treat a transient getRail read failure as finalized — logs it distinctly instead of going silent", async () => {
      const dataSet = makeDataSet({ dataSetId: 24n, pdpEndEpoch: 500n, pdpRailId: 994n });
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(200000n);
      vi.mocked(getRail).mockRejectedValueOnce(new Error("fetch failed: RPC timeout"));

      await expect(service.runAbandonedDatasetSweep(DEFAULT_NETWORK)).resolves.toBeUndefined();

      // Still excluded from this run's stuck count (can't confirm it's actually stuck), but unlike
      // the revert case, this must be visible in logs — it's a transient failure, not a resolution.
      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: "sp_cleanup_get_rail_read_failed", dataSetId: "24" }),
      );
    });

    it("does not escalate a data set still within its normal lockup (currentBlock <= pdpEndEpoch)", async () => {
      const dataSet = makeDataSet({ dataSetId: 23n, pdpEndEpoch: 500n, pdpRailId: 996n });
      vi.mocked(listDataSets).mockResolvedValueOnce([dataSet] as any);
      vi.mocked(getBlockNumber).mockResolvedValueOnce(500n); // equal, not strictly greater

      await service.runAbandonedDatasetSweep(DEFAULT_NETWORK);

      expect(getRail).not.toHaveBeenCalled();
      expect(stuckGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 0);
    });
  });
});
