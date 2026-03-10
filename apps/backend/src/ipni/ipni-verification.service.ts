import type { ProviderInfo } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { waitForIpniProviderResults } from "filecoin-pin/core/utils";
import { CID } from "multiformats/cid";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import type { IPNIVerificationResult } from "../deal-addons/strategies/ipni.types.js";

const DEFAULT_POLL_INTERVAL_MS = 5000;
const ATTEMPT_MULTIPLIER = 2;

export type IpniVerificationInput = {
  rootCid: CID;
  blockCids?: CID[];
  storageProvider: StorageProvider;
  timeoutMs: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

@Injectable()
export class IpniVerificationService {
  private readonly logger = new Logger(IpniVerificationService.name);

  async verify({
    rootCid,
    blockCids = [],
    storageProvider,
    timeoutMs,
    pollIntervalMs,
    signal,
  }: IpniVerificationInput): Promise<IPNIVerificationResult> {
    const intervalMs = Math.max(100, pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs / ATTEMPT_MULTIPLIER));
    const expectedProviders = [this.buildExpectedProviderInfo(storageProvider)];

    const ipniVerificationStartTime = Date.now();

    const ipniValidated = await waitForIpniProviderResults(rootCid, {
      childBlocks: blockCids,
      maxAttempts,
      delayMs: intervalMs,
      expectedProviders,
      signal,
    }).catch((error) => {
      signal?.throwIfAborted();
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`IPNI verification failed: ${errorMessage}`);
      return false;
    });

    const ipniVerificationDurationMs = Date.now() - ipniVerificationStartTime;

    return {
      verified: ipniValidated ? 1 : 0,
      unverified: ipniValidated ? 0 : 1,
      total: 1,
      rootCIDVerified: ipniValidated,
      durationMs: ipniVerificationDurationMs,
      failedCIDs: ipniValidated
        ? []
        : [
            {
              cid: rootCid.toString(),
              reason: "IPNI did not return expected provider results via filecoin-pin",
            },
          ],
      verifiedAt: new Date().toISOString(),
    };
  }

  private buildExpectedProviderInfo(storageProvider: StorageProvider): ProviderInfo {
    return {
      id: storageProvider.providerId ?? (0 as number),
      serviceProvider: storageProvider.address,
      payee: storageProvider.payee,
      name: storageProvider.name,
      description: storageProvider.description,
      active: storageProvider.isActive,
      products: {
        PDP: {
          type: "PDP",
          isActive: true,
          capabilities: {},
          data: {
            serviceURL: storageProvider.serviceUrl,
          } as any,
        },
      },
    };
  }
}
