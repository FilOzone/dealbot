import { describe, expect, it, vi } from "vitest";
import type { Deal } from "../database/entities/deal.entity.js";
import { RetrievalAddonsService } from "./retrieval-addons.service.js";
import type { RetrievalConfiguration } from "./types.js";

describe("RetrievalAddonsService error handling", () => {
  it("captures non-Error throw messages in execution results", async () => {
    const httpClientService = {
      requestWithRandomProxyAndMetrics: vi.fn(async () => {
        throw "abort-reason";
      }),
      requestWithoutProxyAndMetrics: vi.fn(),
    };

    const strategy = {
      name: "direct",
      priority: 1,
      canHandle: () => true,
      constructUrl: () => ({
        url: "http://example.com",
        method: "direct",
      }),
    };

    const noop = (name: string) => ({
      name,
      priority: 2,
      canHandle: () => false,
      constructUrl: vi.fn(),
    });

    const service = new RetrievalAddonsService(
      strategy as unknown as ConstructorParameters<typeof RetrievalAddonsService>[0],
      noop("cdn") as unknown as ConstructorParameters<typeof RetrievalAddonsService>[1],
      noop("ipni") as unknown as ConstructorParameters<typeof RetrievalAddonsService>[2],
      httpClientService as unknown as ConstructorParameters<typeof RetrievalAddonsService>[3],
    );

    const config: RetrievalConfiguration = {
      deal: {
        id: "deal-1",
        spAddress: "0xsp",
        walletAddress: "0xwallet",
        fileName: "file.txt",
        fileSize: 1,
      } as Deal,
      walletAddress: "0xwallet",
      storageProvider: "0xsp",
    };

    const result = await service.testAllRetrievalMethods(config);

    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toBe("abort-reason");
  });
});
