import { waitForIpniProviderResults } from "filecoin-pin/core/utils";
import { CID } from "multiformats/cid";
import { describe, expect, it, vi } from "vitest";
import { IpniAddonStrategy } from "./ipni.strategy.js";

vi.mock("filecoin-pin/core/utils", () => ({
  waitForIpniProviderResults: vi.fn(),
}));

describe("IpniAddonStrategy getPieceStatus", () => {
  const createStrategy = () => {
    const mockRepo = { save: vi.fn() };
    const httpClientService = {
      requestWithoutProxyAndMetrics: vi.fn(),
    };
    const spIndexLocallyMs = { observe: vi.fn() };
    const spAnnounceAdvertisementMs = { observe: vi.fn() };
    const ipniVerifyMs = { observe: vi.fn() };
    const discoverabilityStatusCounter = { inc: vi.fn() };

    return {
      strategy: new IpniAddonStrategy(
        mockRepo as any,
        httpClientService as any,
        spIndexLocallyMs as any,
        spAnnounceAdvertisementMs as any,
        ipniVerifyMs as any,
        discoverabilityStatusCounter as any,
      ),
      httpClientService,
      spIndexLocallyMs,
      spAnnounceAdvertisementMs,
      ipniVerifyMs,
      discoverabilityStatusCounter,
      mockRepo,
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

  it("emits discoverability metrics when IPNI verification succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    try {
      const {
        strategy,
        spIndexLocallyMs,
        spAnnounceAdvertisementMs,
        ipniVerifyMs,
        discoverabilityStatusCounter,
        mockRepo,
      } = createStrategy();

      const uploadEndTime = new Date("2026-01-01T00:00:00Z");
      const indexedAt = new Date(uploadEndTime.getTime() + 1000).toISOString();
      const advertisedAt = new Date(uploadEndTime.getTime() + 2000).toISOString();

      vi.spyOn(strategy as any, "monitorPieceStatus").mockResolvedValue({
        success: true,
        finalStatus: {
          status: "ok",
          indexed: true,
          advertised: true,
          indexedAt,
          advertisedAt,
        },
        checks: 1,
        durationMs: 2000,
      });

      vi.mocked(waitForIpniProviderResults).mockImplementation(async () => {
        vi.advanceTimersByTime(1500);
        return true;
      });

      const deal = {
        id: "deal-1",
        spAddress: "0xsp",
        uploadEndTime,
        pieceCid: "bafk-piece",
        metadata: {
          ipfs_pin: {
            rootCID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
            blockCIDs: ["bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"],
          },
        },
        storageProvider: {
          providerId: 9,
          isApproved: true,
          serviceUrl: "http://sp.example.com",
          payee: "t0100",
          name: "SP",
          description: "SP",
          isActive: true,
        },
      } as any;

      const result = await (strategy as any).monitorAndVerifyIPNI(
        "http://sp.example.com",
        deal,
        [CID.parse(deal.metadata.ipfs_pin.rootCID)],
        deal.metadata.ipfs_pin.rootCID,
        deal.storageProvider,
        10_000,
        10_000,
        1000,
      );

      await (strategy as any).updateDealWithIpniMetrics(deal, result);

      const labels = {
        checkType: "dataStorage",
        providerId: "9",
        providerStatus: "approved",
      };

      expect(spIndexLocallyMs.observe).toHaveBeenCalledWith(labels, 1000);
      expect(spAnnounceAdvertisementMs.observe).toHaveBeenCalledWith(labels, 2000);
      expect(ipniVerifyMs.observe).toHaveBeenCalledWith(labels, 1500);
      expect(discoverabilityStatusCounter.inc).toHaveBeenCalledWith({ ...labels, value: "sp_indexed" });
      expect(discoverabilityStatusCounter.inc).toHaveBeenCalledWith({
        ...labels,
        value: "sp_announced_advertisement",
      });
      expect(discoverabilityStatusCounter.inc).toHaveBeenCalledWith({ ...labels, value: "success" });

      expect(mockRepo.save).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
