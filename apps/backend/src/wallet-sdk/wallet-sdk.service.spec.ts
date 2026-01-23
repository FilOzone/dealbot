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
  enableCDNTesting: false,
  enableIpniTesting: false,
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

  it("keeps newest entry for conflicting duplicates and logs an error", async () => {
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

    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining("conflicting active status"));

    const [entities] = repoMock.upsert.mock.calls[0];
    expect(entities).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: "0xdup2", providerId: 31, name: "inactive" })]),
    );
  });
});
