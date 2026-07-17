import type { Gauge } from "prom-client";
import { describe, expect, it, vi } from "vitest";
import { ActiveDataSetsCollector } from "./active-datasets.collector.js";

const makeGauge = () => ({ set: vi.fn(), remove: vi.fn() });

describe("ActiveDataSetsCollector", () => {
  it("counts active data sets and emits the configured expectation", async () => {
    const activeGauge = makeGauge();
    const expectedGauge = makeGauge();
    const lastSuccessGauge = makeGauge();
    const getClientDataSets = vi.fn().mockResolvedValue([
      { dataSetId: 1n, providerId: 23n, pdpEndEpoch: 0n },
      { dataSetId: 2n, providerId: 23n, pdpEndEpoch: 0n },
      { dataSetId: 3n, providerId: 23n, pdpEndEpoch: 99n },
      { dataSetId: 0n, providerId: 23n, pdpEndEpoch: 0n },
    ]);
    const configService = {
      get: vi.fn((key: string) => {
        if (key === "activeNetworks") return ["calibration"];
        return {
          calibration: {
            walletAddress: "0x305025D07c1DEe47F25a4990179eFf2becddCA0B",
            minNumDataSetsForChecks: 15,
          },
        };
      }),
    };
    const walletSdkService = {
      getWalletServices: vi.fn(() => ({ warmStorageService: { getClientDataSets } })),
      getAllActiveProviders: vi.fn(() => [
        { id: 23n, name: "provider-23", isApproved: true },
        { id: 24n, name: "provider-24", isApproved: false },
      ]),
    };

    const collector = new ActiveDataSetsCollector(
      configService as never,
      walletSdkService as never,
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

    expect(getClientDataSets).toHaveBeenCalledWith({
      address: "0x305025D07c1DEe47F25a4990179eFf2becddCA0B",
      offset: 0n,
      limit: 100n,
    });
    expect(getClientDataSets).toHaveBeenCalledTimes(1);
    expect(activeGauge.set).toHaveBeenCalledWith(
      {
        network: "calibration",
        providerId: "23",
        providerName: "provider-23",
        providerStatus: "approved",
      },
      2,
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

  it("paginates independently instead of relying on the SDK fetch-all default", async () => {
    const activeGauge = makeGauge();
    const expectedGauge = makeGauge();
    const lastSuccessGauge = makeGauge();
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      dataSetId: BigInt(index + 1),
      providerId: 23n,
      pdpEndEpoch: 0n,
    }));
    const getClientDataSets = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ dataSetId: 101n, providerId: 23n, pdpEndEpoch: 0n }]);
    const configService = {
      get: vi.fn((key: string) =>
        key === "activeNetworks"
          ? ["calibration"]
          : {
              calibration: { walletAddress: "0x305025D07c1DEe47F25a4990179eFf2becddCA0B", minNumDataSetsForChecks: 15 },
            },
      ),
    };
    const walletSdkService = {
      getWalletServices: vi.fn(() => ({ warmStorageService: { getClientDataSets } })),
      getAllActiveProviders: vi.fn(() => [{ id: 23n, name: "provider-23", isApproved: true }]),
    };
    const collector = new ActiveDataSetsCollector(
      configService as never,
      walletSdkService as never,
      activeGauge as unknown as Gauge,
      expectedGauge as unknown as Gauge,
      lastSuccessGauge as unknown as Gauge,
    );
    collector.onModuleInit();
    await (activeGauge as typeof activeGauge & { collect: () => Promise<void> }).collect();

    expect(getClientDataSets).toHaveBeenNthCalledWith(1, {
      address: "0x305025D07c1DEe47F25a4990179eFf2becddCA0B",
      offset: 0n,
      limit: 100n,
    });
    expect(getClientDataSets).toHaveBeenNthCalledWith(2, {
      address: "0x305025D07c1DEe47F25a4990179eFf2becddCA0B",
      offset: 100n,
      limit: 100n,
    });
    expect(activeGauge.set).toHaveBeenCalledWith(expect.objectContaining({ providerId: "23" }), 101);
  });

  it("keeps previous active values stale when collection fails", async () => {
    const activeGauge = makeGauge();
    const expectedGauge = makeGauge();
    const lastSuccessGauge = makeGauge();
    const configService = {
      get: vi.fn((key: string) =>
        key === "activeNetworks"
          ? ["calibration"]
          : {
              calibration: { walletAddress: "0x305025D07c1DEe47F25a4990179eFf2becddCA0B", minNumDataSetsForChecks: 15 },
            },
      ),
    };
    const walletSdkService = {
      getWalletServices: vi.fn(() => ({
        warmStorageService: { getClientDataSets: vi.fn().mockRejectedValue(new Error("RPC unavailable")) },
      })),
      getAllActiveProviders: vi.fn(() => []),
    };

    const collector = new ActiveDataSetsCollector(
      configService as never,
      walletSdkService as never,
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
