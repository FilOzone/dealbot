import { CID } from "multiformats/cid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { IpniVerificationService } from "./ipni-verification.service.js";

const { waitForIpniProviderResultsMock } = vi.hoisted(() => ({
  waitForIpniProviderResultsMock: vi.fn(),
}));

vi.mock("filecoin-pin/core/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("filecoin-pin/core/utils")>();
  return {
    ...actual,
    waitForIpniProviderResults: waitForIpniProviderResultsMock,
  };
});

describe("IpniVerificationService", () => {
  const rootCid = CID.parse("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi");

  const buildStorageProvider = (overrides: Partial<StorageProvider> = {}): StorageProvider =>
    Object.assign(new StorageProvider(), {
      address: "0xsp",
      providerId: 9,
      payee: "t0100",
      name: "SP",
      description: "SP",
      isActive: true,
      serviceUrl: "https://sp.example.com",
      region: "test",
      metadata: {},
      ...overrides,
    });

  beforeEach(() => {
    vi.restoreAllMocks();
    waitForIpniProviderResultsMock.mockReset();
  });

  it("uses timeout/polling to compute full attempt budget", async () => {
    const service = new IpniVerificationService();
    waitForIpniProviderResultsMock.mockResolvedValue(true);

    const result = await service.verify({
      rootCid,
      storageProvider: buildStorageProvider(),
      timeoutMs: 10_000,
    });

    expect(result.rootCIDVerified).toBe(true);
    expect(waitForIpniProviderResultsMock).toHaveBeenCalledTimes(1);
    expect(waitForIpniProviderResultsMock).toHaveBeenCalledWith(
      rootCid,
      expect.objectContaining({
        maxAttempts: 6,
        delayMs: 2_000,
      }),
    );
  });

  it("returns false when internal verification timeout elapses", async () => {
    const service = new IpniVerificationService();
    waitForIpniProviderResultsMock.mockImplementation(
      async (_cid: CID, options: { signal?: AbortSignal } | undefined) =>
        await new Promise<boolean>((_resolve, reject) => {
          if (options?.signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );

    const result = await service.verify({
      rootCid,
      storageProvider: buildStorageProvider(),
      timeoutMs: 20,
    });

    expect(result.rootCIDVerified).toBe(false);
  });

  it("is capped by the external deal signal", async () => {
    const service = new IpniVerificationService();
    const abortController = new AbortController();
    waitForIpniProviderResultsMock.mockImplementation(
      async (_cid: CID, options: { signal?: AbortSignal } | undefined) =>
        await new Promise<boolean>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );

    const verifyPromise = service.verify({
      rootCid,
      storageProvider: buildStorageProvider(),
      timeoutMs: 60_000,
      signal: abortController.signal,
    });

    abortController.abort(new Error("deal aborted"));

    await expect(verifyPromise).rejects.toThrow("deal aborted");
  });
});
