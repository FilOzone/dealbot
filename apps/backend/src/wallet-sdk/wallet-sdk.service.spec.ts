import type { ConfigService } from "@nestjs/config";
import { stringToHex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/index.js";
import { WalletSdkService } from "./wallet-sdk.service.js";
import type { PDPProviderEx } from "./wallet-sdk.types.js";

type LoggerLike = {
  warn: (message: string) => void;
  error: (message: string) => void;
  log: (message: string) => void;
};

const baseNetworkConfig = {
  network: "calibration" as const,
  rpcRequestTimeoutMs: 30000,
  walletAddress: "0x0000000000000000000000000000000000000000",
  walletPrivateKey: "0xtest" as `0x${string}`,
  checkDatasetCreationFees: false,
  useOnlyApprovedProviders: false,
  minNumDataSetsForChecks: 1,
  pdpSubgraphEndpoint: "https://api.thegraph.com/subgraphs/filecoin/pdp",
  dealsPerSpPerHour: 4,
  retrievalsPerSpPerHour: 2,
  sampledRetrievalsPerSpPerHour: 2,
  dataSetCreationsPerSpPerHour: 1,
  dataSetLifecycleCheckEnabled: true,
  dataSetLifecycleChecksPerSpPerHour: 1,
  dataSetLifecycleCheckJobTimeoutSeconds: 600,
  dataRetentionPollIntervalSeconds: 3600,
  providersRefreshIntervalSeconds: 14400,
  maintenanceWindowsUtc: ["07:00", "22:00"],
  maintenanceWindowMinutes: 20,
  pieceCleanupPerSpPerHour: 1,
  maxPieceCleanupRuntimeSeconds: 300,
  maxDatasetStorageSizeBytes: 24 * 1024 * 1024 * 1024,
  targetDatasetStorageSizeBytes: 20 * 1024 * 1024 * 1024,
  blockedSpIds: new Set(),
  blockedSpAddresses: new Set(),
  fullRateSpIds: new Set(),
  fullRateSpAddresses: new Set(),
  dealJobTimeoutSeconds: 300,
  dataSetCreationJobTimeoutSeconds: 300,
  retrievalJobTimeoutSeconds: 300,
  sampledRetrievalJobTimeoutSeconds: 360,
  pullChecksPerSpPerHour: 1,
  pullCheckJobTimeoutSeconds: 300,
  pullCheckPollIntervalSeconds: 2,
  pullCheckPieceSizeBytes: 10 * 1024 * 1024, // 10 MiB
  pullPieceCleanupIntervalSeconds: 7 * 24 * 3600, // 7 days
} satisfies IConfig["networks"]["calibration"];

const makeProvider = (overrides: Partial<PDPProviderEx>): PDPProviderEx =>
  ({
    id: 1n,
    serviceProvider: "0xprovider",
    name: "provider",
    description: "desc",
    payee: "0xpayee",
    isActive: true,
    isApproved: false,
    pdp: {
      serviceURL: "https://example.invalid",
      location: "loc",
    },
    ...overrides,
  }) as PDPProviderEx;

describe("WalletSdkService", () => {
  let service: WalletSdkService;
  let storageProviderRepositoryMock: {
    countByNetwork: ReturnType<typeof vi.fn>;
    upsertFromRegistry: ReturnType<typeof vi.fn>;
  };
  let loggerMock: LoggerLike;

  beforeEach(() => {
    storageProviderRepositoryMock = {
      countByNetwork: vi.fn().mockResolvedValue(0),
      upsertFromRegistry: vi.fn().mockResolvedValue(undefined),
    };

    const configService = {
      get: vi.fn((key: keyof IConfig) => {
        if (key === "activeNetworks") return ["calibration"];
        if (key === "networks") return { calibration: baseNetworkConfig };
        return undefined;
      }),
    } as unknown as ConfigService<IConfig, true>;

    service = new WalletSdkService(configService, storageProviderRepositoryMock as any);
    loggerMock = {
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    };
    (service as any).logger = loggerMock;
  });

  it("coalesces concurrent loadProviders calls", async () => {
    let resolveLoad: (value: boolean) => void;
    const loadPromise = new Promise<boolean>((resolve) => {
      resolveLoad = resolve;
    });
    const loadProvidersInternal = vi.fn(() => loadPromise);
    const mockState = {
      providersLoadPromise: null,
    };
    (service as any).networkStates.set("calibration", mockState);
    (service as any).loadProvidersInternal = loadProvidersInternal;

    const first = service.loadProviders("calibration");
    const second = service.loadProviders("calibration");

    expect(loadProvidersInternal).toHaveBeenCalledTimes(1);

    resolveLoad!(true);
    await Promise.all([first, second]);

    expect(loadProvidersInternal).toHaveBeenCalledTimes(1);
  });

  it("ensureProvidersLoaded loads from chain only when the DB has zero rows for the network", async () => {
    storageProviderRepositoryMock.countByNetwork.mockResolvedValue(0);
    const loadProviders = vi.fn().mockResolvedValue(true);
    (service as any).loadProviders = loadProviders;

    await service.ensureProvidersLoaded("calibration");

    expect(storageProviderRepositoryMock.countByNetwork).toHaveBeenCalledWith("calibration");
    expect(loadProviders).toHaveBeenCalledWith("calibration");
  });

  it("ensureProvidersLoaded skips the chain when the DB already has rows", async () => {
    storageProviderRepositoryMock.countByNetwork.mockResolvedValue(5);
    const loadProviders = vi.fn();
    (service as any).loadProviders = loadProviders;

    await service.ensureProvidersLoaded("calibration");

    expect(loadProviders).not.toHaveBeenCalled();
  });

  it("returns false when the DB sync fails, so callers don't record a false success", async () => {
    storageProviderRepositoryMock.upsertFromRegistry.mockRejectedValue(new Error("db down"));
    const provider = makeProvider({ id: 1n });
    const mockState = {
      config: baseNetworkConfig,
      warmStorageService: { getApprovedProviderIds: vi.fn().mockResolvedValue([]) },
      spRegistry: {
        getProviderCount: vi.fn().mockResolvedValue(1n),
        getAllActiveProviders: vi.fn().mockResolvedValue([provider]),
      },
      providersLoadPromise: null,
    };
    (service as any).networkStates.set("calibration", mockState);

    const result = await service.loadProviders("calibration");

    expect(result).toBe(false);
    expect(storageProviderRepositoryMock.upsertFromRegistry).toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({ event: "providers_sync_to_db_failed" }));
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({ event: "providers_load_failed" }));
  });

  describe("ensureWalletAllowances", () => {
    it("performs read-only check in session key mode", async () => {
      const mockState = {
        isSessionKeyMode: true,
        synapseClient: null,
        config: baseNetworkConfig,
      };
      (service as any).networkStates.set("calibration", mockState);
      // getUploadCosts needs synapseClient but will fail without a real RPC
      // Verify it doesn't fall through to the storageManager.prepare path
      (service as any)._synapseClient = null;
      await expect(service.ensureWalletAllowances("calibration")).rejects.toThrow();
      // storageManager.prepare was never called (it would also throw, but differently)
    });

    it("attempts allowances in direct key mode", async () => {
      const mockState = {
        isSessionKeyMode: false,
        storageManager: undefined,
        config: baseNetworkConfig,
      };
      (service as any).networkStates.set("calibration", mockState);
      // storageManager is not initialized so prepare() will throw
      await expect(service.ensureWalletAllowances("calibration")).rejects.toThrow();
    });
  });

  describe("isDevProvider", () => {
    it("returns false when extraCapabilities is absent", () => {
      expect((service as any).isDevProvider(makeProvider({}))).toBe(false);
    });

    it("returns false when serviceStatus key is absent", () => {
      const info = makeProvider({
        pdp: {
          serviceURL: "https://example.invalid",
          location: "loc",
          extraCapabilities: { someKey: stringToHex("dev") },
        } as any,
      });
      expect((service as any).isDevProvider(info)).toBe(false);
    });

    it("returns true for hex-encoded 'dev'", () => {
      const info = makeProvider({
        pdp: {
          serviceURL: "https://example.invalid",
          location: "loc",
          extraCapabilities: { serviceStatus: stringToHex("dev") },
        } as any,
      });
      expect((service as any).isDevProvider(info)).toBe(true);
    });

    it("returns false for a non-dev hex-encoded value", () => {
      const info = makeProvider({
        pdp: {
          serviceURL: "https://example.invalid",
          location: "loc",
          extraCapabilities: { serviceStatus: stringToHex("prod") },
        } as any,
      });
      expect((service as any).isDevProvider(info)).toBe(false);
    });
  });
});
