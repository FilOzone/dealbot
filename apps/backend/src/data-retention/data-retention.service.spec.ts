import type { ConfigService } from "@nestjs/config";
import type { Counter, Gauge } from "prom-client";
import { Repository } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import type { IConfig } from "../config/app.config.js";
import type { DataRetentionBaseline } from "../database/entities/data-retention-baseline.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { buildCheckMetricLabels } from "../metrics-prometheus/check-metric-labels.js";
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
  let counterMock: {
    labels: ReturnType<typeof vi.fn>;
    inc: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let gaugeMock: {
    labels: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let mockBaselineRepository: {
    find: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let mockSPRepository: {
    find: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    configServiceMock = {
      get: vi.fn((key: keyof IConfig) => {
        if (key === "blockchain") {
          return { pdpSubgraphEndpoint: "https://example.com/subgraph" };
        }
        if (key === "spBlocklists") {
          return { ids: new Set(), addresses: new Set() };
        }
        return undefined;
      }),
    } as unknown as ConfigService<IConfig, true>;

    walletSdkServiceMock = {
      getTestingProviders: vi.fn().mockReturnValue([
        {
          id: 1,
          serviceProvider: PROVIDER_A,
          name: "Provider A",
          isApproved: true,
        },
        {
          id: 2,
          serviceProvider: PROVIDER_B,
          name: "Provider B",
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

    const counterIncMock = vi.fn();
    const removeMock = vi.fn();
    counterMock = {
      labels: vi.fn().mockReturnValue({ inc: counterIncMock }),
      inc: counterIncMock,
      remove: removeMock,
    };

    const setMock = vi.fn();
    const gaugeIncMock = vi.fn();
    gaugeMock = {
      labels: vi.fn().mockReturnValue({ set: setMock, inc: gaugeIncMock }),
      set: setMock,
      remove: vi.fn(),
    };

    mockBaselineRepository = {
      find: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    mockSPRepository = { find: vi.fn() };
    const clickhouseServiceMock = { insert: vi.fn(), probeLocation: "test" } as unknown as ClickhouseService;
    service = new DataRetentionService(
      configServiceMock,
      walletSdkServiceMock as unknown as WalletSdkService,
      pdpSubgraphServiceMock as unknown as PDPSubgraphService,
      mockBaselineRepository as unknown as Repository<DataRetentionBaseline>,
      mockSPRepository as unknown as Repository<StorageProvider>,
      counterMock as unknown as Counter,
      gaugeMock as unknown as Gauge,
      clickhouseServiceMock,
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

  it("returns early when all providers are blocked for data-retention", async () => {
    (configServiceMock.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      if (key === "blockchain") return { pdpSubgraphEndpoint: "https://example.com/subgraph" };
      if (key === "spBlocklists") return { ids: new Set(), addresses: new Set([PROVIDER_A, PROVIDER_B]) };
    });

    await service.pollDataRetention();

    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).not.toHaveBeenCalled();
  });

  it("excludes blocked providers from data-retention polling while retaining unblocked ones", async () => {
    (configServiceMock.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      if (key === "blockchain") return { pdpSubgraphEndpoint: "https://example.com/subgraph" };
      if (key === "spBlocklists") return { ids: new Set(), addresses: new Set([PROVIDER_A]) };
    });
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_B })]);

    await service.pollDataRetention();

    const allAddressesPolled: string[] = (
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mock.calls as [{ addresses: string[] }][]
    ).flatMap(([{ addresses }]) => addresses);
    expect(allAddressesPolled).toContain(PROVIDER_B.toLowerCase());
    expect(allAddressesPolled).not.toContain(PROVIDER_A.toLowerCase());
  });

  it("returns early when testing providers array is empty", async () => {
    walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([]);

    await service.pollDataRetention();

    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).not.toHaveBeenCalled();
  });

  it("sets baseline on first poll without emitting counters (fresh deploy / new provider)", async () => {
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);

    await service.pollDataRetention();

    expect(pdpSubgraphServiceMock.fetchSubgraphMeta).toHaveBeenCalled();
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).toHaveBeenCalledWith({
      blockNumber: 1200,
      addresses: [PROVIDER_A, PROVIDER_B],
    });

    // First poll with no prior baseline: should NOT emit counters
    // (baseline is set for future delta computation)
    expect(counterMock.labels).not.toHaveBeenCalled();

    // But the baseline should be persisted so the next poll can compute real deltas
    // No overdue estimation: faultedPeriods=10, successPeriods=100-10=90
    expect(mockBaselineRepository.upsert).toHaveBeenCalledWith(
      {
        providerAddress: PROVIDER_A,
        faultedPeriods: "10",
        successPeriods: "90",
        lastBlockNumber: "1200",
      },
      ["providerAddress"],
    );
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
    // Seed DB baselines so first poll emits deltas
    mockBaselineRepository.find.mockResolvedValueOnce([
      { providerAddress: PROVIDER_A, faultedPeriods: "0", successPeriods: "0", lastBlockNumber: "1000" },
      { providerAddress: PROVIDER_B, faultedPeriods: "0", successPeriods: "0", lastBlockNumber: "1000" },
    ]);

    const providerA = makeProvider({ address: PROVIDER_A, totalFaultedPeriods: 5n });
    const providerB = makeProvider({ address: PROVIDER_B, totalFaultedPeriods: 20n });
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([providerA, providerB]);

    await service.pollDataRetention();

    const labelCalls = counterMock.labels.mock.calls;
    const providerAFaulted = labelCalls.some(
      (call: [Record<string, string>]) => call[0].providerId === "1" && call[0].value === "failure",
    );
    const providerBFaulted = labelCalls.some(
      (call: [Record<string, string>]) => call[0].providerId === "2" && call[0].value === "failure",
    );
    expect(providerAFaulted).toBe(true);
    expect(providerBFaulted).toBe(true);
  });

  it("uses subgraph-confirmed totals directly without overdue estimation", async () => {
    // Seed baseline so we can verify the computed values via deltas
    mockBaselineRepository.find.mockResolvedValueOnce([
      { providerAddress: PROVIDER_A, faultedPeriods: "0", successPeriods: "0", lastBlockNumber: "1000" },
    ]);

    const provider = makeProvider();
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([provider]);

    await service.pollDataRetention();

    // totalFaultedPeriods = 10, totalProvingPeriods = 100
    // confirmedTotalSuccess = 100 - 10 = 90
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerName: "Provider A",
      providerStatus: "approved",
      value: "failure",
    });
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerName: "Provider A",
      providerStatus: "approved",
      value: "success",
    });
  });

  it("handles empty providers array without errors", async () => {
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([]);

    await service.pollDataRetention();

    expect(counterMock.labels).not.toHaveBeenCalled();
  });

  it("emits both faulted and success counters from subgraph totals", async () => {
    // Seed baseline so we can verify the computed values via deltas
    mockBaselineRepository.find.mockResolvedValueOnce([
      { providerAddress: PROVIDER_A, faultedPeriods: "0", successPeriods: "0", lastBlockNumber: "1000" },
    ]);

    const provider = makeProvider();
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([provider]);

    await service.pollDataRetention();

    // totalFaultedPeriods = 10, totalProvingPeriods = 100
    // confirmedTotalSuccess = 100 - 10 = 90
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerName: "Provider A",
      providerStatus: "approved",
      value: "failure",
    });
    expect(counterMock.labels).toHaveBeenCalledWith({
      checkType: "dataRetention",
      providerId: "1",
      providerName: "Provider A",
      providerStatus: "approved",
      value: "success",
    });
  });

  it("catches and logs errors without rethrowing", async () => {
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockRejectedValueOnce(new Error("subgraph down"));

    // Should not throw
    await expect(service.pollDataRetention()).resolves.toBeUndefined();
  });

  it("resets baseline on negative deltas without incrementing counters", async () => {
    // First poll: high values
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
      makeProvider({ totalFaultedPeriods: 100n, totalProvingPeriods: 200n }),
    ]);
    await service.pollDataRetention();
    counterMock.labels.mockClear();

    // Second poll: lower values (e.g., chain reorg or subgraph correction)
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
      makeProvider({ totalFaultedPeriods: 50n, totalProvingPeriods: 100n }),
    ]);
    await service.pollDataRetention();

    // Both deltas are negative, so counters should not be incremented
    expect(counterMock.labels).not.toHaveBeenCalled();

    // Third poll: values increase from new baseline
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
      makeProvider({ totalFaultedPeriods: 52n, totalProvingPeriods: 105n }),
    ]);
    await service.pollDataRetention();

    // Should now increment based on new baseline (52-50=2 faulted, 55-50=5 success)
    expect(counterMock.labels).toHaveBeenCalled();
  });

  it("handles large BigInt deltas by incrementing in chunks", async () => {
    // Create a delta larger than Number.MAX_SAFE_INTEGER
    const largeValue = BigInt(Number.MAX_SAFE_INTEGER) + 1000n;

    // Seed baseline at zero so the full largeValue becomes the delta
    mockBaselineRepository.find.mockResolvedValueOnce([
      { providerAddress: PROVIDER_A, faultedPeriods: "0", successPeriods: "0", lastBlockNumber: "1000" },
    ]);

    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
      makeProvider({ totalFaultedPeriods: largeValue, totalProvingPeriods: largeValue * 2n }),
    ]);

    await service.pollDataRetention();

    // Should have been called multiple times (chunked increments)
    expect(counterMock.inc).toHaveBeenCalled();
    // Verify it was called with safe values (not exceeding MAX_SAFE_INTEGER)
    const incCalls = counterMock.inc.mock.calls;
    incCalls.forEach((call) => {
      const value = call[0];
      expect(value).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    });
  });

  it("handles BigInt delta exactly at MAX_SAFE_INTEGER boundary", async () => {
    const maxSafeInt = BigInt(Number.MAX_SAFE_INTEGER);

    // Seed baseline at zero so the full value becomes the delta
    mockBaselineRepository.find.mockResolvedValueOnce([
      { providerAddress: PROVIDER_A, faultedPeriods: "0", successPeriods: "0", lastBlockNumber: "1000" },
    ]);

    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
      makeProvider({ totalFaultedPeriods: maxSafeInt, totalProvingPeriods: maxSafeInt * 2n }),
    ]);

    await service.pollDataRetention();

    // Should increment without chunking since it's exactly at the boundary
    expect(counterMock.inc).toHaveBeenCalled();
  });

  it("uses only subgraph-confirmed provider-level totals", async () => {
    // Seed baseline at zero so subgraph totals are visible as delta
    mockBaselineRepository.find.mockResolvedValueOnce([
      { providerAddress: PROVIDER_A, faultedPeriods: "0", successPeriods: "0", lastBlockNumber: "1000" },
    ]);

    const provider = makeProvider({
      totalFaultedPeriods: 5n,
      totalProvingPeriods: 50n,
    });
    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([provider]);

    await service.pollDataRetention();

    // Uses subgraph totals directly: faulted=5*5=25, success=45*5=225
    const incCalls = counterMock.inc.mock.calls;
    expect(incCalls).toEqual(expect.arrayContaining([[25], [225]]));
  });

  it("processes providers in batches of MAX_PROVIDER_BATCH_LENGTH", async () => {
    // Create 75 providers (should be split into 2 batches: 50 + 25)
    const manyProviders = Array.from({ length: 75 }, (_, i) => ({
      id: i + 1,
      serviceProvider: `0x${i.toString().padStart(40, "0")}`,
      name: `Provider ${i + 1}`,
      isApproved: true,
    }));
    walletSdkServiceMock.getTestingProviders.mockReturnValueOnce(manyProviders);

    pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValue([]);

    await service.pollDataRetention();

    // Should be called twice: once for first 50, once for remaining 25
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).toHaveBeenCalledTimes(2);
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets).toHaveBeenNthCalledWith(1, {
      addresses: expect.arrayContaining([expect.any(String)]),
      blockNumber: 1200,
    });
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets.mock.calls[0][0].addresses).toHaveLength(50);
    expect(pdpSubgraphServiceMock.fetchProvidersWithDatasets.mock.calls[1][0].addresses).toHaveLength(25);
  });

  it("continues processing next batch if one batch fails", async () => {
    const manyProviders = Array.from({ length: 75 }, (_, i) => ({
      id: i + 1,
      serviceProvider: `0x${i.toString().padStart(40, "0")}`,
      name: `Provider ${i + 1}`,
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

  describe("cleanupStaleProviders", () => {
    it("does not cleanup when no stale providers exist", async () => {
      // First poll establishes baseline for both providers
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({ address: PROVIDER_A }),
        makeProvider({ address: PROVIDER_B }),
      ]);

      await service.pollDataRetention();

      // Repository should not be queried since no stale providers
      expect(mockSPRepository.find).not.toHaveBeenCalled();
    });

    it("successfully cleans up stale provider with valid database entry", async () => {
      // First poll: establish baseline for PROVIDER_A
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_A })]);
      await service.pollDataRetention();

      // Second poll: PROVIDER_A removed from active list, only PROVIDER_B active
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        {
          id: 2,
          serviceProvider: PROVIDER_B,
          name: "Provider B",
          isApproved: false,
        },
      ]);

      mockSPRepository.find.mockResolvedValueOnce([
        {
          address: PROVIDER_A,
          name: "Provider A",
          providerId: 1,
          isApproved: true,
        },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_B })]);

      await service.pollDataRetention();

      // Should fetch stale provider info from database
      expect(mockSPRepository.find).toHaveBeenCalledWith({
        where: { address: expect.anything() },
        select: ["address", "providerId", "name", "isApproved"],
      });

      // Should remove all counter label combinations
      const approvedLabels = buildCheckMetricLabels({
        checkType: "dataRetention",
        providerId: 1n,
        providerName: "Provider A",
        providerIsApproved: true,
      });
      const unapprovedLabels = buildCheckMetricLabels({
        checkType: "dataRetention",
        providerId: 1n,
        providerName: "Provider A",
        providerIsApproved: false,
      });
      expect(counterMock.remove).toHaveBeenCalledWith({ ...approvedLabels, value: "success" });
      expect(counterMock.remove).toHaveBeenCalledWith({ ...approvedLabels, value: "failure" });
      expect(counterMock.remove).toHaveBeenCalledWith({ ...unapprovedLabels, value: "success" });
      expect(counterMock.remove).toHaveBeenCalledWith({ ...unapprovedLabels, value: "failure" });
    });

    it("skips cleanup entirely when database fetch fails", async () => {
      // First poll: establish baseline
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_A })]);
      await service.pollDataRetention();

      // Second poll: provider removed, but DB fails
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        {
          id: 2,
          serviceProvider: PROVIDER_B,
          name: "Provider B",
          isApproved: false,
        },
      ]);

      mockSPRepository.find.mockRejectedValueOnce(new Error("Database connection failed"));

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_B })]);

      await service.pollDataRetention();

      // Should attempt to fetch from database
      expect(mockSPRepository.find).toHaveBeenCalled();

      // Should NOT remove any counters (cleanup skipped)
      expect((counterMock as unknown as Counter).remove).not.toHaveBeenCalled();

      // Third poll: provider returns, should use old baseline (preventing double-counting)
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        {
          id: 1,
          serviceProvider: PROVIDER_A,
          name: "Provider A",
          isApproved: true,
        },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({ address: PROVIDER_A, totalFaultedPeriods: 12n, totalProvingPeriods: 105n }),
      ]);

      counterMock.labels.mockClear();
      await service.pollDataRetention();

      // Should compute delta from original baseline, not from zero
      expect(counterMock.labels).toHaveBeenCalled();
    });

    it("retains baseline when provider not found in database", async () => {
      // First poll: establish baseline
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_A })]);
      await service.pollDataRetention();

      // Second poll: provider removed from active list
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        {
          id: 2,
          serviceProvider: PROVIDER_B,
          name: "Provider B",
          isApproved: false,
        },
      ]);

      // Database returns empty array (provider not found)
      mockSPRepository.find.mockResolvedValueOnce([]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_B })]);

      await service.pollDataRetention();

      // Should NOT remove counters (provider not in DB)
      expect(counterMock.remove).not.toHaveBeenCalled();

      // Third poll: provider returns
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        {
          id: 1,
          serviceProvider: PROVIDER_A,
          name: "Provider A",
          isApproved: true,
        },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({ address: PROVIDER_A, totalFaultedPeriods: 12n, totalProvingPeriods: 105n }),
      ]);

      counterMock.labels.mockClear();
      await service.pollDataRetention();

      // Should use old baseline (delta from 10 to 12 = 2)
      expect(counterMock.labels).toHaveBeenCalled();
    });

    it("retains baseline when provider has null providerId", async () => {
      // First poll: establish baseline
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_A })]);
      await service.pollDataRetention();

      // Second poll: provider removed
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        {
          id: 2,
          serviceProvider: PROVIDER_B,
          name: "Provider B",
          isApproved: false,
        },
      ]);

      // Database returns provider but with null providerId
      mockSPRepository.find.mockResolvedValueOnce([
        {
          address: PROVIDER_A,
          name: "Provider A",
          providerId: null,
          isApproved: true,
        },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_B })]);

      await service.pollDataRetention();

      // Should NOT remove counters (missing providerId)
      expect(counterMock.remove).not.toHaveBeenCalled();
    });

    it("retains baseline when counter removal throws error", async () => {
      // First poll: establish baseline
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_A })]);
      await service.pollDataRetention();

      // Second poll: provider removed
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        {
          id: 2,
          serviceProvider: PROVIDER_B,
          name: "Provider B",
          isApproved: false,
        },
      ]);

      mockSPRepository.find.mockResolvedValueOnce([
        {
          address: PROVIDER_A,
          name: "Provider A",
          providerId: 1,
          isApproved: true,
        },
      ]);

      // Counter removal throws error
      counterMock.remove.mockImplementationOnce(() => {
        throw new Error("Counter removal failed");
      });

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_B })]);

      await service.pollDataRetention();

      // Should attempt removal
      expect(counterMock.remove).toHaveBeenCalled();

      // Third poll: provider returns, should still have baseline
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        {
          id: 1,
          serviceProvider: PROVIDER_A,
          name: "Provider A",
          isApproved: true,
        },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({ address: PROVIDER_A, totalFaultedPeriods: 12n, totalProvingPeriods: 110n }),
      ]);

      counterMock.labels.mockClear();
      await service.pollDataRetention();

      // Should compute delta from original baseline
      expect(counterMock.labels).toHaveBeenCalled();
    });

    it("cleans up multiple stale providers in batch", async () => {
      const PROVIDER_C = "0x1111111111111111111111111111111111111111";

      // First poll: establish baselines for A, B, C
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        { id: 1, serviceProvider: PROVIDER_A, name: "Provider A", isApproved: true },
        { id: 2, serviceProvider: PROVIDER_B, name: "Provider B", isApproved: false },
        { id: 3, serviceProvider: PROVIDER_C, name: "Provider C", isApproved: true },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({ address: PROVIDER_A }),
        makeProvider({ address: PROVIDER_B }),
        makeProvider({ address: PROVIDER_C }),
      ]);

      await service.pollDataRetention();

      // Second poll: only PROVIDER_A remains active
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        { id: 1, serviceProvider: PROVIDER_A, name: "Provider A", isApproved: true },
      ]);

      mockSPRepository.find.mockResolvedValueOnce([
        { address: PROVIDER_B, name: "Provider B", providerId: 2, isApproved: false },
        { address: PROVIDER_C, name: "Provider C", providerId: 3, isApproved: true },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_A })]);

      await service.pollDataRetention();

      // Should fetch both stale providers in one query
      expect(mockSPRepository.find).toHaveBeenCalledWith({
        where: { address: expect.anything() },
        select: ["address", "providerId", "name", "isApproved"],
      });

      // Should remove counters for both providers (8 total: 2 providers × 4 values)
      expect(counterMock.remove).toHaveBeenCalledTimes(8);
    });

    it("skips cleanup when processing errors occurred", async () => {
      // First poll: establish baseline
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_A })]);
      await service.pollDataRetention();

      // Second poll: provider removed, but processing has errors
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        { id: 2, serviceProvider: PROVIDER_B, name: "Provider B", isApproved: false },
      ]);

      // Simulate processing error
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockRejectedValueOnce(new Error("Processing failed"));

      await service.pollDataRetention();

      // Should NOT attempt cleanup due to processing errors
      expect(mockSPRepository.find).not.toHaveBeenCalled();
      expect(counterMock.remove).not.toHaveBeenCalled();
    });

    it("normalizes addresses to lowercase for consistent lookups", async () => {
      const PROVIDER_MIXED_CASE = "0xD8Da6bF26964aF9D7eEd9e03E53415D37aA96045" as const;

      // First poll with mixed case address
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        { id: 1, serviceProvider: PROVIDER_MIXED_CASE, name: "Provider A", isApproved: true },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({ address: PROVIDER_MIXED_CASE.toLowerCase() as `0x${string}` }),
      ]);

      await service.pollDataRetention();

      // Second poll: provider removed
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        { id: 2, serviceProvider: PROVIDER_B, name: "Provider B", isApproved: false },
      ]);

      mockSPRepository.find.mockResolvedValueOnce([
        {
          address: PROVIDER_MIXED_CASE,
          name: "Provider A",
          providerId: 1,
          isApproved: true,
        },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_B })]);

      await service.pollDataRetention();

      // Should successfully find and clean up provider despite case difference
      expect(counterMock.remove).toHaveBeenCalled();
    });
  });

  describe("baseline persistence (restart resilience)", () => {
    it("loads baselines from DB on first poll and prevents counter inflation", async () => {
      // Simulate a restart: DB has persisted baselines from a previous run
      mockBaselineRepository.find.mockResolvedValueOnce([
        {
          providerAddress: PROVIDER_A,
          faultedPeriods: "10",
          successPeriods: "90",
          lastBlockNumber: "1100",
        },
      ]);

      // Subgraph returns same values: totalFaultedPeriods=10, totalProvingPeriods=100
      // confirmedTotalSuccess = 100 - 10 = 90
      // With DB baseline: faultedDelta = 10 - 10 = 0, successDelta = 90 - 90 = 0
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);

      await service.pollDataRetention();

      // Key assertion: counters should NOT be incremented because deltas are zero
      expect(counterMock.labels).not.toHaveBeenCalled();
    });

    it("emits only the real delta when DB baseline exists", async () => {
      // DB has baseline from previous run
      mockBaselineRepository.find.mockResolvedValueOnce([
        {
          providerAddress: PROVIDER_A,
          faultedPeriods: "8",
          successPeriods: "85",
          lastBlockNumber: "1000",
        },
      ]);

      // Subgraph returns: totalFaultedPeriods=10, totalProvingPeriods=100
      // confirmedTotalSuccess = 100 - 10 = 90
      // faultedDelta = 10 - 8 = 2, successDelta = 90 - 85 = 5
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);

      await service.pollDataRetention();

      // Should increment by only the delta, not the full cumulative values
      expect(counterMock.labels).toHaveBeenCalledWith(expect.objectContaining({ value: "failure" }));
      expect(counterMock.labels).toHaveBeenCalledWith(expect.objectContaining({ value: "success" }));

      // Verify the actual increment values
      const incCalls = counterMock.inc.mock.calls;
      // faultedDelta=2*5=10, successDelta=5*5=25
      expect(incCalls).toEqual(expect.arrayContaining([[10], [25]]));
    });

    it("only loads baselines from DB once across multiple polls", async () => {
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValue([makeProvider()]);

      await service.pollDataRetention();
      await service.pollDataRetention();
      await service.pollDataRetention();

      // DB find should only be called once (lazy init)
      expect(mockBaselineRepository.find).toHaveBeenCalledTimes(1);
    });

    it("retries DB load on next poll if first load fails", async () => {
      mockBaselineRepository.find.mockRejectedValueOnce(new Error("DB connection failed")).mockResolvedValueOnce([
        {
          providerAddress: PROVIDER_A,
          faultedPeriods: "10",
          successPeriods: "90",
          lastBlockNumber: "1100",
        },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValue([makeProvider()]);

      // First poll: DB load fails, poll bails out to avoid emitting bloated values
      await service.pollDataRetention();
      expect(mockBaselineRepository.find).toHaveBeenCalledTimes(1);
      expect(pdpSubgraphServiceMock.fetchSubgraphMeta).not.toHaveBeenCalled();
      expect(counterMock.labels).not.toHaveBeenCalled();

      // Second poll: DB load succeeds, baselines restored, normal delta computation
      await service.pollDataRetention();
      expect(mockBaselineRepository.find).toHaveBeenCalledTimes(2);
      // Deltas from DB baseline: faultedDelta = 10 - 10 = 0, successDelta = 90 - 90 = 0
      expect(counterMock.labels).not.toHaveBeenCalled();
    });

    it("emits real deltas on second poll after fresh deploy baseline-only first poll", async () => {
      // First poll: fresh deploy, no baselines in DB
      // Baseline set to: faultedPeriods=10, successPeriods=90
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);
      await service.pollDataRetention();
      counterMock.labels.mockClear();
      counterMock.inc.mockClear();

      // Second poll: values have increased
      pdpSubgraphServiceMock.fetchSubgraphMeta.mockResolvedValueOnce({
        _meta: { block: { number: 1300 } },
      });
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({ totalFaultedPeriods: 12n, totalProvingPeriods: 105n }),
      ]);

      await service.pollDataRetention();

      // faultedDelta = (12 - 10) * 5 = 10, successDelta = ((105 - 12) - 90) * 5 = 15
      expect(counterMock.labels).toHaveBeenCalled();
      const incCalls = counterMock.inc.mock.calls;
      expect(incCalls).toEqual(expect.arrayContaining([[10], [15]]));
    });

    it("deletes baseline from DB when stale provider is cleaned up", async () => {
      // First poll: establish baseline for PROVIDER_A
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_A })]);
      await service.pollDataRetention();

      // Second poll: PROVIDER_A removed from active list
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        { id: 2, serviceProvider: PROVIDER_B, name: "Provider B", isApproved: false },
      ]);

      mockSPRepository.find.mockResolvedValueOnce([
        { address: PROVIDER_A, name: "Provider A", providerId: 1, isApproved: true },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_B })]);

      await service.pollDataRetention();

      // Should delete the baseline from DB
      expect(mockBaselineRepository.delete).toHaveBeenCalledWith({ providerAddress: PROVIDER_A });
    });
  });

  describe("overdue periods gauge", () => {
    it("emits overdue gauge on first poll (baseline-only)", async () => {
      // Provider is overdue: currentBlock=1200,
      // estimatedOverduePeriods = (1200 - 901) / 100 = 2.99 -> 2
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);

      await service.pollDataRetention();

      expect(gaugeMock.labels).toHaveBeenCalledWith(
        expect.objectContaining({
          checkType: "dataRetention",
          providerId: "1",
          providerName: "Provider A",
          providerStatus: "approved",
        }),
      );
      expect(gaugeMock.set).toHaveBeenCalledWith(2);
    });

    it("emits overdue gauge = 0 when provider is not overdue", async () => {
      // nextDeadline=2000 > currentBlock=1200
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ proofSets: [] })]);

      await service.pollDataRetention();

      expect(gaugeMock.set).toHaveBeenCalledWith(0);
    });

    it("emits overdue gauge even on negative delta (baseline reset)", async () => {
      // First poll: high values
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({ totalFaultedPeriods: 100n, totalProvingPeriods: 200n }),
      ]);
      await service.pollDataRetention();
      gaugeMock.labels.mockClear();
      gaugeMock.set.mockClear();

      // Second poll: lower values (negative delta) but still overdue
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({ totalFaultedPeriods: 50n, totalProvingPeriods: 100n }),
      ]);
      await service.pollDataRetention();

      // Gauge should still be emitted despite negative deltas on counters
      expect(gaugeMock.labels).toHaveBeenCalled();
      expect(gaugeMock.set).toHaveBeenCalled();
    });

    it("naturally resets gauge to 0 when subgraph catches up", async () => {
      // First poll: provider is overdue (currentBlock=1200, nextDeadline=1000)
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider()]);
      await service.pollDataRetention();

      expect(gaugeMock.set).toHaveBeenCalledWith(2);

      gaugeMock.labels.mockClear();
      gaugeMock.set.mockClear();

      // Second poll: subgraph caught up, nextDeadline advanced past currentBlock
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([
        makeProvider({
          totalFaultedPeriods: 12n,
          totalProvingPeriods: 102n,
          proofSets: [],
        }),
      ]);

      await service.pollDataRetention();

      // Gauge should reset to 0 because nextDeadline (1300) > currentBlock (1200)
      expect(gaugeMock.set).toHaveBeenCalledWith(0);
    });

    it("removes overdue gauge when stale provider is cleaned up", async () => {
      // First poll: establish baseline for PROVIDER_A
      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_A })]);
      await service.pollDataRetention();

      // Second poll: PROVIDER_A removed from active list
      walletSdkServiceMock.getTestingProviders.mockReturnValueOnce([
        { id: 2, serviceProvider: PROVIDER_B, name: "Provider B", isApproved: false },
      ]);

      mockSPRepository.find.mockResolvedValueOnce([
        { address: PROVIDER_A, name: "Provider A", providerId: 1, isApproved: true },
      ]);

      pdpSubgraphServiceMock.fetchProvidersWithDatasets.mockResolvedValueOnce([makeProvider({ address: PROVIDER_B })]);

      await service.pollDataRetention();

      // Should remove overdue gauge for stale provider (both approved and unapproved labels)
      const approvedLabels = buildCheckMetricLabels({
        checkType: "dataRetention",
        providerId: 1n,
        providerName: "Provider A",
        providerIsApproved: true,
      });
      const unapprovedLabels = buildCheckMetricLabels({
        checkType: "dataRetention",
        providerId: 1n,
        providerName: "Provider A",
        providerIsApproved: false,
      });
      expect(gaugeMock.remove).toHaveBeenCalledWith(approvedLabels);
      expect(gaugeMock.remove).toHaveBeenCalledWith(unapprovedLabels);
    });
  });
});
