import { describe, expect, it, vi } from "vitest";
import { IpniAddonStrategy } from "./ipni.strategy.js";

describe("IpniAddonStrategy getPieceStatus", () => {
  const createStrategy = () => {
    const mockRepo = { save: vi.fn() };
    const httpClientService = {
      requestWithoutProxyAndMetrics: vi.fn(),
    };

    return {
      strategy: new IpniAddonStrategy(mockRepo as any, httpClientService as any),
      httpClientService,
    };
  };

  it("returns validated response data", async () => {
    const { strategy, httpClientService } = createStrategy();
    const payload = {
      pieceCid: "bafybeigdyrzt5p4y5pi7h3o5gq5wz2b2x2z2a2g2d2z2x2z2a2g2d",
      status: "indexed",
      indexed: true,
      advertised: false,
    };

    httpClientService.requestWithoutProxyAndMetrics.mockResolvedValueOnce({
      data: Buffer.from(JSON.stringify(payload)),
    });

    await expect((strategy as any).getPieceStatus("https://example.com", payload.pieceCid)).resolves.toEqual(payload);
  });

  it("throws on invalid response format", async () => {
    const { strategy, httpClientService } = createStrategy();

    httpClientService.requestWithoutProxyAndMetrics.mockResolvedValueOnce({
      data: Buffer.from(JSON.stringify({ foo: "bar" })),
    });

    await expect((strategy as any).getPieceStatus("https://example.com", "bafy-invalid")).rejects.toThrow(
      "Invalid piece status response format",
    );
  });

  it("throws a not-found error for 404 responses", async () => {
    const { strategy, httpClientService } = createStrategy();
    const error = {
      response: {
        status: 404,
        statusText: "Not Found",
        data: "missing",
      },
    };

    httpClientService.requestWithoutProxyAndMetrics.mockRejectedValueOnce(error);

    await expect((strategy as any).getPieceStatus("https://example.com", "bafy-404")).rejects.toThrow(
      "Piece not found or does not belong to service: missing",
    );
  });

  it("throws a detailed error for non-200 responses", async () => {
    const { strategy, httpClientService } = createStrategy();
    const error = {
      response: {
        status: 500,
        statusText: "Internal Server Error",
        data: "boom",
      },
    };

    httpClientService.requestWithoutProxyAndMetrics.mockRejectedValueOnce(error);

    await expect((strategy as any).getPieceStatus("https://example.com", "bafy-500")).rejects.toThrow(
      "Failed to get piece status: 500 Internal Server Error - boom",
    );
  });

  it("rethrows network errors", async () => {
    const { strategy, httpClientService } = createStrategy();

    httpClientService.requestWithoutProxyAndMetrics.mockRejectedValueOnce(new Error("network down"));

    await expect((strategy as any).getPieceStatus("https://example.com", "bafy-network")).rejects.toThrow(
      "network down",
    );
  });
});
