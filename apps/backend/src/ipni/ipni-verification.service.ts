import type { ProviderInfo } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { serviceURLToMultiaddr, waitForIpniProviderResults } from "filecoin-pin/core/utils";
import { CID } from "multiformats/cid";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import type { IPNIVerificationResult } from "../deal-addons/strategies/ipni.types.js";

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
    const delayMs = Math.max(100, pollIntervalMs ?? 2000);
    // Keep retrying at the configured polling cadence until timeout or outer job cancellation.
    // add 1 to the max attempts so the max attempts is greater than the timeout.
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / delayMs) + 1);
    const expectedProviders = [this.buildExpectedProviderInfo(storageProvider)];
    const expectedMultiaddr = serviceURLToMultiaddr(storageProvider.serviceUrl);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const verificationSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let failureReason = "IPNI did not return expected provider results via filecoin-pin";

    this.logger.log({
      event: "ipni_verification_started",
      message: `IPNI verification started for root CID ${rootCid.toString()}`,
      rootCID: rootCid.toString(),
      providerAddress: storageProvider.address,
      providerId: storageProvider.providerId,
      serviceUrl: storageProvider.serviceUrl,
      expectedMultiaddr,
      blockCIDCount: blockCids.length,
      timeoutMs,
      pollIntervalMs: delayMs,
      maxAttempts,
    });

    const ipniVerificationStartTime = Date.now();

    const ipniValidated = await waitForIpniProviderResults(rootCid, {
      childBlocks: blockCids,
      maxAttempts,
      delayMs,
      expectedProviders,
      signal: verificationSignal,
    }).catch((error) => {
      if (signal?.aborted) {
        signal.throwIfAborted();
      }
      if (verificationSignal.aborted) {
        failureReason = `IPNI verification timed out after ${timeoutMs}ms`;
        this.logger.error({
          event: "ipni_verification_timed_out",
          message: failureReason,
          rootCID: rootCid.toString(),
          providerAddress: storageProvider.address,
          providerId: storageProvider.providerId,
          serviceUrl: storageProvider.serviceUrl,
          expectedMultiaddr,
          blockCIDCount: blockCids.length,
          timeoutMs,
          pollIntervalMs: delayMs,
          maxAttempts,
        });
        return false;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      failureReason = errorMessage;
      this.logger.error({
        event: "ipni_verification_failed",
        message: "IPNI verification failed",
        rootCID: rootCid.toString(),
        providerAddress: storageProvider.address,
        providerId: storageProvider.providerId,
        serviceUrl: storageProvider.serviceUrl,
        expectedMultiaddr,
        blockCIDCount: blockCids.length,
        timeoutMs,
        pollIntervalMs: delayMs,
        maxAttempts,
        failureReason,
      });
      return false;
    });

    const ipniVerificationDurationMs = Date.now() - ipniVerificationStartTime;

    if (ipniValidated) {
      this.logger.log({
        event: "ipni_verification_succeeded",
        message: `IPNI verification succeeded for root CID ${rootCid.toString()}`,
        rootCID: rootCid.toString(),
        providerAddress: storageProvider.address,
        providerId: storageProvider.providerId,
        verifyDurationMs: ipniVerificationDurationMs,
        blockCIDCount: blockCids.length,
      });
    }

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
              reason: failureReason,
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
