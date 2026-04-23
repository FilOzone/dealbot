import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { describe, expect, it, vi, beforeEach } from "vitest";
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
      "sp.providerId NOT IN (:...blockedIds)",
      { blockedIds: [123n] }
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "sp.address NOT IN (:...blockedAddresses)",
      { blockedAddresses: ["f0123"] }
    );
  });
});
