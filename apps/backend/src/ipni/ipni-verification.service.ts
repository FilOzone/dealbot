import { Injectable, Logger } from "@nestjs/common";
import { PDPProvider } from "filecoin-pin";
import { waitForIpniProviderResults } from "filecoin-pin/core/utils";
import { CID } from "multiformats/cid";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import type { FailedCID, IPNIVerificationResult } from "../deal-addons/strategies/ipni.types.js";

export type IpniVerificationInput = {
  rootCid: CID;
  blockCids?: CID[];
  storageProvider: StorageProvider;
  timeoutMs: number;
  pollIntervalMs: number;
  signal?: AbortSignal;
};

type StorageProviderWithUrl = Omit<StorageProvider, "serviceUrl"> & {
  serviceUrl: string;
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
    const serviceUrl = storageProvider.serviceUrl;
    if (!serviceUrl) {
      throw new Error(`IPNI verification failed: missing service URL for provider ${storageProvider.address}`);
    }

    // Keep retrying at the configured polling cadence until timeout or outer job cancellation.
    // waitForIpniProviderResults uses attempt-then-delay: the first attempt is immediate,
    // so N attempts span only (N-1) delays. Adding 1 ensures the attempt budget covers
    // the full timeout window rather than falling short by up to one delayMs interval.
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / delayMs) + 1);
    const expectedProviders = [this.buildExpectedProviderInfo(storageProvider as StorageProviderWithUrl)];
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const verificationSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    this.logger.log({
      event: "ipni_verification_started",
      message: "IPNI verification started",
      rootCID: rootCid.toString(),
      providerAddress: storageProvider.address,
      providerId: storageProvider.providerId,
      providerName: storageProvider.name,
      serviceUrl: storageProvider.serviceUrl,
      blockCIDCount: blockCids.length,
      timeoutMs,
      pollIntervalMs: delayMs,
      maxAttempts,
    });

    const ipniVerificationStartTime = Date.now();
    const cidsToValidate: { cid: CID; isRoot: boolean }[] = [
      { cid: rootCid, isRoot: true },
      ...blockCids.map((cid) => ({ cid, isRoot: false })),
    ];

    let verified = 0;
    const failedCIDs: FailedCID[] = [];
    let rootCIDVerified = false;

    // waitForIpniProviderResults is all-or-nothing per call (throws on first failure),
    // so we invoke it once per CID to get accurate per-CID verified/unverified counts.
    // The shared verificationSignal bounds total wall-clock time across all CIDs.
    for (const { cid, isRoot } of cidsToValidate) {
      if (signal?.aborted) {
        signal.throwIfAborted();
      }

      if (verificationSignal.aborted) {
        failedCIDs.push({ cid: cid.toString(), reason: `IPNI verification timed out after ${timeoutMs}ms` });
        continue;
      }

      try {
        await waitForIpniProviderResults(cid, {
          maxAttempts,
          delayMs,
          expectedProviders,
          signal: verificationSignal,
        });
        verified += 1;
        if (isRoot) rootCIDVerified = true;
      } catch (error) {
        if (signal?.aborted) {
          signal.throwIfAborted();
        }

        const reason = verificationSignal.aborted
          ? `IPNI verification timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);

        failedCIDs.push({ cid: cid.toString(), reason });

        this.logger.warn({
          event: "ipni_cid_verification_failed",
          message: "IPNI verification failed for CID",
          cid: cid.toString(),
          isRoot,
          providerAddress: storageProvider.address,
          providerId: storageProvider.providerId,
          providerName: storageProvider.name,
          serviceUrl: storageProvider.serviceUrl,
          failureReason: reason,
        });
      }
    }

    const ipniVerificationDurationMs = Date.now() - ipniVerificationStartTime;
    const total = cidsToValidate.length;
    const unverified = total - verified;

    if (verified === total) {
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
    } else {
      this.logger.error({
        event: verificationSignal.aborted ? "ipni_verification_timed_out" : "ipni_verification_failed",
        message: "IPNI verification did not fully succeed",
        rootCID: rootCid.toString(),
        providerAddress: storageProvider.address,
        providerId: storageProvider.providerId,
        providerName: storageProvider.name,
        serviceUrl: storageProvider.serviceUrl,
        blockCIDCount: blockCids.length,
        timeoutMs,
        pollIntervalMs: delayMs,
        maxAttempts,
        verified,
        unverified,
        total,
      });
    }

    return {
      verified: verified,
      unverified: unverified,
      total: total,
      rootCIDVerified: rootCIDVerified,
      durationMs: ipniVerificationDurationMs,
      failedCIDs: failedCIDs,
      verifiedAt: new Date().toISOString(),
    };
  }

  private buildExpectedProviderInfo(storageProvider: StorageProviderWithUrl): PDPProvider {
    return {
      id: storageProvider.providerId ?? 0n,
      serviceProvider: storageProvider.address as `0x${string}`,
      payee: storageProvider.payee as `0x${string}`,
      name: storageProvider.name,
      description: storageProvider.description,
      isActive: storageProvider.isActive,
      pdp: {
        // TODO
        serviceURL: storageProvider.serviceUrl,
        minPieceSizeInBytes: 0n,
        maxPieceSizeInBytes: 0n,
        storagePricePerTibPerDay: 0n,
        minProvingPeriodInEpochs: 0n,
        location: "todo",
        paymentTokenAddress: "0x",
        ipniPiece: true,
        ipniIpfs: true,
      },
    };
  }
}
