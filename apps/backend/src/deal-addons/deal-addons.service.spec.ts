import { describe, expect, it, vi } from "vitest";
import type { Deal } from "../database/entities/deal.entity.js";
import { ServiceType } from "../database/types.js";
import { DealAddonsService } from "./deal-addons.service.js";
import type { IDealAddon } from "./interfaces/deal-addon.interface.js";
import type { IpniAddonStrategy } from "./strategies/ipni.strategy.js";
import { AddonPriority } from "./types.js";

describe("DealAddonsService", () => {
  describe("handleStored", () => {
    it("waits for already-started onStored work to reach its abort checkpoint", async () => {
      const abortController = new AbortController();
      let finishStartedWork!: () => void;
      const startedWork = new Promise<void>((resolve) => {
        finishStartedWork = resolve;
      });

      const deal = { id: "deal-1", spAddress: "0xprovider", metadata: {} } as Deal;
      const ipniAddon = {
        name: ServiceType.IPFS_PIN,
        priority: AddonPriority.HIGH,
        isApplicable: vi.fn(),
        preprocessData: vi.fn(),
        onStored: vi.fn(async (_deal: Deal, signal?: AbortSignal) => {
          await startedWork;
          signal?.throwIfAborted();
        }),
      } satisfies IDealAddon;
      const service = new DealAddonsService(ipniAddon as unknown as IpniAddonStrategy);

      let settled = false;
      const handleStoredPromise = service
        .handleStored(deal, [ServiceType.IPFS_PIN], abortController.signal)
        .catch((error: unknown) => error)
        .finally(() => {
          settled = true;
        });

      abortController.abort(new Error("upload failed"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);

      finishStartedWork();
      await expect(handleStoredPromise).resolves.toEqual(expect.objectContaining({ message: "upload failed" }));
      expect(settled).toBe(true);
    });
  });
});
