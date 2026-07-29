import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "../../database/entities/storage-provider.entity.js";
import type { PDPProviderEx } from "../../wallet-sdk/wallet-sdk.types.js";
import { StorageProviderRepository } from "./storage-provider.repository.js";

function makeRow(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    address: "0xprovider",
    network: "calibration",
    providerId: 7n,
    name: "provider",
    description: "desc",
    payee: "0xpayee",
    serviceUrl: "https://example.invalid",
    isActive: true,
    isApproved: false,
    location: "loc",
    metadata: {
      serviceURL: "https://example.invalid",
      location: "loc",
      minPieceSizeInBytes: "127",
      maxPieceSizeInBytes: "1065353216",
      storagePricePerTibPerDay: "1000000000000000000",
      minProvingPeriodInEpochs: "2880",
      paymentTokenAddress: "0xtoken",
      ipniPiece: true,
      ipniIpfs: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    deals: null,
    ...overrides,
  } as StorageProvider;
}

function makeProvider(overrides: Partial<PDPProviderEx> = {}): PDPProviderEx {
  return {
    id: 1n,
    serviceProvider: "0xprovider",
    name: "provider",
    description: "desc",
    payee: "0xpayee",
    isActive: true,
    isApproved: false,
    pdp: { serviceURL: "https://example.invalid", location: "loc" },
    ...overrides,
  } as PDPProviderEx;
}

describe("StorageProviderRepository", () => {
  describe("findByAddress", () => {
    it("returns undefined when no row matches", async () => {
      const repo = { findOne: vi.fn().mockResolvedValue(null) };
      const service = new StorageProviderRepository(repo as any, {} as any);

      const result = await service.findByAddress("0xmissing", "calibration");

      expect(result).toBeUndefined();
      expect(repo.findOne).toHaveBeenCalledWith({ where: { address: "0xmissing", network: "calibration" } });
    });

    it("hydrates a row into a PDPProviderEx, restoring bigint pdp fields", async () => {
      const row = makeRow();
      const repo = { findOne: vi.fn().mockResolvedValue(row) };
      const service = new StorageProviderRepository(repo as any, {} as any);

      const result = await service.findByAddress("0xprovider", "calibration");

      expect(result).toEqual(
        expect.objectContaining({
          id: 7n,
          serviceProvider: "0xprovider",
          name: "provider",
          description: "desc",
          payee: "0xpayee",
          isActive: true,
          isApproved: false,
        }),
      );
      expect(result?.pdp).toEqual(
        expect.objectContaining({
          serviceURL: "https://example.invalid",
          location: "loc",
          minPieceSizeInBytes: 127n,
          maxPieceSizeInBytes: 1065353216n,
          storagePricePerTibPerDay: 1000000000000000000n,
          minProvingPeriodInEpochs: 2880n,
          ipniPiece: true,
          ipniIpfs: true,
        }),
      );
    });
  });

  describe("findTestingProviders", () => {
    const makeConfigService = (useOnlyApprovedProviders: boolean) =>
      ({
        get: vi.fn(() => ({ calibration: { useOnlyApprovedProviders } })),
      }) as any;

    it("filters by isActive only when useOnlyApprovedProviders is false", async () => {
      const repo = { find: vi.fn().mockResolvedValue([makeRow()]) };
      const service = new StorageProviderRepository(repo as any, makeConfigService(false));

      await service.findTestingProviders("calibration");

      expect(repo.find).toHaveBeenCalledWith({ where: { network: "calibration", isActive: true } });
    });

    it("also filters by isApproved when useOnlyApprovedProviders is true", async () => {
      const repo = { find: vi.fn().mockResolvedValue([]) };
      const service = new StorageProviderRepository(repo as any, makeConfigService(true));

      await service.findTestingProviders("calibration");

      expect(repo.find).toHaveBeenCalledWith({
        where: { network: "calibration", isActive: true, isApproved: true },
      });
    });
  });

  describe("countByNetwork", () => {
    it("delegates to the repository count", async () => {
      const repo = { count: vi.fn().mockResolvedValue(3) };
      const service = new StorageProviderRepository(repo as any, {} as any);

      const result = await service.countByNetwork("mainnet");

      expect(result).toBe(3);
      expect(repo.count).toHaveBeenCalledWith({ where: { network: "mainnet" } });
    });
  });

  describe("countActiveByNetwork", () => {
    it("counts active providers for the network", async () => {
      const repo = { count: vi.fn().mockResolvedValue(5) };
      const service = new StorageProviderRepository(repo as any, {} as any);

      const result = await service.countActiveByNetwork("mainnet");

      expect(result).toBe(5);
      expect(repo.count).toHaveBeenCalledWith({ where: { network: "mainnet", isActive: true } });
    });
  });

  describe("countTestedByNetwork", () => {
    const makeConfigService = (useOnlyApprovedProviders: boolean) =>
      ({
        get: vi.fn(() => ({ calibration: { useOnlyApprovedProviders } })),
      }) as any;

    it("counts active providers only when useOnlyApprovedProviders is false", async () => {
      const repo = { count: vi.fn().mockResolvedValue(4) };
      const service = new StorageProviderRepository(repo as any, makeConfigService(false));

      const result = await service.countTestedByNetwork("calibration");

      expect(result).toBe(4);
      expect(repo.count).toHaveBeenCalledWith({ where: { network: "calibration", isActive: true } });
    });

    it("also counts by isApproved when useOnlyApprovedProviders is true", async () => {
      const repo = { count: vi.fn().mockResolvedValue(2) };
      const service = new StorageProviderRepository(repo as any, makeConfigService(true));

      const result = await service.countTestedByNetwork("calibration");

      expect(result).toBe(2);
      expect(repo.count).toHaveBeenCalledWith({
        where: { network: "calibration", isActive: true, isApproved: true },
      });
    });
  });

  describe("findActiveAddresses", () => {
    const makeConfigService = (useOnlyApprovedProviders: boolean) =>
      ({
        get: vi.fn(() => ({ calibration: { useOnlyApprovedProviders } })),
      }) as any;

    it("projects address and providerId for active providers", async () => {
      const repo = {
        find: vi.fn().mockResolvedValue([
          { address: "0xa", providerId: 1n },
          { address: "0xb", providerId: null },
        ]),
      };
      const service = new StorageProviderRepository(repo as any, makeConfigService(false));

      const result = await service.findActiveAddresses("calibration");

      expect(repo.find).toHaveBeenCalledWith({
        select: { address: true, providerId: true },
        where: { network: "calibration", isActive: true },
      });
      expect(result).toEqual([
        { address: "0xa", providerId: 1n },
        { address: "0xb", providerId: null },
      ]);
    });

    it("also filters by isApproved when useOnlyApprovedProviders is true", async () => {
      const repo = { find: vi.fn().mockResolvedValue([]) };
      const service = new StorageProviderRepository(repo as any, makeConfigService(true));

      await service.findActiveAddresses("calibration");

      expect(repo.find).toHaveBeenCalledWith({
        select: { address: true, providerId: true },
        where: { network: "calibration", isActive: true, isApproved: true },
      });
    });
  });

  describe("findEntityByAddress", () => {
    it("returns null when no row matches", async () => {
      const repo = { findOne: vi.fn().mockResolvedValue(null) };
      const service = new StorageProviderRepository(repo as any, {} as any);

      const result = await service.findEntityByAddress("0xmissing", "calibration");

      expect(result).toBeNull();
      expect(repo.findOne).toHaveBeenCalledWith({ where: { address: "0xmissing", network: "calibration" } });
    });

    it("returns the raw entity untouched (no hydration)", async () => {
      const row = makeRow();
      const repo = { findOne: vi.fn().mockResolvedValue(row) };
      const service = new StorageProviderRepository(repo as any, {} as any);

      const result = await service.findEntityByAddress("0xprovider", "calibration");

      expect(result).toBe(row);
    });
  });

  describe("findByAddressesCaseInsensitive", () => {
    it("returns an empty array without querying when given no addresses", async () => {
      const repo = { find: vi.fn() };
      const service = new StorageProviderRepository(repo as any, {} as any);

      const result = await service.findByAddressesCaseInsensitive([], "calibration");

      expect(result).toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it("queries with a case-insensitive LOWER() match and a narrow projection", async () => {
      const rows = [{ address: "0xprovider", providerId: 7n, name: "provider", isApproved: false }];
      const repo = { find: vi.fn().mockResolvedValue(rows) };
      const service = new StorageProviderRepository(repo as any, {} as any);

      const result = await service.findByAddressesCaseInsensitive(["0xProvider"], "calibration");

      expect(result).toBe(rows);
      const [{ where, select }] = repo.find.mock.calls[0];
      expect(select).toEqual(["address", "providerId", "name", "isApproved"]);
      expect(where.network).toBe("calibration");
      expect(where.address).toEqual(
        expect.objectContaining({
          _type: "raw",
          _objectLiteralParameters: { addresses: ["0xProvider"] },
        }),
      );
    });
  });

  describe("upsertFromRegistry", () => {
    let repo: { create: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
    let service: StorageProviderRepository;
    let loggerMock: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      repo = { create: vi.fn((data) => data), upsert: vi.fn() };
      service = new StorageProviderRepository(repo as any, {} as any);
      loggerMock = { warn: vi.fn(), error: vi.fn() };
      (service as any).logger = loggerMock;
    });

    it("replaces inactive duplicate with active and logs a warning", async () => {
      const inactive = makeProvider({ id: 20n, isActive: false, serviceProvider: "0xdup", name: "old" });
      const active = makeProvider({ id: 21n, isActive: true, serviceProvider: "0xdup", name: "new" });
      const other = makeProvider({ id: 22n, serviceProvider: "0xother" });

      await service.upsertFromRegistry([inactive, active, other], "calibration");

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          address: "0xdup",
          event: "duplicate_provider_address",
          existingProviderId: 20n,
          newProviderId: 21n,
        }),
      );
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "duplicate_provider_addresses_resolved" }),
      );
      expect(loggerMock.error).not.toHaveBeenCalled();

      const [entities, options] = repo.upsert.mock.calls[0];
      expect(options).toEqual(expect.objectContaining({ conflictPaths: ["address", "network"] }));
      expect(entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ address: "0xdup", network: "calibration", providerId: 21n, name: "new" }),
          expect.objectContaining({ address: "0xother", network: "calibration", providerId: 22n }),
        ]),
      );
    });

    it("keeps active entry for mixed-status duplicates and does not log an error", async () => {
      const active = makeProvider({ id: 30n, isActive: true, serviceProvider: "0xdup2", name: "active" });
      const inactive = makeProvider({ id: 31n, isActive: false, serviceProvider: "0xdup2", name: "inactive" });

      await service.upsertFromRegistry([active, inactive], "calibration");

      expect(loggerMock.error).not.toHaveBeenCalled();
      const [entities] = repo.upsert.mock.calls[0];
      expect(entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ address: "0xdup2", network: "calibration", providerId: 30n, name: "active" }),
        ]),
      );
    });

    it("keeps highest providerId for same-status duplicates and logs an error", async () => {
      const first = makeProvider({ id: 40n, isActive: true, serviceProvider: "0xdup3", name: "first" });
      const second = makeProvider({ id: 41n, isActive: true, serviceProvider: "0xdup3", name: "second" });

      await service.upsertFromRegistry([first, second], "calibration");

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: "duplicate_provider_addresses_unresolved" }),
      );
      const [entities] = repo.upsert.mock.calls[0];
      expect(entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ address: "0xdup3", network: "calibration", providerId: 41n, name: "second" }),
        ]),
      );
    });
  });
});
