import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { WalletSdkService } from "./wallet-sdk.service.js";
import type { ProviderInfoEx } from "./wallet-sdk.types.js";

type LoggerLike = {
  warn: (message: string) => void;
  error: (message: string) => void;
  log: (message: string) => void;
};

const baseConfig: IBlockchainConfig = {
  network: "calibration",
  walletAddress: "0x0000000000000000000000000000000000000000",
  walletPrivateKey: "test",
  checkDatasetCreationFees: false,
  useOnlyApprovedProviders: false,
  enableIpniTesting: "always",
  minNumDataSetsForChecks: 1,
};

const makeProvider = (overrides: Partial<ProviderInfoEx>): ProviderInfoEx =>
  ({
    id: 1,
    serviceProvider: "0xprovider",
    name: "provider",
    description: "desc",
    payee: "0xpayee",
    active: true,
    isApproved: false,
    products: {
      PDP: {
        data: {
          serviceURL: "https://example.invalid",
          location: "loc",
        },
        capabilities: {},
      },
    },
    ...overrides,
  }) as ProviderInfoEx;

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
      id: 20,
      active: false,
      serviceProvider: "0xdup",
      name: "old",
    });
    const active = makeProvider({
      id: 21,
      active: true,
      serviceProvider: "0xdup",
      name: "new",
    });
    const other = makeProvider({ id: 22, serviceProvider: "0xother" });

    await service.syncProvidersToDatabase([inactive, active, other]);

    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("Duplicate provider address 0xdup"));
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("replaced inactive entries with active ones"));
    expect(loggerMock.error).not.toHaveBeenCalled();

    const [entities, options] = repoMock.upsert.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ conflictPaths: ["address"] }));
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: "0xdup", providerId: 21, name: "new" }),
        expect.objectContaining({ address: "0xother", providerId: 22 }),
      ]),
    );
  });

  it("keeps active entry for mixed-status duplicates and does not log an error", async () => {
    const active = makeProvider({
      id: 30,
      active: true,
      serviceProvider: "0xdup2",
      name: "active",
    });
    const inactive = makeProvider({
      id: 31,
      active: false,
      serviceProvider: "0xdup2",
      name: "inactive",
    });

    await service.syncProvidersToDatabase([active, inactive]);

    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("Duplicate provider address 0xdup2"));
    expect(loggerMock.error).not.toHaveBeenCalled();

    const [entities] = repoMock.upsert.mock.calls[0];
    expect(entities).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: "0xdup2", providerId: 30, name: "active" })]),
    );
  });

  it("keeps highest providerId for same-status duplicates and logs an error", async () => {
    const first = makeProvider({
      id: 40,
      active: true,
      serviceProvider: "0xdup3",
      name: "first",
    });
    const second = makeProvider({
      id: 41,
      active: true,
      serviceProvider: "0xdup3",
      name: "second",
    });

    await service.syncProvidersToDatabase([first, second]);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("Duplicate provider addresses without active/inactive resolution"),
    );

    const [entities] = repoMock.upsert.mock.calls[0];
    expect(entities).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: "0xdup3", providerId: 41, name: "second" })]),
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
});
