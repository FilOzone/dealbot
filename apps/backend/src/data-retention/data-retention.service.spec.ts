import type { ConfigService } from "@nestjs/config";
import type { Counter } from "prom-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import type { PDPSubgraphService } from "../pdp-subgraph/pdp-subgraph.service.js";
import type { ProviderDataSetResponse } from "../pdp-subgraph/types.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { DataRetentionService } from "./data-retention.service.js";

const PROVIDER_A = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" as const;
const PROVIDER_B = "0xab5801a7d398351b8be11c439e05c5b3259aec9b" as const;

type ProviderEntry = ProviderDataSetResponse["providers"][number];

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
  let walletSdkServiceMock: {
    getTestingProviders: ReturnType<typeof vi.fn>;
  };
  let pdpSubgraphServiceMock: {
    fetchSubgraphMeta: ReturnType<typeof vi.fn>;
    fetchProvidersWithDatasets: ReturnType<typeof vi.fn>;
  };
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
      getTestingProviders: vi.fn().mockReturnValue([
        {
          id: 1,
          serviceProvider: PROVIDER_A,
          isApproved: true,
        },
        {
          id: 2,
          serviceProvider: PROVIDER_B,
          isApproved: false,
        },
      ]),
    };

    pdpSubgraphServiceMock = {
      fetchSubgraphMeta: vi.fn().mockResolvedValue({
        _meta: {
          block: {
            number: 1200,
          },
        },
      }),
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
      counterMock as unknown as Counter,
    );
  });

  it("returns early when pdpSubgraphEndpoint is empty", async () => {
    (configServiceMock.get as ReturnType<typeof vi.fn>).mockReturnValue({
      pdpSubgraphEndpoint: "",
    });

    await service.pollDataRetention();

    expect(pdpSubgraphServiceMock.fetchSubgraphMeta).not.toHaveBeenCalled();
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).not.toHaveBeenCalled();
  });

  it("returns early when no testing providers configured", async () => {
    walletSdkServiceMock.getTestingProviders.mockReturnValueOnce(null);

    await service.pollDataRetention();

    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).not.toHaveBeenCalled();
  });

  it("returns early when testing providers array is empty", async () => {
    walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([]);

    await service.pollDataRetention();

    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).not.toHaveBeenCalled();
  });

  it("fetches providers and increments counters on first poll", async () => {
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);

    await service.pollDataRetention();

    expect(pdpSubgraphServiceMock.fetchSubgraphMeta).toHaveBeenCalled();
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).toHaveBeenCalledWith({
      blockNumber: 1200,
      addresses: [PROVIDER_A, PROVIDER_B],
    });

    // estimatedOverduePeriods = (1200 - (900 + 1)) / 100 = 299 / 100 = 2 (integer division)
    // estimatedTotalFaulted = 10 + 2 = 12
    // estimatedTotalPeriods = 100 + 2 = 102
    // estimatedTotalSuccess = 102 - 12 = 90
    // First poll: delta = full value (no previous)
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerStatus: "approved",
      value: "fault",
    });
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerStatus: "approved",
      value: "success",
    });
  });

  it("computes deltas correctly on consecutive polls", async () => {
    // First poll: blockNumber=1200
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);
    await service.pollDataRetention();

    const firstCallCount = counterMock.labels.mock.calls.length;

    // Second poll: blockNumber=1300, provider totals changed
    pdpSubgraphServiceMock.fetchSubgraphMeta.mockResolvedValueOnce({
      _meta: {
        block: {
          number: 1300,
        },
      },
    });
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
      (call: [Record<string, string>]) => call[0].providerId === "1" && call[0].value === "fault",
    );
    const providerBFaulted = labelCalls.some(
      (call: [Record<string, string>]) => call[0].providerId === "2" && call[0].value === "fault",
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
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerStatus: "approved",
      value: "fault",
    });
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerStatus: "approved",
      value: "success",
    });
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
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerStatus: "approved",
      value: "fault",
    });
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerStatus: "approved",
      value: "success",
    });
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
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerStatus: "approved",
      value: "fault",
    });
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerStatus: "approved",
      value: "success",
    });
  });

  it("processes providers in batches of MAX_PROVIDER_BATCH_LENGTH", async () => {
    // Create 75 providers (should be split into 2 batches: 50 + 25)
    const manyProviders = Array.from({ length: 75 }, (_, i) => ({
      id: i + 1,
      serviceProvider: `0x${i.toString().padStart(40, "0")}`,
      isApproved: true,
    }));
    walletSdkServiceMock.getTestingProviders.mockReturnValueOnce(manyProviders);

    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValue([]);

    await service.pollDataRetention();

    // Should be called twice: once for first 50, once for remaining 25
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).toHaveBeenCalledTimes(2);
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).toHaveBeenNthCalledWith(1, {
      blockNumber: 1200,
      addresses: expect.arrayContaining([expect.any(String)]),
    });
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets.mock.calls[0][0].addresses).toHaveLength(50);
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets.mock.calls[1][0].addresses).toHaveLength(25);
  });

  it("continues processing next batch if one batch fails", async () => {
    const manyProviders = Array.from({ length: 75 }, (_, i) => ({
      id: i + 1,
      serviceProvider: `0x${i.toString().padStart(40, "0")}`,
      isApproved: true,
    }));
    walletSdkServiceMock.getTestingProviders.mockReturnValueOnce(manyProviders);

    // First batch fails, second succeeds
    pdpSubgraphServiceMock.fetchProvidersWithDatasets
      .mockRejectedValueOnce(new Error("Subgraph timeout"))
      .mockResolvedValueOnce([]);

    await service.pollDataRetention();

    // Both batches should be attempted
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).toHaveBeenCalledTimes(2);
  });

  it("logs error and skips counter update when provider not found in cache but returned from subgraph", async () => {
    // Provider C not in cache
    const PROVIDER_C = "0x1234567890123456789012345678901234567890";
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_C })]);

    await service.pollDataRetention();

    // Should not increment counters for missing provider
    expect(counterMock.labels).not.toHaveBeenCalled();
  });
});
