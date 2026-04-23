import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/types.js";
import { WalletSdkService } from "./wallet-sdk.service.js";
import type { PDPProviderEx } from "./wallet-sdk.types.js";

type LoggerLike = {
  warn: (message: string) => void;
  error: (message: string) => void;
  log: (message: string) => void;
};

const baseNetworkConfig = {
  network: "calibration" as const,
  walletAddress: "0x0000000000000000000000000000000000000000",
  walletPrivateKey: "0xtest" as `0x${string}`,
  checkDatasetCreationFees: false,
  useOnlyApprovedProviders: false,
  minNumDataSetsForChecks: 1,
  pdpSubgraphEndpoint: "https://api.thegraph.com/subgraphs/filecoin/pdp",
  dealsPerSpPerHour: 4,
  retrievalsPerSpPerHour: 2,
  dataSetCreationsPerSpPerHour: 1,
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
} satisfies IConfig["networks"]["calibration"];

const makeProvider = (overrides: Partial<PDPProviderEx>): PDPProviderEx =>
  ({
    id: 1,
    serviceProvider: "0xprovider",
    name: "provider",
    description: "desc",
    payee: "0xpayee",
    active: true,
    isApproved: false,
    pdp: {
      serviceURL: "https://example.invalid",
      location: "loc",
    },
    ...overrides,
  }) as PDPProviderEx;

describe("WalletSdkService", () => {
  let service: WalletSdkService;
  let repoMock: { create: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  let loggerMock: LoggerLike;

  beforeEach(() => {
    repoMock = {
      create: vi.fn((data) => data),
      upsert: vi.fn(),
    };

    const configService = {
      get: vi.fn((key: keyof IConfig) => {
        if (key === "activeNetworks") return ["calibration"];
        if (key === "networks") return { calibration: baseNetworkConfig };
        return undefined;
      }),
    } as unknown as ConfigService<IConfig, true>;

    service = new WalletSdkService(configService, repoMock as any);
    loggerMock = {
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    };
    (service as any).logger = loggerMock;
  });

  it("replaces inactive duplicate with active and logs a warning", async () => {
    const inactive = makeProvider({
      id: 20n,
      isActive: false,
      serviceProvider: "0xdup",
      name: "old",
    });
    const active = makeProvider({
      id: 21n,
      isActive: true,
      serviceProvider: "0xdup",
      name: "new",
    });
    const other = makeProvider({ id: 22n, serviceProvider: "0xother" });

    await service.syncProvidersToDatabase([inactive, active, other], "calibration");

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "0xdup",
        event: "duplicate_provider_address",
        existingProviderId: 20n,
        message: "Duplicate provider address detected",
        newProviderId: 21n,
      }),
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        details: ["0xdup (providerIds: 20, 21)"],
        event: "duplicate_provider_addresses_resolved",
        message: "Duplicate provider addresses detected; replaced inactive entries with active ones",
      }),
    );
    expect(loggerMock.error).not.toHaveBeenCalled();

    const [entities, options] = repoMock.upsert.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ conflictPaths: ["address", "network"] }));
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: "0xdup", network: "calibration", providerId: 21n, name: "new" }),
        expect.objectContaining({ address: "0xother", network: "calibration", providerId: 22n }),
      ]),
    );
  });

  it("keeps active entry for mixed-status duplicates and does not log an error", async () => {
    const active = makeProvider({
      id: 30n,
      isActive: true,
      serviceProvider: "0xdup2",
      name: "active",
    });
    const inactive = makeProvider({
      id: 31n,
      isActive: false,
      serviceProvider: "0xdup2",
      name: "inactive",
    });

    await service.syncProvidersToDatabase([active, inactive], "calibration");

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "0xdup2",
        event: "duplicate_provider_address",
        existingProviderId: 30n,
        message: "Duplicate provider address detected",
        newProviderId: 31n,
      }),
    );
    expect(loggerMock.error).not.toHaveBeenCalled();

    const [entities] = repoMock.upsert.mock.calls[0];
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: "0xdup2", network: "calibration", providerId: 30n, name: "active" }),
      ]),
    );
  });

  it("keeps highest providerId for same-status duplicates and logs an error", async () => {
    const first = makeProvider({
      id: 40n,
      isActive: true,
      serviceProvider: "0xdup3",
      name: "first",
    });
    const second = makeProvider({
      id: 41n,
      isActive: true,
      serviceProvider: "0xdup3",
      name: "second",
    });

    await service.syncProvidersToDatabase([first, second], "calibration");

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "duplicate_provider_addresses_unresolved",
        message: expect.stringContaining("Duplicate provider addresses without active/inactive resolution"),
        details: expect.arrayContaining([expect.stringContaining("0xdup3")]),
      }),
    );

    const [entities] = repoMock.upsert.mock.calls[0];
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: "0xdup3", network: "calibration", providerId: 41n, name: "second" }),
      ]),
    );
  });

  it("coalesces concurrent ensureProvidersLoaded calls", async () => {
    let resolveLoad: (value: boolean) => void;
    const loadPromise = new Promise<boolean>((resolve) => {
      resolveLoad = resolve;
    });
    const loadProvidersInternal = vi.fn(() => loadPromise);
    // Inject a mock network state for calibration
    const mockState = {
      providersLoadedOnce: false,
      providersLoadPromise: null,
    };
    (service as any).networkStates.set("calibration", mockState);
    (service as any).loadProvidersInternal = loadProvidersInternal;

    const first = service.ensureProvidersLoaded("calibration");
    const second = service.ensureProvidersLoaded("calibration");

    expect(loadProvidersInternal).toHaveBeenCalledTimes(1);

    resolveLoad!(true);
    await Promise.all([first, second]);

    expect(loadProvidersInternal).toHaveBeenCalledTimes(1);
    expect(mockState.providersLoadedOnce).toBe(true);
  });

  it("retries ensureProvidersLoaded after a failed load", async () => {
    const loadProvidersInternal = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const mockState = {
      providersLoadedOnce: false,
      providersLoadPromise: null,
    };
    (service as any).networkStates.set("calibration", mockState);
    (service as any).loadProvidersInternal = loadProvidersInternal;

    await service.ensureProvidersLoaded("calibration");
    await service.ensureProvidersLoaded("calibration");

    expect(loadProvidersInternal).toHaveBeenCalledTimes(2);
    expect(mockState.providersLoadedOnce).toBe(true);
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
      await expect(service.ensureWalletAllowances("calibration")).rejects.toThrow();
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
});
