import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter } from "prom-client";
import { Raw, Repository } from "typeorm";
import { IConfig } from "../config/app.config.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { buildCheckMetricLabels, CheckMetricLabels } from "../metrics/utils/check-metric-labels.js";
import { PDPSubgraphService } from "../pdp-subgraph/pdp-subgraph.service.js";
import { type ProviderDataSetResponse } from "../pdp-subgraph/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { type ProviderInfoEx } from "../wallet-sdk/wallet-sdk.types.js";

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  private static readonly MAX_PROVIDER_BATCH_LENGTH = 50;

  /**
   * Tracks cumulative faulted/success period totals per provider address.
   * Used to compute deltas between consecutive polls for Prometheus counter increments.
   */
  private readonly providerCumulativeTotals: Map<
    string,
    {
      faultedPeriods: bigint;
      successPeriods: bigint;
    }
  >;

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly pdpSubgraphService: PDPSubgraphService,
    @InjectRepository(StorageProvider)
    private readonly storageProviderRepository: Repository<StorageProvider>,
    @InjectMetric("dataSetChallengeStatus")
    private readonly dataSetChallengeStatusCounter: Counter,
  ) {
    this.providerCumulativeTotals = new Map();
  }

  /**
   * Polls the PDP subgraph for provider proof-set data, computes estimated
   * faulted and successful proving periods (challenges), and increments Prometheus counters
   * with the delta since the last poll.
   */
  async pollDataRetention(): Promise<void> {
    this.logger.log("Polling data retention");

    const pdpSubgraphEndpoint = this.configService.get("blockchain").pdpSubgraphEndpoint;
    if (!pdpSubgraphEndpoint) {
      this.logger.warn("No PDP subgraph endpoint configured");
      return;
    }

    try {
      const subgraphMeta = await this.pdpSubgraphService.fetchSubgraphMeta();
      const providerInfos = this.walletSdkService.getTestingProviders();

      if (!providerInfos || providerInfos.length === 0) {
        this.logger.warn("No testing providers configured");
        return;
      }

      const blockNumber = subgraphMeta._meta.block.number;
      const blockNumberBigInt = BigInt(blockNumber);
      // Create snapshot of provider cache to avoid race condition if loadProviders() clears cache
      // Normalize addresses to lowercase for consistent lookups
      const providerInfoMap = new Map(providerInfos.map((info) => [info.serviceProvider.toLowerCase(), info]));
      const providerAddresses = Array.from(providerInfoMap.keys());

      let hasProcessingErrors = false;

      for (let i = 0; i < providerAddresses.length; i += DataRetentionService.MAX_PROVIDER_BATCH_LENGTH) {
        const batchAddresses = providerAddresses.slice(
          i,
          Math.min(providerAddresses.length, i + DataRetentionService.MAX_PROVIDER_BATCH_LENGTH),
        );

        try {
          const providersFromSubgraph = await this.pdpSubgraphService.fetchProvidersWithDatasets({
            blockNumber,
            addresses: batchAddresses,
          });

          // Process providers in parallel
          const processingResults = await Promise.allSettled(
            providersFromSubgraph.map((provider) => {
              const providerInfo = providerInfoMap.get(provider.address.toLowerCase());
              if (!providerInfo) {
                return Promise.reject(
                  new Error(
                    `Provider ${provider.address} returned from subgraph but not found in local cache - data inconsistency`,
                  ),
                );
              }
              return this.processProvider(provider, blockNumberBigInt, providerInfo);
            }),
          );

          // Log any processing failures
          processingResults.forEach((result, index) => {
            if (result.status === "rejected") {
              hasProcessingErrors = true;
              this.logger.error(`Failed to process provider ${providersFromSubgraph[index].address}: ${result.reason}`);
            }
          });
        } catch (error) {
          hasProcessingErrors = true;
          this.logger.error(
            `Failed to fetch batch starting at index ${i}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          // Continue processing next batch
        }
      }

      // Only cleanup stale providers after successful poll to preserve baselines during transient failures
      if (!hasProcessingErrors) {
        await this.cleanupStaleProviders(providerAddresses);
      } else {
        this.logger.warn("Skipping stale provider cleanup due to processing errors");
      }
    } catch (error) {
      this.logger.error("Failed to poll data retention", error);
    }
  }

  /**
   * Removes stale provider entries from the cumulative totals map and their associated
   * Prometheus counter metrics.
   *
   * CRITICAL: Local baselines are ONLY deleted if the Prometheus metric is successfully
   * removed. This prevents massive metric inflation (double-counting) if a provider
   * temporarily drops offline and returns later.
   *
   * @param activeProviderAddresses - Array of currently active provider addresses (normalized to lowercase)
   */
  private async cleanupStaleProviders(activeProviderAddresses: string[]): Promise<void> {
    const activeAddressSet = new Set(activeProviderAddresses);
    const staleAddresses: string[] = [];

    for (const [address] of this.providerCumulativeTotals) {
      if (!activeAddressSet.has(address)) {
        staleAddresses.push(address);
      }
    }

    if (staleAddresses.length === 0) {
      return;
    }

    this.logger.log(`Cleaning up ${staleAddresses.length} stale provider(s)`);

    let staleProviders: StorageProvider[] = [];
    try {
      staleProviders = await this.storageProviderRepository.find({
        where: { address: Raw((alias) => `LOWER(${alias}) IN (:...addresses)`, { addresses: staleAddresses }) },
        select: ["address", "providerId", "isApproved"],
      });
    } catch (error) {
      // Bail entirely on DB failure to protect metric baselines
      this.logger.error(
        `Failed to fetch stale provider info from database: ${error instanceof Error ? error.message : "Unknown error"}. Skipping cleanup to prevent metric desync.`,
      );
      return;
    }

    const providerLookup = new Map(staleProviders.map((p) => [p.address.toLowerCase(), p]));

    for (const address of staleAddresses) {
      try {
        const provider = providerLookup.get(address);

        if (provider && provider.providerId != null) {
          const labels = buildCheckMetricLabels({
            checkType: "dataRetention",
            providerId: provider.providerId,
            providerIsApproved: provider.isApproved,
          });

          // Attempt to remove Prometheus metrics FIRST
          this.dataSetChallengeStatusCounter.remove({ ...labels, value: "success" });
          this.dataSetChallengeStatusCounter.remove({ ...labels, value: "fault" });

          // Only delete local memory if Prometheus removal succeeded without throwing
          this.providerCumulativeTotals.delete(address);

          this.logger.debug(`Removed baseline and metrics for stale provider: ${address} (ID: ${provider.providerId})`);
        } else {
          // Provider not in database or missing ID.
          // CRITICAL: We DO NOT delete the local baseline here.
          // Because the DB syncs with the chain periodically, this provider might be
          // repopulated. If we delete the baseline now, and it returns later, we will
          // suffer from the double-counting/metric inflation bug.
          this.logger.debug(
            `Retaining baseline for stale provider: ${address} (not found in DB, waiting for potential chain sync)`,
          );
        }
      } catch (error) {
        // If Prometheus removal fails, leave the baseline in the map
        this.logger.error(
          `Failed to cleanup metrics for provider ${address}: ${error instanceof Error ? error.message : "Unknown error"}. Baseline retained to prevent metric inflation.`,
        );
      }
    }
  }

  /**
   * Process a single provider's data retention metrics
   */
  private async processProvider(
    provider: ProviderDataSetResponse["providers"][number],
    blockNumberBigInt: bigint,
    providerInfo: ProviderInfoEx,
  ): Promise<void> {
    const { address, totalFaultedPeriods, totalProvingPeriods, proofSets } = provider;
    // Note: Query filters proofSets with nextDeadline_lt: $blockNumber, so all deadlines are in the past
    const estimatedOverduePeriods = proofSets.reduce((acc, proofSet) => {
      if (proofSet.maxProvingPeriod === 0n) {
        return acc;
      }
      return acc + (blockNumberBigInt - (proofSet.nextDeadline + 1n)) / proofSet.maxProvingPeriod;
    }, 0n);

    const estimatedTotalFaulted = totalFaultedPeriods + estimatedOverduePeriods;
    const estimatedTotalPeriods = totalProvingPeriods + estimatedOverduePeriods;
    const estimatedTotalSuccess = estimatedTotalPeriods - estimatedTotalFaulted;

    const normalizedAddress = address.toLowerCase();
    const previous = this.providerCumulativeTotals.get(normalizedAddress);
    const faultedDelta = estimatedTotalFaulted - (previous?.faultedPeriods ?? 0n);
    const successDelta = estimatedTotalSuccess - (previous?.successPeriods ?? 0n);

    // Handle negative deltas: can occur due to chain reorgs, subgraph corrections, or data inconsistencies
    // Reset baseline to current values to prevent stalled metrics
    if (faultedDelta < 0n || successDelta < 0n) {
      this.logger.warn(
        `Negative delta detected for provider ${address} (faulted: ${faultedDelta}, success: ${successDelta}).`,
      );
      // Reset baseline without incrementing counters
      this.providerCumulativeTotals.set(normalizedAddress, {
        faultedPeriods: estimatedTotalFaulted,
        successPeriods: estimatedTotalSuccess,
      });
      return;
    }

    const providerLabels = buildCheckMetricLabels({
      checkType: "dataRetention",
      providerId: providerInfo.id,
      providerIsApproved: providerInfo.isApproved,
    });

    if (faultedDelta > 0n) {
      this.safeIncrementCounter(this.dataSetChallengeStatusCounter, providerLabels, "fault", faultedDelta);
    }

    if (successDelta > 0n) {
      this.safeIncrementCounter(this.dataSetChallengeStatusCounter, providerLabels, "success", successDelta);
    }

    this.providerCumulativeTotals.set(normalizedAddress, {
      faultedPeriods: estimatedTotalFaulted,
      successPeriods: estimatedTotalSuccess,
    });
  }

  /**
   * Safely increments a Prometheus counter with a BigInt value.
   * If the value exceeds Number.MAX_SAFE_INTEGER, increments in chunks to prevent precision loss.
   *
   * @param counter - The Prometheus counter to increment
   * @param labels - The label set for the counter
   * @param value - The BigInt value to increment by
   */
  private safeIncrementCounter(
    counter: Counter,
    labels: CheckMetricLabels,
    value: "success" | "fault",
    increment: bigint,
  ): void {
    if (increment <= 0n) {
      return;
    }

    const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

    if (increment <= MAX_SAFE_INTEGER_BIGINT) {
      // Safe to convert directly
      counter.labels({ ...labels, value }).inc(Number(increment));
      return;
    }

    // Value exceeds safe integer range - increment in chunks
    this.logger.warn(
      `Large counter increment detected (${increment.toString()}). Incrementing in chunks to prevent precision loss.`,
    );

    let remaining = increment;
    while (remaining > 0n) {
      const chunk = remaining > MAX_SAFE_INTEGER_BIGINT ? MAX_SAFE_INTEGER_BIGINT : remaining;
      counter.labels({ ...labels, value }).inc(Number(chunk));
      remaining -= chunk;
    }
  }
}
