import { Injectable, Logger } from "@nestjs/common";
import { serviceURLToMultiaddr, waitForIpniProviderResults } from "filecoin-pin/core/utils";
import { CID } from "multiformats/cid";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import type { IPNIVerificationResult } from "../deal-addons/strategies/ipni.types.js";
import { PDPProvider } from "filecoin-pin";

export type IpniVerificationInput = {
  rootCid: CID;
  blockCids?: CID[];
  storageProvider: StorageProvider;
  timeoutMs: number;
  pollIntervalMs: number;
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
    const delayMs = Math.max(100, pollIntervalMs);
    // Keep retrying at the configured polling cadence until timeout or outer job cancellation.
    // waitForIpniProviderResults uses attempt-then-delay: the first attempt is immediate,
    // so N attempts span only (N-1) delays. Adding 1 ensures the attempt budget covers
    // the full timeout window rather than falling short by up to one delayMs interval.
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / delayMs) + 1);
    const expectedProviders = [this.buildExpectedProviderInfo(storageProvider)];
    const expectedMultiaddr = serviceURLToMultiaddr(storageProvider.serviceUrl);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const verificationSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let failureReason = "IPNI did not return expected provider results via filecoin-pin";

    this.logger.log({
      event: "ipni_verification_started",
      message: "IPNI verification started",
      rootCID: rootCid.toString(),
      providerAddress: storageProvider.address,
      providerId: storageProvider.providerId,
      providerName: storageProvider.name,
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
          providerName: storageProvider.name,
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
        providerName: storageProvider.name,
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
        message: "IPNI verification succeeded",
        rootCID: rootCid.toString(),
        providerAddress: storageProvider.address,
        providerId: storageProvider.providerId,
        providerName: storageProvider.name,
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

  private buildExpectedProviderInfo(storageProvider: StorageProvider): PDPProvider {
    return {
      id: storageProvider.providerId ?? 0n,
      serviceProvider: storageProvider.address as `0x${string}`,
      payee: storageProvider.payee as `0x${string}`,
      name: storageProvider.name,
      description: storageProvider.description,
      isActive: storageProvider.isActive,
      pdp: { // TODO
        serviceURL: storageProvider.serviceUrl,
        minPieceSizeInBytes: 0n,
        maxPieceSizeInBytes: 0n,
        storagePricePerTibPerDay: 0n,
        minProvingPeriodInEpochs: 0n,
        location: 'todo',
        paymentTokenAddress: '0x',
        ipniPiece: true,
        ipniIpfs: true,
      },
    };
  }
}
