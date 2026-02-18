import * as dagPB from "@ipld/dag-pb";
import { encode } from "multiformats/block";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { create as createDigest } from "multiformats/hashes/digest";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it, vi } from "vitest";
import type { Deal } from "../../database/entities/deal.entity.js";
import { ServiceType } from "../../database/types.js";
import { IpfsBlockRetrievalStrategy } from "./ipfs-block.strategy.js";

/** Build a raw leaf block from arbitrary bytes */
async function makeRawBlock(data: Uint8Array) {
  return encode({ value: data, codec: raw, hasher: sha256 });
}

/** Build a dag-pb node linking to the given CIDs */
async function makeDagPbBlock(links: CID[]) {
  const value = dagPB.prepare({
    Data: new Uint8Array([0x08, 0x02]), // UnixFS file header (minimal)
    Links: links.map((cid, i) => ({ Hash: cid, Name: `link-${i}` })),
  });
  return encode({ value, codec: dagPB, hasher: sha256 });
}

function cidFromUrl(url: string): string {
  return url.split("/ipfs/")[1].split("?")[0];
}

function createStrategy() {
  const httpClientService = {
    requestWithMetrics: vi.fn(),
  };

  const walletSdkService = {
    getProviderInfo: vi.fn().mockReturnValue({
      products: {
        PDP: { data: { serviceURL: "https://sp.example.com" } },
      },
    }),
  };

  const configService = {
    get: vi.fn().mockReturnValue({ ipfsBlockFetchConcurrency: 2 }),
  };

  const strategy = new IpfsBlockRetrievalStrategy(
    walletSdkService as any,
    httpClientService as any,
    configService as any,
  );

  return { strategy, httpClientService, walletSdkService };
}

function mockDealConfig(rootCID: string) {
  const deal = {
    id: "test-deal-1",
    metadata: {
      [ServiceType.IPFS_PIN]: {
        enabled: true,
        rootCID,
        blockCIDs: [],
        blockCount: 0,
        carSize: 0,
        originalSize: 0,
      },
    },
  } as unknown as Deal;

  return {
    deal,
    walletAddress: "0x1234" as any,
    storageProvider: "0x5678" as any,
  };
}

describe("IpfsBlockRetrievalStrategy", () => {
  describe("canHandle", () => {
    it("returns true when IPNI is enabled and rootCID present", () => {
      const { strategy } = createStrategy();
      expect(strategy.canHandle(mockDealConfig("bafyroot"))).toBe(true);
    });

    it("returns false when IPNI is not enabled", () => {
      const { strategy } = createStrategy();
      const config = mockDealConfig("bafyroot");
      config.deal = { ...config.deal, id: "d1", metadata: {} };
      expect(strategy.canHandle(config as any)).toBe(false);
    });
  });

  describe("validateByBlockFetch", () => {
    it("validates a simple DAG: root dag-pb + two raw leaves", async () => {
      const { strategy, httpClientService } = createStrategy();

      const leaf1 = await makeRawBlock(new Uint8Array([1, 2, 3]));
      const leaf2 = await makeRawBlock(new Uint8Array([4, 5, 6]));
      const root = await makeDagPbBlock([leaf1.cid, leaf2.cid]);

      const blockMap = new Map<string, Uint8Array>([
        [root.cid.toString(), root.bytes],
        [leaf1.cid.toString(), leaf1.bytes],
        [leaf2.cid.toString(), leaf2.bytes],
      ]);

      httpClientService.requestWithMetrics.mockImplementation(async (url: string) => {
        const cidStr = cidFromUrl(url);
        const bytes = blockMap.get(cidStr);
        if (!bytes) throw new Error(`Not found: ${cidStr}`);
        return {
          data: Buffer.from(bytes),
          metrics: { statusCode: 200, ttfb: 10 },
        };
      });

      const config = mockDealConfig(root.cid.toString());
      const result = await strategy.validateByBlockFetch(config);

      expect(result.isValid).toBe(true);
      expect(result.method).toBe("block-fetch");
      expect(result.bytesRead).toBe(root.bytes.length + leaf1.bytes.length + leaf2.bytes.length);
      expect(result.ttfb).toBe(10);
    });

    it("detects hash mismatch (corrupted block bytes)", async () => {
      const { strategy, httpClientService } = createStrategy();

      const leaf = await makeRawBlock(new Uint8Array([1, 2, 3]));
      const root = await makeDagPbBlock([leaf.cid]);

      const corruptLeafBytes = new Uint8Array(leaf.bytes);
      corruptLeafBytes[0] ^= 0xff;

      httpClientService.requestWithMetrics.mockImplementation(async (url: string) => {
        const cidStr = cidFromUrl(url);
        let bytes: Uint8Array;
        if (cidStr === root.cid.toString()) {
          bytes = root.bytes;
        } else {
          bytes = corruptLeafBytes;
        }
        return {
          data: Buffer.from(bytes),
          metrics: { statusCode: 200, ttfb: 5 },
        };
      });

      const config = mockDealConfig(root.cid.toString());
      const result = await strategy.validateByBlockFetch(config);

      expect(result.isValid).toBe(false);
      expect(result.details).toContain("failed");
    });

    it("fails on HTTP error for a block", async () => {
      const { strategy, httpClientService } = createStrategy();

      const leaf = await makeRawBlock(new Uint8Array([1, 2, 3]));
      const root = await makeDagPbBlock([leaf.cid]);

      httpClientService.requestWithMetrics.mockImplementation(async (url: string) => {
        const cidStr = cidFromUrl(url);
        if (cidStr === root.cid.toString()) {
          return {
            data: Buffer.from(root.bytes),
            metrics: { statusCode: 200, ttfb: 5 },
          };
        }
        return { data: Buffer.alloc(0), metrics: { statusCode: 404, ttfb: 0 } };
      });

      const config = mockDealConfig(root.cid.toString());
      const result = await strategy.validateByBlockFetch(config);

      expect(result.isValid).toBe(false);
      expect(result.details).toContain("failed");
    });

    it("rejects unsupported hash algorithm", async () => {
      const { strategy, httpClientService } = createStrategy();

      // Create a valid block then re-encode the CID with blake2b-256 (0xb220) multihash code
      const leaf = await makeRawBlock(new Uint8Array([1, 2, 3]));
      const blake2bMultihash = createDigest(0xb220, leaf.cid.multihash.digest);
      const fakeCid = CID.createV1(raw.code, blake2bMultihash);

      const root = await makeDagPbBlock([fakeCid]);

      httpClientService.requestWithMetrics.mockImplementation(async (url: string) => {
        const cidStr = cidFromUrl(url);
        const bytes = cidStr === root.cid.toString() ? root.bytes : leaf.bytes;
        return {
          data: Buffer.from(bytes),
          metrics: { statusCode: 200, ttfb: 5 },
        };
      });

      const config = mockDealConfig(root.cid.toString());
      const result = await strategy.validateByBlockFetch(config);

      expect(result.isValid).toBe(false);
      expect(result.details).toContain("failed");
    });

    it("deduplicates blocks referenced by multiple parents", async () => {
      const { strategy, httpClientService } = createStrategy();

      const shared = await makeRawBlock(new Uint8Array([1, 2, 3]));
      const parent1 = await makeDagPbBlock([shared.cid]);
      const parent2 = await makeDagPbBlock([shared.cid]);
      const root = await makeDagPbBlock([parent1.cid, parent2.cid]);

      const blockMap = new Map<string, Uint8Array>([
        [root.cid.toString(), root.bytes],
        [parent1.cid.toString(), parent1.bytes],
        [parent2.cid.toString(), parent2.bytes],
        [shared.cid.toString(), shared.bytes],
      ]);

      httpClientService.requestWithMetrics.mockImplementation(async (url: string) => {
        const cidStr = cidFromUrl(url);
        const bytes = blockMap.get(cidStr);
        if (!bytes) throw new Error(`Not found: ${cidStr}`);
        return {
          data: Buffer.from(bytes),
          metrics: { statusCode: 200, ttfb: 5 },
        };
      });

      const config = mockDealConfig(root.cid.toString());
      const result = await strategy.validateByBlockFetch(config);

      expect(result.isValid).toBe(true);
      // Shared block fetched once, not twice
      const fetchedCids = httpClientService.requestWithMetrics.mock.calls.map((call: any[]) => cidFromUrl(call[0]));
      const sharedFetches = fetchedCids.filter((c: string) => c === shared.cid.toString());
      expect(sharedFetches).toHaveLength(1);
    });

    it("returns missing metadata result when rootCID absent", async () => {
      const { strategy } = createStrategy();
      const config = mockDealConfig("bafyroot");
      const ipniMetadata = config.deal.metadata?.[ServiceType.IPFS_PIN];
      if (ipniMetadata) {
        delete (ipniMetadata as Partial<typeof ipniMetadata>).rootCID;
      }

      const result = await strategy.validateByBlockFetch(config as any);

      expect(result.isValid).toBe(false);
      expect(result.method).toBe("metadata-missing");
    });
  });
});
