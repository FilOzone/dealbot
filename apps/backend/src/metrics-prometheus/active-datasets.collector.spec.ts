import type { Gauge } from "prom-client";
import { describe, expect, it, vi } from "vitest";
import { ActiveDataSetsCollector } from "./active-datasets.collector.js";

const makeGauge = () => ({ set: vi.fn(), remove: vi.fn() });
const walletAddress = "0x305025D07c1DEe47F25a4990179eFf2becddCA0B";

const makeConfigService = () => ({
  get: vi.fn((key: string) =>
    key === "activeNetworks" ? ["calibration"] : { calibration: { walletAddress, minNumDataSetsForChecks: 15 } },
  ),
});

describe("ActiveDataSetsCollector", () => {
  it("publishes subgraph counts for active providers and the configured expectation", async () => {
    const activeGauge = makeGauge();
    const expectedGauge = makeGauge();
    const lastSuccessGauge = makeGauge();
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
    const fetchActiveDataSetCounts = vi
      .fn()
      .mockResolvedValue(new Map([["0x0000000000000000000000000000000000000023", 17]]));
    const collector = new ActiveDataSetsCollector(
      makeConfigService() as never,
      walletSdkService as never,
      { fetchActiveDataSetCounts } as never,
      activeGauge as unknown as Gauge,
      expectedGauge as unknown as Gauge,
      lastSuccessGauge as unknown as Gauge,
    );
    collector.onModuleInit();
    await Promise.all(
      [activeGauge, expectedGauge, lastSuccessGauge].map((gauge) =>
        (gauge as typeof gauge & { collect: () => Promise<void> }).collect(),
      ),
    );

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
  });

  it("keeps previous active values stale when collection fails", async () => {
    const activeGauge = makeGauge();
    const expectedGauge = makeGauge();
    const lastSuccessGauge = makeGauge();
    const collector = new ActiveDataSetsCollector(
      makeConfigService() as never,
      { getAllActiveProviders: vi.fn(() => []) } as never,
      { fetchActiveDataSetCounts: vi.fn().mockRejectedValue(new Error("subgraph unavailable")) } as never,
      activeGauge as unknown as Gauge,
      expectedGauge as unknown as Gauge,
      lastSuccessGauge as unknown as Gauge,
    );
    collector.onModuleInit();
    await (activeGauge as typeof activeGauge & { collect: () => Promise<void> }).collect();

    expect(activeGauge.remove).not.toHaveBeenCalled();
    expect(activeGauge.set).not.toHaveBeenCalled();
    expect(lastSuccessGauge.set).not.toHaveBeenCalled();
    expect(expectedGauge.set).toHaveBeenCalledWith({ network: "calibration" }, 15);
  });
});
