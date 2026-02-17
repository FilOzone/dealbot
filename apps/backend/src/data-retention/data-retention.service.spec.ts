import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import type { PDPSubgraphService } from "../pdp-subgraph/pdp-subgraph.service.js";
import type { IProviderDataSetResponse } from "../pdp-subgraph/types.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { DataRetentionService } from "./data-retention.service.js";

const PROVIDER_A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;
const PROVIDER_B = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B" as const;

type ProviderEntry = IProviderDataSetResponse["providers"][number];

const makeProvider = (overrides: Partial<ProviderEntry> = {}): ProviderEntry => ({
  address: PROVIDER_A,
  totalFaultedPeriods: 10n,
  totalProvingPeriods: 100n,
  proofSets: [
    {
      totalFaultedPeriods: 2n,
      currentDeadlineCount: 5n,
      nextDeadline: 900n,
      maxProvingPeriod: 100n,
    },
  ],
  ...overrides,
});

describe("DataRetentionService", () => {
  let service: DataRetentionService;
  let configServiceMock: ConfigService<IConfig, true>;
  let walletSdkServiceMock: { getBlockNumber: ReturnType<typeof vi.fn> };
  let pdpSubgraphServiceMock: { fetchProvidersWithDatasets: ReturnType<typeof vi.fn> };
  let counterMock: { labels: ReturnType<typeof vi.fn>; inc: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    configServiceMock = {
      get: vi.fn((key: keyof IConfig) => {
        if (key === "blockchain") {
          return { pdpSubgraphEndpoint: "https://example.com/subgraph" };
        }
        return undefined;
      }),
    } as unknown as ConfigService<IConfig, true>;

    walletSdkServiceMock = {
      getBlockNumber: vi.fn().mockResolvedValue(1200),
    };

    pdpSubgraphServiceMock = {
      fetchProvidersWithDatasets: vi.fn().mockResolvedValue([]),
    };

    const incMock = vi.fn();
    counterMock = {
      labels: vi.fn().mockReturnValue({ inc: incMock }),
      inc: incMock,
    };

    service = new DataRetentionService(
      configServiceMock,
      walletSdkServiceMock as unknown as WalletSdkService,
      pdpSubgraphServiceMock as unknown as PDPSubgraphService,
      counterMock as any,
    );
  });

  it("returns early when pdpSubgraphEndpoint is empty", async () => {
    (configServiceMock.get as ReturnType<typeof vi.fn>).mockReturnValue({
      pdpSubgraphEndpoint: "",
    });

    await service.pollDataRetention();

    expect(walletSdkServiceMock.getBlockNumber).not.toHaveBeenCalled();
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).not.toHaveBeenCalled();
  });

  it("fetches providers and increments counters on first poll", async () => {
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);

    await service.pollDataRetention();

    expect(walletSdkServiceMock.getBlockNumber).toHaveBeenCalled();
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).toHaveBeenCalledWith(1200);

    // estimatedOverduePeriods = (1200 - (900 + 1)) / 100 = 299 / 100 = 2 (integer division)
    // estimatedTotalFaulted = 10 + 2 = 12
    // estimatedTotalPeriods = 100 + 2 = 102
    // estimatedTotalSuccess = 102 - 12 = 90
    // First poll: delta = full value (no previous)
    expect(counterMock.labels).toHaveBeenCalledWith({ status: "faulted", provider: PROVIDER_A });
    expect(counterMock.labels).toHaveBeenCalledWith({ status: "success", provider: PROVIDER_A });
  });

  it("computes deltas correctly on consecutive polls", async () => {
    // First poll: blockNumber=1200
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);
    await service.pollDataRetention();

    const firstCallCount = counterMock.labels.mock.calls.length;

    // Second poll: blockNumber=1300, provider totals changed
    walletSdkServiceMock.getBlockNumber.mockResolvedValueOnce(1300);
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
      makeProvider({
        totalFaultedPeriods: 12n,
        totalProvingPeriods: 105n,
      }),
    ]);

    await service.pollDataRetention();

    // Second poll should have incremented counters with the delta
    expect(counterMock.labels.mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  it("does not increment counters when deltas are zero", async () => {
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValue([makeProvider()]);

    // First poll
    await service.pollDataRetention();
    counterMock.labels.mockClear();

    // Second poll with same data and same block number
    await service.pollDataRetention();

    // No new increments since deltas are zero
    expect(counterMock.labels).not.toHaveBeenCalled();
  });

  it("handles multiple providers independently", async () => {
    const providerA = makeProvider({ address: PROVIDER_A, totalFaultedPeriods: 5n });
    const providerB = makeProvider({ address: PROVIDER_B, totalFaultedPeriods: 20n });
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([providerA, providerB]);

    await service.pollDataRetention();

    const labelCalls = counterMock.labels.mock.calls;
    const providerAFaulted = labelCalls.some(
      (call: [Record<string, string>]) => call[0].provider === PROVIDER_A && call[0].status === "faulted",
    );
    const providerBFaulted = labelCalls.some(
      (call: [Record<string, string>]) => call[0].provider === PROVIDER_B && call[0].status === "faulted",
    );
    expect(providerAFaulted).toBe(true);
    expect(providerBFaulted).toBe(true);
  });

  it("skips proof sets with maxProvingPeriod of zero", async () => {
    const provider = makeProvider({
      proofSets: [
        {
          totalFaultedPeriods: 1n,
          currentDeadlineCount: 1n,
          nextDeadline: 900n,
          maxProvingPeriod: 0n,
        },
      ],
    });
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([provider]);

    // Should not throw RangeError (division by zero)
    await service.pollDataRetention();

    // estimatedOverduePeriods = 0 (skipped due to maxProvingPeriod=0)
    // estimatedTotalFaulted = 10 + 0 = 10
    // estimatedTotalPeriods = 100 + 0 = 100
    // estimatedTotalSuccess = 100 - 10 = 90
    expect(counterMock.labels).toHaveBeenCalledWith({ status: "faulted", provider: PROVIDER_A });
    expect(counterMock.labels).toHaveBeenCalledWith({ status: "success", provider: PROVIDER_A });
  });

  it("handles empty providers array without errors", async () => {
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([]);

    await service.pollDataRetention();

    expect(counterMock.labels).not.toHaveBeenCalled();
  });

  it("handles provider with empty proofSets", async () => {
    const provider = makeProvider({ proofSets: [] });
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([provider]);

    await service.pollDataRetention();

    // estimatedOverduePeriods = 0 (no proof sets to sum)
    // estimatedTotalFaulted = 10 + 0 = 10
    // estimatedTotalPeriods = 100 + 0 = 100
    // estimatedTotalSuccess = 100 - 10 = 90
    expect(counterMock.labels).toHaveBeenCalledWith({ status: "faulted", provider: PROVIDER_A });
    expect(counterMock.labels).toHaveBeenCalledWith({ status: "success", provider: PROVIDER_A });
  });

  it("catches and logs errors without rethrowing", async () => {
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockRejectedValueOnce(new Error("subgraph down"));

    // Should not throw
    await expect(service.pollDataRetention()).resolves.toBeUndefined();
  });

  it("warns on negative deltas and does not increment counters", async () => {
    // First poll: high values
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
      makeProvider({ totalFaultedPeriods: 100n, totalProvingPeriods: 200n }),
    ]);
    await service.pollDataRetention();
    counterMock.labels.mockClear();

    // Second poll: lower values (e.g., chain reorg)
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
      makeProvider({ totalFaultedPeriods: 50n, totalProvingPeriods: 100n }),
    ]);
    await service.pollDataRetention();

    // Both deltas are negative, so counters should not be incremented
    expect(counterMock.labels).not.toHaveBeenCalled();
  });

  it("accumulates overdue periods across multiple proof sets", async () => {
    const provider = makeProvider({
      totalFaultedPeriods: 0n,
      totalProvingPeriods: 50n,
      proofSets: [
        {
          totalFaultedPeriods: 0n,
          currentDeadlineCount: 1n,
          nextDeadline: 1000n,
          maxProvingPeriod: 100n,
        },
        {
          totalFaultedPeriods: 0n,
          currentDeadlineCount: 1n,
          nextDeadline: 800n,
          maxProvingPeriod: 200n,
        },
      ],
    });
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([provider]);

    await service.pollDataRetention();

    // proofSet1: (1200 - (1000 + 1)) / 100 = 199/100 = 1n
    // proofSet2: (1200 - (800 + 1)) / 200 = 399/200 = 1n
    // estimatedOverduePeriods = 1 + 1 = 2
    // estimatedTotalFaulted = 0 + 2 = 2
    // estimatedTotalPeriods = 50 + 2 = 52
    // estimatedTotalSuccess = 52 - 2 = 50

    // Both faulted (2) and success (50) are positive, so both should be incremented
    expect(counterMock.labels).toHaveBeenCalledWith({ status: "faulted", provider: PROVIDER_A });
    expect(counterMock.labels).toHaveBeenCalledWith({ status: "success", provider: PROVIDER_A });
  });
});
