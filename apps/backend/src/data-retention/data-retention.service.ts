import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter } from "prom-client";
import { Raw, Repository } from "typeorm";
import { toStructuredError } from "../common/logging.js";
import { IConfig } from "../config/app.config.js";
import { DataRetentionBaseline } from "../database/entities/data-retention-baseline.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { buildCheckMetricLabels, CheckMetricLabels } from "../metrics/utils/check-metric-labels.js";
import { PDPSubgraphService } from "../pdp-subgraph/pdp-subgraph.service.js";
import { type ProviderDataSetResponse } from "../pdp-subgraph/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { type PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  private static readonly MAX_PROVIDER_BATCH_LENGTH = 50;

  /**
   * Tracks cumulative faulted/success period totals per provider address.
   * Used to compute deltas between consecutive polls for Prometheus counter increments.
   * Populated from the database on first poll, then kept in sync.
   */
  private readonly providerCumulativeTotals: Map<
    string,
    {
      faultedPeriods: bigint;
      successPeriods: bigint;
    }
  >;

  /** Whether baselines have been loaded from the database */
  private baselinesLoaded = false;

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly pdpSubgraphService: PDPSubgraphService,
    @InjectRepository(DataRetentionBaseline)
    private readonly baselineRepository: Repository<DataRetentionBaseline>,
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
    const pdpSubgraphEndpoint = this.configService.get("blockchain").pdpSubgraphEndpoint;
    if (!pdpSubgraphEndpoint) {
      this.logger.warn({
        event: "pdp_subgraph_endpoint_not_configured",
        message: "No PDP subgraph endpoint configured",
      });
      return;
    }

    await this.loadBaselinesFromDb();

    if (!this.baselinesLoaded) {
      // Cannot safely compute deltas without baselines — would emit full cumulative history
      return;
    }

    try {
      const subgraphMeta = await this.pdpSubgraphService.fetchSubgraphMeta();
      const providerInfos = this.walletSdkService.getTestingProviders();

      if (!providerInfos || providerInfos.length === 0) {
        this.logger.warn({
          event: "no_testing_providers_configured",
          message: "No testing providers configured",
        });
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
              return this.processProvider(provider, providerInfo);
            }),
          );

          // Log any processing failures and persist successful baselines
          const upsertPromises: Promise<void>[] = [];
          processingResults.forEach((result, index) => {
            if (result.status === "rejected") {
              hasProcessingErrors = true;
              const addr = providersFromSubgraph[index].address;
              const providerInfo = providerInfoMap.get(addr.toLowerCase());
              this.logger.error({
                event: "provider_processing_failed",
                message: "Failed to process provider",
                providerAddress: addr,
                providerId: providerInfo?.id,
                providerName: providerInfo?.name,
                error: toStructuredError(result.reason),
              });
            } else {
              const addr = providersFromSubgraph[index].address.toLowerCase();
              upsertPromises.push(this.persistBaseline(addr, result.value, blockNumberBigInt));
            }
          });

          // Persist baselines to DB (non-blocking for the main flow, but we await to catch errors)
          const upsertResults = await Promise.allSettled(upsertPromises);
          for (const result of upsertResults) {
            if (result.status === "rejected") {
              this.logger.warn({
                event: "baseline_persist_failed",
                message: "Failed to persist baseline to database",
                error: toStructuredError(result.reason),
              });
            }
          }
        } catch (error) {
          hasProcessingErrors = true;
          this.logger.error({
            event: "provider_batch_fetch_failed",
            message: "Failed to fetch batch",
            batchStartIndex: i,
            error: toStructuredError(error),
          });
          // Continue processing next batch
        }
      }

      // Only cleanup stale providers after successful poll to preserve baselines during transient failures
      if (!hasProcessingErrors) {
        await this.cleanupStaleProviders(providerAddresses);
      } else {
        this.logger.warn({
          event: "stale_provider_cleanup_skipped",
          message: "Skipping stale provider cleanup due to processing errors",
        });
      }
    } catch (error) {
      this.logger.error({
        event: "data_retention_poll_failed",
        message: "Failed to poll data retention",
        error: toStructuredError(error),
      });
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

    this.logger.log({
      event: "stale_provider_cleanup_started",
      message: "Cleaning up stale provider(s)",
      staleProviderCount: staleAddresses.length,
    });

    let staleProviders: StorageProvider[] = [];
    try {
      staleProviders = await this.storageProviderRepository.find({
        where: { address: Raw((alias) => `LOWER(${alias}) IN (:...addresses)`, { addresses: staleAddresses }) },
        select: ["address", "providerId", "name", "isApproved"],
      });
    } catch (error) {
      // Bail entirely on DB failure to protect metric baselines
      this.logger.error({
        event: "stale_provider_db_fetch_failed",
        message: "Failed to fetch stale provider info from database. Skipping cleanup to prevent metric desync.",
        error: toStructuredError(error),
      });
      return;
    }

    const providerLookup = new Map(staleProviders.map((p) => [p.address.toLowerCase(), p]));

    for (const address of staleAddresses) {
      try {
        const provider = providerLookup.get(address);

        if (provider && provider.providerId != null) {
          const approvedLabels = buildCheckMetricLabels({
            checkType: "dataRetention",
            providerId: provider.providerId,
            providerName: provider.name,
            providerIsApproved: true,
          });
          const unapprovedLabels = buildCheckMetricLabels({
            checkType: "dataRetention",
            providerId: provider.providerId,
            providerName: provider.name,
            providerIsApproved: false,
          });

          // Attempt to remove Prometheus metrics FIRST
          this.dataSetChallengeStatusCounter.remove({ ...approvedLabels, value: "success" });
          this.dataSetChallengeStatusCounter.remove({ ...approvedLabels, value: "failure" });
          this.dataSetChallengeStatusCounter.remove({ ...unapprovedLabels, value: "success" });
          this.dataSetChallengeStatusCounter.remove({ ...unapprovedLabels, value: "failure" });

          // Only delete local memory if Prometheus removal succeeded without throwing
          this.providerCumulativeTotals.delete(address);

          // Also remove persisted baseline from DB
          this.baselineRepository.delete({ providerAddress: address }).catch((err) => {
            this.logger.warn({
              event: "baseline_db_delete_failed",
              message: "Failed to delete persisted baseline for stale provider",
              providerAddress: address,
              error: toStructuredError(err),
            });
          });

          this.logger.debug({
            event: "stale_provider_metrics_removed",
            message: "Removed baseline and metrics for stale provider",
            providerAddress: address,
            providerId: provider.providerId,
            providerName: provider.name,
          });
        } else {
          // Provider not in database or missing ID.
          // CRITICAL: We DO NOT delete the local baseline here.
          // Because the DB syncs with the chain periodically, this provider might be
          // repopulated. If we delete the baseline now, and it returns later, we will
          // suffer from the double-counting/metric inflation bug.
          this.logger.debug({
            event: "stale_provider_baseline_retained",
            message: "Retaining baseline for stale provider (not found in DB, waiting for potential chain sync)",
            providerAddress: address,
          });
        }
      } catch (error) {
        // If Prometheus removal fails, leave the baseline in the map
        const provider = providerLookup.get(address);
        this.logger.error({
          event: "provider_metrics_cleanup_failed",
          message: "Failed to cleanup metrics for provider. Baseline retained to prevent metric inflation.",
          providerAddress: address,
          providerId: provider?.providerId,
          providerName: provider?.name,
          error: toStructuredError(error),
        });
      }
    }
  }

  /**
   * Process a single provider's data retention metrics.
   * Returns the computed cumulative totals for DB persistence.
   */
  private async processProvider(
    provider: ProviderDataSetResponse["providers"][number],
    pdpProvider: PDPProviderEx,
  ): Promise<{ faultedPeriods: bigint; successPeriods: bigint }> {
    const { address, totalFaultedPeriods, totalProvingPeriods } = provider;
    // Use only subgraph-confirmed totals. Speculative overdue estimation was removed
    // because it systematically inflated fault counts: overdue periods were pessimistically
    // counted as faults, but when the subgraph later confirmed them as successes, the
    // negative delta guard silently discarded the correction.
    const confirmedTotalSuccess = totalProvingPeriods - totalFaultedPeriods;

    const normalizedAddress = address.toLowerCase();
    const previous = this.providerCumulativeTotals.get(normalizedAddress);

    const newBaseline = {
      faultedPeriods: totalFaultedPeriods,
      successPeriods: confirmedTotalSuccess,
    };

    // First time seeing this provider (fresh deploy or newly added provider).
    // Set baseline without emitting counters to avoid dumping full cumulative history.
    if (previous === undefined) {
      this.logger.log({
        event: "baseline_initialized",
        message: "Initialized baseline for provider (no prior baseline)",
        providerAddress: address,
        providerId: pdpProvider.id,
        providerName: pdpProvider.name,
        faultedPeriods: totalFaultedPeriods.toString(),
        successPeriods: confirmedTotalSuccess.toString(),
      });
      this.providerCumulativeTotals.set(normalizedAddress, newBaseline);
      return newBaseline;
    }

    const faultedDelta = totalFaultedPeriods - previous.faultedPeriods;
    const successDelta = confirmedTotalSuccess - previous.successPeriods;

    // Handle negative deltas: can occur due to chain reorgs, subgraph corrections, or data inconsistencies
    // Reset baseline to current values to prevent stalled metrics
    if (faultedDelta < 0n || successDelta < 0n) {
      this.logger.warn({
        event: "negative_delta_detected",
        message: "Negative delta detected for provider",
        providerAddress: address,
        providerId: pdpProvider.id,
        providerName: pdpProvider.name,
        faultedDelta: faultedDelta.toString(),
        successDelta: successDelta.toString(),
      });
      // Reset baseline without incrementing counters
      this.providerCumulativeTotals.set(normalizedAddress, newBaseline);
      return newBaseline;
    }

    const providerLabels = buildCheckMetricLabels({
      checkType: "dataRetention",
      providerId: pdpProvider.id,
      providerName: pdpProvider.name,
      providerIsApproved: pdpProvider.isApproved,
    });

    if (faultedDelta > 0n) {
      this.safeIncrementCounter(this.dataSetChallengeStatusCounter, providerLabels, "failure", faultedDelta);
    }

    if (successDelta > 0n) {
      this.safeIncrementCounter(this.dataSetChallengeStatusCounter, providerLabels, "success", successDelta);
    }

    this.providerCumulativeTotals.set(normalizedAddress, newBaseline);
    return newBaseline;
  }

  /**
   * Loads persisted baselines from the database into the in-memory map.
   * Only runs once; if the DB read fails, retries on the next poll.
   */
  private async loadBaselinesFromDb(): Promise<void> {
    if (this.baselinesLoaded) {
      return;
    }

    try {
      const rows = await this.baselineRepository.find();
      for (const row of rows) {
        this.providerCumulativeTotals.set(row.providerAddress, {
          faultedPeriods: BigInt(row.faultedPeriods),
          successPeriods: BigInt(row.successPeriods),
        });
      }
      this.baselinesLoaded = true;
      this.logger.log({
        event: "baselines_loaded_from_db",
        message: "Loaded baseline(s) from database",
        baselineCount: rows.length,
      });
    } catch (error) {
      this.logger.error({
        event: "baseline_load_failed",
        message: "Failed to load baselines from database. Will retry on next poll.",
        error: toStructuredError(error),
      });
    }
  }

  /**
   * Persists a provider's baseline to the database.
   */
  private async persistBaseline(
    providerAddress: string,
    baseline: { faultedPeriods: bigint; successPeriods: bigint },
    blockNumber: bigint,
  ): Promise<void> {
    await this.baselineRepository.upsert(
      {
        providerAddress,
        faultedPeriods: baseline.faultedPeriods.toString(),
        successPeriods: baseline.successPeriods.toString(),
        lastBlockNumber: blockNumber.toString(),
      },
      ["providerAddress"],
    );
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
    value: "success" | "failure",
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
    this.logger.warn({
      event: "large_counter_increment_detected",
      message: "Large counter increment detected. Incrementing in chunks to prevent precision loss.",
      increment: increment.toString(),
    });

    let remaining = increment;
    while (remaining > 0n) {
      const chunk = remaining > MAX_SAFE_INTEGER_BIGINT ? MAX_SAFE_INTEGER_BIGINT : remaining;
      counter.labels({ ...labels, value }).inc(Number(chunk));
      remaining -= chunk;
    }
  }
}
