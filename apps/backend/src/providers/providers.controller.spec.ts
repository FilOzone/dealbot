import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { ProvidersController } from "./providers.controller.js";
import { ProvidersService } from "./providers.service.js";

function makeProvider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    network: "calibration",
    address: "f01234",
    providerId: 99n,
    name: "Test SP",
    description: "desc",
    payee: "0xabc",
    serviceUrl: "https://example.com",
    isActive: true,
    isApproved: false,
    location: "US",
    metadata: {},
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    deals: null,
    ...overrides,
  };
}

describe("ProvidersController", () => {
  async function setup(providers: StorageProvider[] = [makeProvider()], activeNetworks: string[] = ["calibration"]) {
    const mockService = {
      getProvidersList: vi.fn().mockResolvedValue({ providers, total: providers.length }),
    };

    const mockConfig = {
      get: vi.fn().mockImplementation((key: string) => (key === "activeNetworks" ? activeNetworks : undefined)),
    };

    const module = await Test.createTestingModule({
      controllers: [ProvidersController],
      providers: [
        { provide: ProvidersService, useValue: mockService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    return { controller: module.get(ProvidersController), service: mockService };
  }

  it("listProviders serializes BigInt providerId to string (regression: JSON.stringify crash)", async () => {
    const { controller } = await setup([makeProvider({ providerId: 12345678901234567890n })]);

    const result = await controller.listProviders(20, 0);
    const json = JSON.stringify(result);

    expect(json).toContain('"providerId":"12345678901234567890"');
  });

  it("listProviders preserves undefined providerId as-is", async () => {
    const { controller } = await setup([makeProvider({ providerId: undefined })]);

    const result = await controller.listProviders(20, 0);
    const json = JSON.stringify(result);

    // undefined fields are omitted by JSON.stringify — no crash, no providerId key
    expect(json).not.toContain('"providerId"');
  });

  it("listProviders rejects a supported-but-inactive network", async () => {
    const { controller, service } = await setup(undefined, ["calibration"]);

    // `mainnet` is in SUPPORTED_NETWORKS but not active on this instance.
    await expect(controller.listProviders(20, 0, "mainnet")).rejects.toThrow(BadRequestException);
    expect(service.getProvidersList).not.toHaveBeenCalled();
  });

  it("listProviders accepts an active network", async () => {
    const { controller, service } = await setup(undefined, ["calibration"]);

    await expect(controller.listProviders(20, 0, "calibration")).resolves.toBeDefined();
    expect(service.getProvidersList).toHaveBeenCalledWith(expect.objectContaining({ network: "calibration" }));
  });
});
