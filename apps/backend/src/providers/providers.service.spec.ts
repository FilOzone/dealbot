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
      get: vi.fn().mockReturnValue({ ids: new Set(["123"]), addresses: new Set(["f0123"]) }),
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

  it("getProvidersList applies blocklist filters", async () => {
    const queryBuilder = repo.createQueryBuilder();
    repo.createQueryBuilder.mockReturnValue(queryBuilder);

    await service.getProvidersList();

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '("sp"."providerId" IS NULL OR "sp"."providerId" NOT IN (:...blockedIds))',
      { blockedIds: [123n] },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('LOWER("sp"."address") NOT IN (:...blockedAddresses)', {
      blockedAddresses: ["f0123"],
    });
  });

  it("getProvidersList preserves providers with null providerId when applying blocklist filters", async () => {
    const queryBuilder = repo.createQueryBuilder();
    repo.createQueryBuilder.mockReturnValue(queryBuilder);

    await service.getProvidersList();

    const providerIdFilterCall = queryBuilder.andWhere.mock.calls.find(
      ([clause]: [string, { blockedIds?: bigint[] }]) =>
        typeof clause === "string" && clause.includes('"sp"."providerId"'),
    );

    expect(providerIdFilterCall).toBeDefined();
    expect(providerIdFilterCall?.[0]).toContain('("sp"."providerId" IS NULL');
    expect(providerIdFilterCall?.[0]).toContain('"sp"."providerId" NOT IN');
    expect(providerIdFilterCall?.[1]).toEqual({ blockedIds: [123n] });
  });
});
