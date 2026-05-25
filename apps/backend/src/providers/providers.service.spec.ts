import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { ProvidersService } from "./providers.service.js";

describe("ProvidersService", () => {
  let service: ProvidersService;
  let repo: any;
  let configService: any;

  beforeEach(async () => {
    repo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        andWhere: vi.fn().mockReturnThis(),
        getCount: vi.fn().mockResolvedValue(0),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
      }),
    };

    configService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === "networks") {
          return {
            calibration: {
              blockedSpIds: new Set(["123"]),
              blockedSpAddresses: new Set(["f0123"]),
            },
          };
        }
        if (key === "activeNetworks") {
          return ["calibration"];
        }
        return undefined;
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProvidersService,
        { provide: getRepositoryToken(StorageProvider), useValue: repo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ProvidersService>(ProvidersService);
  });

  it("getProvidersList applies per-network blocklist filters", async () => {
    const queryBuilder = repo.createQueryBuilder();
    repo.createQueryBuilder.mockReturnValue(queryBuilder);

    await service.getProvidersList();

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '("sp"."providerId" IS NULL OR NOT ("sp"."network" = :network_calibration AND "sp"."providerId" IN (:...blockedIds_calibration)))',
      { network_calibration: "calibration", blockedIds_calibration: [123n] },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'NOT ("sp"."network" = :network_calibration AND LOWER("sp"."address") IN (:...blockedAddresses_calibration))',
      { network_calibration: "calibration", blockedAddresses_calibration: ["f0123"] },
    );
  });

  it("getProvidersList preserves providers with null providerId when applying blocklist filters", async () => {
    const queryBuilder = repo.createQueryBuilder();
    repo.createQueryBuilder.mockReturnValue(queryBuilder);

    await service.getProvidersList();

    const providerIdFilterCall = queryBuilder.andWhere.mock.calls.find(
      ([clause]: [string]) => typeof clause === "string" && clause.includes('"sp"."providerId"'),
    );

    expect(providerIdFilterCall).toBeDefined();
    expect(providerIdFilterCall?.[0]).toContain('("sp"."providerId" IS NULL');
    expect(providerIdFilterCall?.[0]).toContain('"sp"."providerId" IN');
    expect(providerIdFilterCall?.[1]).toMatchObject({ blockedIds_calibration: [123n] });
  });
});
