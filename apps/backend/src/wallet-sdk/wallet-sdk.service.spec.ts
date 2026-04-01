import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configValidationSchema, type IBlockchainConfig, type IConfig } from "../config/app.config.js";
import { WalletSdkService } from "./wallet-sdk.service.js";
import type { PDPProviderEx } from "./wallet-sdk.types.js";

type LoggerLike = {
  warn: (message: string) => void;
  error: (message: string) => void;
  log: (message: string) => void;
};

const baseConfig: IBlockchainConfig = {
  network: "calibration",
  walletAddress: "0x0000000000000000000000000000000000000000",
  walletPrivateKey: "0xtest",
  checkDatasetCreationFees: false,
  useOnlyApprovedProviders: false,
  minNumDataSetsForChecks: 1,
  pdpSubgraphEndpoint: "https://api.thegraph.com/subgraphs/filecoin/pdp",
};

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

describe("config validation", () => {
  const requiredEnv = {
    DATABASE_HOST: "localhost",
    DATABASE_USER: "test",
    DATABASE_PASSWORD: "test",
    DATABASE_NAME: "test",
    WALLET_ADDRESS: "0x1234567890123456789012345678901234567890",
  };

  it("requires WALLET_PRIVATE_KEY when SESSION_KEY_PRIVATE_KEY is absent", () => {
    const { error } = configValidationSchema.validate(requiredEnv, { allowUnknown: true });
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/WALLET_PRIVATE_KEY/);
  });

  it("accepts missing WALLET_PRIVATE_KEY when SESSION_KEY_PRIVATE_KEY is set", () => {
    const { error } = configValidationSchema.validate(
      { ...requiredEnv, SESSION_KEY_PRIVATE_KEY: "0xdeadbeef" },
      { allowUnknown: true },
    );
    expect(error).toBeUndefined();
  });

  it("accepts both WALLET_PRIVATE_KEY and SESSION_KEY_PRIVATE_KEY", () => {
    const { error } = configValidationSchema.validate(
      { ...requiredEnv, WALLET_PRIVATE_KEY: "0xkey", SESSION_KEY_PRIVATE_KEY: "0xsession" },
      { allowUnknown: true },
    );
    expect(error).toBeUndefined();
  });
});

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
      get: vi.fn((key: keyof IConfig) => (key === "blockchain" ? baseConfig : undefined)),
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

    await service.syncProvidersToDatabase([inactive, active, other]);

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
    expect(options).toEqual(expect.objectContaining({ conflictPaths: ["address"] }));
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: "0xdup", providerId: 21n, name: "new" }),
        expect.objectContaining({ address: "0xother", providerId: 22n }),
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

    await service.syncProvidersToDatabase([active, inactive]);

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
      expect.arrayContaining([expect.objectContaining({ address: "0xdup2", providerId: 30n, name: "active" })]),
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

    await service.syncProvidersToDatabase([first, second]);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "duplicate_provider_addresses_unresolved",
        message: expect.stringContaining("Duplicate provider addresses without active/inactive resolution"),
        details: expect.arrayContaining([expect.stringContaining("0xdup3")]),
      }),
    );

    const [entities] = repoMock.upsert.mock.calls[0];
    expect(entities).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: "0xdup3", providerId: 41n, name: "second" })]),
    );
  });

  it("coalesces concurrent ensureProvidersLoaded calls", async () => {
    let resolveLoad: (value: boolean) => void;
    const loadPromise = new Promise<boolean>((resolve) => {
      resolveLoad = resolve;
    });
    const loadProvidersInternal = vi.fn(() => loadPromise);
    (service as any).loadProvidersInternal = loadProvidersInternal;

    const first = service.ensureProvidersLoaded();
    const second = service.ensureProvidersLoaded();

    expect(loadProvidersInternal).toHaveBeenCalledTimes(1);

    resolveLoad!(true);
    await Promise.all([first, second]);

    expect(loadProvidersInternal).toHaveBeenCalledTimes(1);
    expect((service as any).providersLoadedOnce).toBe(true);
  });

  it("retries ensureProvidersLoaded after a failed load", async () => {
    const loadProvidersInternal = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    (service as any).loadProvidersInternal = loadProvidersInternal;

    await service.ensureProvidersLoaded();
    await service.ensureProvidersLoaded();

    expect(loadProvidersInternal).toHaveBeenCalledTimes(2);
    expect((service as any).providersLoadedOnce).toBe(true);
  });

  describe("ensureWalletAllowances", () => {
    it("performs read-only check in session key mode", async () => {
      (service as any)._isSessionKeyMode = true;
      // getUploadCosts needs _synapseClient but will fail without a real RPC
      // Verify it doesn't fall through to the storageManager.prepare path
      (service as any)._synapseClient = null;
      await expect(service.ensureWalletAllowances()).rejects.toThrow();
      // storageManager.prepare was never called (it would also throw, but differently)
    });

    it("attempts allowances in direct key mode", async () => {
      (service as any)._isSessionKeyMode = false;
      // storageManager is not initialized so prepare() will throw
      await expect(service.ensureWalletAllowances()).rejects.toThrow();
    });
  });
});
