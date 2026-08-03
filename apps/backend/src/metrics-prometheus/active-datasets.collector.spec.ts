import type { Gauge } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveDataSetsCollector } from "./active-datasets.collector.js";

const makeGauge = () => ({ set: vi.fn(), remove: vi.fn() });
const walletAddress = "0x305025D07c1DEe47F25a4990179eFf2becddCA0B";

const makeConfigService = (subgraphEndpoint = "https://example.com/subgraph") => ({
  get: vi.fn((key: string) =>
    key === "activeNetworks"
      ? ["calibration"]
      : { calibration: { walletAddress, minNumDataSetsForChecks: 15, subgraphEndpoint } },
  ),
});

describe("ActiveDataSetsCollector", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("publishes subgraph counts for active providers and the configured expectation", async () => {
    const activeGauge = makeGauge();
    const expectedGauge = makeGauge();
    const lastSuccessGauge = makeGauge();
    const indexedBlockGauge = makeGauge();
    const walletSdkService = {
      getAllActiveProviders: vi.fn(() => [
        {
          id: 23n,
          serviceProvider: "0x0000000000000000000000000000000000000023",
          name: "provider-23",
          isApproved: true,
        },
        {
          id: 24n,
          serviceProvider: "0x0000000000000000000000000000000000000024",
          name: "provider-24",
          isApproved: false,
        },
      ]),
    };
    const fetchActiveDataSetCounts = vi.fn().mockResolvedValue({
      countsByAddress: new Map([["0x0000000000000000000000000000000000000023", 17]]),
      indexedAtBlock: 12345,
    });
    const collector = new ActiveDataSetsCollector(
      makeConfigService() as never,
      walletSdkService as never,
      { fetchActiveDataSetCounts } as never,
      activeGauge as unknown as Gauge,
      expectedGauge as unknown as Gauge,
      lastSuccessGauge as unknown as Gauge,
      indexedBlockGauge as unknown as Gauge,
    );
    collector.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchActiveDataSetCounts).toHaveBeenCalledTimes(1);
    expect(fetchActiveDataSetCounts).toHaveBeenCalledWith("calibration", walletAddress);
    expect(activeGauge.set).toHaveBeenCalledWith(
      {
        network: "calibration",
        providerId: "23",
        providerName: "provider-23",
        providerStatus: "approved",
      },
      17,
    );
    expect(activeGauge.set).toHaveBeenCalledWith(
      {
        network: "calibration",
        providerId: "24",
        providerName: "provider-24",
        providerStatus: "unapproved",
      },
      0,
    );
    expect(expectedGauge.set).toHaveBeenCalledWith({ network: "calibration" }, 15);
    expect(lastSuccessGauge.set).toHaveBeenCalledWith({ network: "calibration" }, expect.any(Number));
    expect(indexedBlockGauge.set).toHaveBeenCalledWith({ network: "calibration" }, 12345);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetchActiveDataSetCounts).toHaveBeenCalledTimes(2);
    collector.onModuleDestroy();
  });

  it("reconciles counts for providers missing from the active registry", async () => {
    const activeGauge = makeGauge();
    const expectedGauge = makeGauge();
    const lastSuccessGauge = makeGauge();
    const indexedBlockGauge = makeGauge();
    const walletSdkService = {
      getAllActiveProviders: vi.fn(() => [
        {
          id: 23n,
          serviceProvider: "0x0000000000000000000000000000000000000023",
          name: "provider-23",
          isApproved: true,
        },
      ]),
      getAllProviders: vi.fn(() => [
        {
          id: 23n,
          serviceProvider: "0x0000000000000000000000000000000000000023",
          name: "provider-23",
          isApproved: true,
        },
        {
          id: 99n,
          serviceProvider: "0x0000000000000000000000000000000000000099",
          name: "provider-99",
          isApproved: false,
        },
      ]),
    };
    const fetchActiveDataSetCounts = vi.fn().mockResolvedValue({
      countsByAddress: new Map([
        ["0x0000000000000000000000000000000000000023", 17],
        // deregistered from the active provider list but still holds active data sets
        ["0x0000000000000000000000000000000000000099", 3],
        // no matching provider anywhere in the registry (e.g. filtered as a dev provider)
        ["0x00000000000000000000000000000000000abc", 1],
      ]),
      indexedAtBlock: 12345,
    });
    const collector = new ActiveDataSetsCollector(
      makeConfigService() as never,
      walletSdkService as never,
      { fetchActiveDataSetCounts } as never,
      activeGauge as unknown as Gauge,
      expectedGauge as unknown as Gauge,
      lastSuccessGauge as unknown as Gauge,
      indexedBlockGauge as unknown as Gauge,
    );
    collector.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(activeGauge.set).toHaveBeenCalledWith(
      {
        network: "calibration",
        providerId: "23",
        providerName: "provider-23",
        providerStatus: "approved",
      },
      17,
    );
    expect(activeGauge.set).toHaveBeenCalledWith(
      {
        network: "calibration",
        providerId: "99",
        providerName: "provider-99",
        providerStatus: "unapproved",
      },
      3,
    );
    expect(activeGauge.set).toHaveBeenCalledWith(
      {
        network: "calibration",
        providerId: "0x00000000000000000000000000000000000abc",
        providerName: "0x00000000000000000000000000000000000abc",
        providerStatus: "unapproved",
      },
      1,
    );
    collector.onModuleDestroy();
  });

  it("keeps previous active values stale when collection fails", async () => {
    const activeGauge = makeGauge();
    const expectedGauge = makeGauge();
    const lastSuccessGauge = makeGauge();
    const indexedBlockGauge = makeGauge();
    const collector = new ActiveDataSetsCollector(
      makeConfigService() as never,
      { getAllActiveProviders: vi.fn(() => []) } as never,
      { fetchActiveDataSetCounts: vi.fn().mockRejectedValue(new Error("subgraph unavailable")) } as never,
      activeGauge as unknown as Gauge,
      expectedGauge as unknown as Gauge,
      lastSuccessGauge as unknown as Gauge,
      indexedBlockGauge as unknown as Gauge,
    );
    collector.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(activeGauge.remove).not.toHaveBeenCalled();
    expect(activeGauge.set).not.toHaveBeenCalled();
    expect(lastSuccessGauge.set).not.toHaveBeenCalled();
    expect(indexedBlockGauge.set).not.toHaveBeenCalled();
    expect(expectedGauge.set).toHaveBeenCalledWith({ network: "calibration" }, 15);
    collector.onModuleDestroy();
  });

  it("does not collect networks without a configured subgraph", async () => {
    const fetchActiveDataSetCounts = vi.fn();
    const collector = new ActiveDataSetsCollector(
      makeConfigService("") as never,
      { getAllActiveProviders: vi.fn() } as never,
      { fetchActiveDataSetCounts } as never,
      makeGauge() as unknown as Gauge,
      makeGauge() as unknown as Gauge,
      makeGauge() as unknown as Gauge,
      makeGauge() as unknown as Gauge,
    );

    collector.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchActiveDataSetCounts).not.toHaveBeenCalled();
    collector.onModuleDestroy();
  });
});
