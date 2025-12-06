import { SchedulerService } from "./scheduler.service.js";

// Mock SDK and dependencies to avoid ESM resolution issues in tests
jest.mock(
  "@filoz/synapse-sdk",
  () => ({
    RPC_URLS: { calibration: { http: "http://mock" } },
    SIZE_CONSTANTS: {},
    Synapse: class {},
    METADATA_KEYS: {},
    PDPServer: class {},
  }),
  { virtual: true },
);

jest.mock(
  "@filoz/synapse-sdk/sp-registry",
  () => ({
    SPRegistryService: class {},
  }),
  { virtual: true },
);

jest.mock(
  "@ipld/car",
  () => ({
    CarWriter: class {},
  }),
  { virtual: true },
);

jest.mock(
  "multiformats/cid",
  () => ({
    CID: { parse: jest.fn() },
  }),
  { virtual: true },
);

jest.mock("multiformats/codecs/raw", () => ({}), { virtual: true });
jest.mock("multiformats/hashes/sha2", () => ({ sha256: {} }), { virtual: true });

describe("SchedulerService balance monitoring", () => {
  const makeService = () => {
    const cfg: any = {
      get: (key: string) => {
        if (key === "scheduling") {
          return {
            dealStartOffsetSeconds: 0,
            dealIntervalSeconds: 30,
            retrievalStartOffsetSeconds: 600,
            retrievalIntervalSeconds: 60,
            metricsStartOffsetSeconds: 900,
          };
        }
        if (key === "walletMonitor") {
          return {
            balanceCheckIntervalSeconds: 300,
          };
        }
        return undefined;
      },
    };

    const dealService: any = {};
    const retrievalService: any = {};
    const schedulerRegistry: any = {
      addCronJob: jest.fn(),
    };

    const walletSdkService = {
      ensureWalletAllowances: jest.fn(async () => {}),
      checkAndHandleBalance: jest.fn(async () => {}),
      loadProviders: jest.fn(async () => {}),
      getTestingProvidersCount: jest.fn(() => 0),
    } as any;

    const svc = new SchedulerService(dealService, retrievalService, cfg, schedulerRegistry, walletSdkService);

    return { svc, walletSdkService, schedulerRegistry };
  };

  it("calls checkAndHandleBalance when handleWalletBalanceCheck is invoked", async () => {
    const { svc, walletSdkService } = makeService();

    await svc.handleWalletBalanceCheck();

    expect(walletSdkService.checkAndHandleBalance).toHaveBeenCalledTimes(1);
  });

  it("skips concurrent runs when balance check is already running", async () => {
    const { svc, walletSdkService } = makeService();

    // Make checkAndHandleBalance hang
    let resolver: () => void;
    const hangPromise = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    walletSdkService.checkAndHandleBalance.mockImplementation(() => hangPromise);

    const call1 = svc.handleWalletBalanceCheck();
    const call2 = svc.handleWalletBalanceCheck();

    // Resolve the first call
    resolver!();
    await call1;
    await call2;

    // Should only be called once (second skipped)
    expect(walletSdkService.checkAndHandleBalance).toHaveBeenCalledTimes(1);
  });

  it("releases lock even when checkAndHandleBalance throws", async () => {
    const { svc, walletSdkService } = makeService();

    walletSdkService.checkAndHandleBalance.mockRejectedValueOnce(new Error("network"));

    await svc.handleWalletBalanceCheck();

    // Should not throw, and lock should be released
    await svc.handleWalletBalanceCheck();

    expect(walletSdkService.checkAndHandleBalance).toHaveBeenCalledTimes(2);
  });
});
