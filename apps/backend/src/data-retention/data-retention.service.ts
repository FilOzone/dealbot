import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter, Gauge } from "prom-client";
import { Raw, Repository } from "typeorm";
import { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { toStructuredError } from "../common/logging.js";
import { isSpBlocked } from "../common/sp-blocklist.js";
import { IConfig } from "../config/app.config.js";
import { DataRetentionBaseline } from "../database/entities/data-retention-baseline.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { buildCheckMetricLabels, CheckMetricLabels } from "../metrics-prometheus/check-metric-labels.js";
import { PDPSubgraphService } from "../pdp-subgraph/pdp-subgraph.service.js";
import { type ProviderDataSetResponse, type SubgraphMeta } from "../pdp-subgraph/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { type PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";

/**
 * Thrown when the data-retention check cannot run because one of its dependencies
 * (the PDP subgraph or the persisted baselines) is unavailable. Transient per-provider
 * failures do NOT raise this — they leave the job a success with partial results.
 */
export class DataRetentionDependencyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DataRetentionDependencyError";
  }
}

type ProviderBaseline = {
  faultedPeriods: bigint;
  successPeriods: bigint;
};

type ProcessedProviderResult = {
  providerAddress: string;
  providerLabels: CheckMetricLabels;
  baseline: ProviderBaseline;
  faultedChallengesDelta: bigint;
  successChallengesDelta: bigint;
  negativeDelta: boolean;
};

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  private static readonly MAX_PROVIDER_BATCH_LENGTH = 50;
  // NOTE: taken from https://github.com/FilOzone/filecoin-services/blob/c04be93aa680082e359481f0776e41ed157a2ac2/service_contracts/src/FilecoinWarmStorageService.sol#L26
  private static readonly CHALLENGES_PER_PROVING_PERIOD = 5n;

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
    @InjectMetric("pdp_provider_estimated_overdue_periods")
    private readonly estimatedOverduePeriodsGauge: Gauge,
    private readonly clickhouseService: ClickhouseService,
  ) {}

  /**
   * Polls the PDP subgraph for provider proof-set data, computes proving period deltas,
   * converts them to challenge counts, and increments Prometheus counters with the
   * challenge delta since the last poll.
   */
  async pollDataRetention(): Promise<void> {
    const pdpSubgraphEndpoint = this.configService.get("blockchain").pdpSubgraphEndpoint;
    if (!pdpSubgraphEndpoint) {
      this.logger.error({
        event: "pdp_subgraph_endpoint_not_configured",
        message: "No PDP subgraph endpoint configured",
      });
      throw new DataRetentionDependencyError("PDP subgraph endpoint not configured");
    }

    const baselines = await this.loadBaselinesFromDb();
    if (baselines === null) {
      // Cannot safely compute deltas without persisted baselines. DB dependency is unavailable.
      throw new DataRetentionDependencyError("Failed to load data retention baselines from database");
    }

    // A subgraph query failure means the check could not run against its dependency, its a job failure.
    let subgraphQueryFailed = false;

    try {
      let subgraphMeta: SubgraphMeta;
      try {
        subgraphMeta = await this.pdpSubgraphService.fetchSubgraphMeta();
      } catch (error) {
        // The subgraph is a hard dependency for the poll; label this precisely so the
        // outer catch (which now preserves error type) rethrows it as a dependency failure.
        throw new DataRetentionDependencyError("Failed to fetch PDP subgraph meta", { cause: error });
      }
      const allProviderInfos = this.walletSdkService.getTestingProviders();
      const spBlocklists = this.configService.get("spBlocklists");
      const providerInfos = allProviderInfos?.filter((p) => !isSpBlocked(spBlocklists, p.serviceProvider, p.id));

      if (!providerInfos || providerInfos.length === 0) {
        // An empty-but-healthy provider set is a successful no-op poll, not a failure.
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
              return this.processProvider(provider, providerInfo, blockNumberBigInt, baselines);
            }),
          );

          await Promise.all(
            processingResults.map(async (result, index) => {
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
                return;
              }

              try {
                await this.persistBaseline(result.value.providerAddress, result.value.baseline, blockNumberBigInt);
              } catch (error) {
                hasProcessingErrors = true;
                // Leave stale cleanup for a later poll so DB-backed baselines and local state do not diverge further.
                this.logger.warn({
                  event: "baseline_persist_failed",
                  message: "Failed to persist baseline to database",
                  providerAddress: result.value.providerAddress,
                  error: toStructuredError(error),
                });
                return;
              }

              try {
                this.applyPersistedProviderResult(result.value, baselines);
              } catch (error) {
                hasProcessingErrors = true;
                this.logger.error({
                  event: "provider_result_apply_failed",
                  message: "Failed to apply persisted provider result",
                  providerAddress: result.value.providerAddress,
                  error: toStructuredError(error),
                });
              }
            }),
          );
        } catch (error) {
          hasProcessingErrors = true;
          subgraphQueryFailed = true;
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
        await this.cleanupStaleProviders(providerAddresses, baselines);
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
      // Preserve the original failure type: genuine dependency failures are already
      // DataRetentionDependencyError, while anything else (e.g. a logic error) must not be
      // mislabeled as a dependency outage. Wrap only non-Error throwables.
      throw error instanceof Error ? error : new Error(String(error));
    }

    // Fail the job once the poll has recorded what it could.
    if (subgraphQueryFailed) {
      throw new DataRetentionDependencyError("PDP subgraph query failed for one or more provider batches");
    }
  }

  /**
   * Removes stale provider entries from the per-poll baselines map, the persisted baseline
   * table, and their associated Prometheus counter/gauge metrics.
   *
   * CRITICAL: Persisted and poll-local baselines are ONLY deleted if Prometheus removal succeeds.
   * Prevents massive metric inflation (double-counting) if a provider temporarily drops
   * offline and returns later.
   */
  private async cleanupStaleProviders(
    activeProviderAddresses: string[],
    baselines: Map<string, ProviderBaseline>,
  ): Promise<void> {
    const activeAddressSet = new Set(activeProviderAddresses);
    const staleAddresses: string[] = [];

    for (const [address] of baselines) {
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
          this.estimatedOverduePeriodsGauge.remove(approvedLabels);
          this.estimatedOverduePeriodsGauge.remove(unapprovedLabels);

          // Only delete local memory if Prometheus removal succeeded without throwing
          baselines.delete(address);

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
    currentBlock: bigint,
    baselines: Map<string, ProviderBaseline>,
  ): Promise<ProcessedProviderResult> {
    const { address, totalFaultedPeriods, totalProvingPeriods, proofSets } = provider;
    // Note: Query filters proofSets with nextDeadline_lt: $blockNumber, so all deadlines are in the past
    const estimatedOverduePeriods = proofSets.reduce((acc, proofSet) => {
      if (proofSet.maxProvingPeriod === 0n) {
        return acc;
      }
      return acc + (currentBlock - (proofSet.nextDeadline + 1n)) / proofSet.maxProvingPeriod;
    }, 0n);

    const confirmedTotalSuccess = totalProvingPeriods - totalFaultedPeriods;

    this.clickhouseService.insert("data_retention_challenges", {
      timestamp: Date.now(),
      probe_location: this.clickhouseService.probeLocation,
      sp_address: address,
      sp_id: pdpProvider.id != null ? String(pdpProvider.id) : null, // pdpProvider.id is a BigInt
      sp_name: pdpProvider.name ?? null,
      total_periods_due: Number(totalProvingPeriods),
      total_faulted_periods: Number(totalFaultedPeriods),
      total_success_periods: Number(confirmedTotalSuccess),
      estimated_overdue_periods: Number(estimatedOverduePeriods),
    });

    const normalizedAddress = address.toLowerCase();
    const previous = baselines.get(normalizedAddress);

    const newBaseline = {
      faultedPeriods: totalFaultedPeriods,
      successPeriods: confirmedTotalSuccess,
    };

    const providerLabels = buildCheckMetricLabels({
      checkType: "dataRetention",
      providerId: pdpProvider.id,
      providerName: pdpProvider.name,
      providerIsApproved: pdpProvider.isApproved,
    });

    // Emit overdue periods gauge on every poll — this is a separate signal from the
    // confirmed counters. It reflects estimated unrecorded faults in real time and
    // naturally resets to 0 when NextProvingPeriod fires and the subgraph catches up.
    // Note: Safe to cast under normal conditions (1 period = 240 blocks). However, we
    // check for overflow to handle edge cases like proving period changes or fast finality.
    this.safeSetGauge(
      this.estimatedOverduePeriodsGauge,
      providerLabels,
      estimatedOverduePeriods,
      address,
      pdpProvider.id,
      pdpProvider.name,
    );

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
      return {
        providerAddress: normalizedAddress,
        providerLabels,
        baseline: newBaseline,
        faultedChallengesDelta: 0n,
        successChallengesDelta: 0n,
        negativeDelta: false,
      };
    }

    const faultedChallengesDelta =
      (totalFaultedPeriods - previous.faultedPeriods) * DataRetentionService.CHALLENGES_PER_PROVING_PERIOD;
    const successChallengesDelta =
      (confirmedTotalSuccess - previous.successPeriods) * DataRetentionService.CHALLENGES_PER_PROVING_PERIOD;

    // Handle negative deltas: can occur due to chain reorgs, subgraph corrections, or data inconsistencies
    // Reset baseline to current values to prevent stalled metrics
    if (faultedChallengesDelta < 0n || successChallengesDelta < 0n) {
      this.logger.warn({
        event: "negative_delta_detected",
        message: "Negative delta detected for provider",
        providerAddress: address,
        providerId: pdpProvider.id,
        providerName: pdpProvider.name,
        faultedChallengesDelta: faultedChallengesDelta.toString(),
        successChallengesDelta: successChallengesDelta.toString(),
      });
      return {
        providerAddress: normalizedAddress,
        providerLabels,
        baseline: newBaseline,
        faultedChallengesDelta,
        successChallengesDelta,
        negativeDelta: true,
      };
    }

    return {
      providerAddress: normalizedAddress,
      providerLabels,
      baseline: newBaseline,
      faultedChallengesDelta,
      successChallengesDelta,
      negativeDelta: false,
    };
  }

  private applyPersistedProviderResult(
    result: ProcessedProviderResult,
    baselines: Map<string, ProviderBaseline>,
  ): void {
    baselines.set(result.providerAddress, result.baseline);

    if (result.negativeDelta) {
      return;
    }

    if (result.faultedChallengesDelta > 0n) {
      this.safeIncrementCounter(
        this.dataSetChallengeStatusCounter,
        result.providerLabels,
        "failure",
        result.faultedChallengesDelta,
      );
    }

    if (result.successChallengesDelta > 0n) {
      this.safeIncrementCounter(
        this.dataSetChallengeStatusCounter,
        result.providerLabels,
        "success",
        result.successChallengesDelta,
      );
    }
  }

  /**
   * Loads persisted baselines from the database into a fresh map.
   * Runs at the start of every poll so whichever worker pod wins the job computes
   * deltas from the latest persisted cross-pod baseline. Returns null on DB failure
   * so the caller can abort the poll.
   */
  private async loadBaselinesFromDb(): Promise<Map<string, ProviderBaseline> | null> {
    try {
      const rows = await this.baselineRepository.find();
      const baselines = new Map<string, ProviderBaseline>();
      for (const row of rows) {
        baselines.set(row.providerAddress.toLowerCase(), {
          faultedPeriods: BigInt(row.faultedPeriods),
          successPeriods: BigInt(row.successPeriods),
        });
      }
      this.logger.log({
        event: "baselines_loaded_from_db",
        message: "Loaded baseline(s) from database",
        baselineCount: rows.length,
      });
      return baselines;
    } catch (error) {
      this.logger.error({
        event: "baseline_load_failed",
        message: "Failed to load baselines from database. Aborting poll and will retry on next poll.",
        error: toStructuredError(error),
      });
      return null;
    }
  }

  /**
   * Persists a provider's baseline to the database.
   */
  private async persistBaseline(
    providerAddress: string,
    baseline: ProviderBaseline,
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

  /**
   * Safely sets a Prometheus gauge with a BigInt value.
   * If the value exceeds Number.MAX_SAFE_INTEGER, clamps to MAX_SAFE_INTEGER and logs a warning.
   *
   * @param gauge - The Prometheus gauge to set
   * @param labels - The label set for the gauge
   * @param value - The BigInt value to set
   * @param providerAddress - Provider address for logging
   * @param providerId - Provider ID for logging
   * @param providerName - Provider name for logging
   */
  private safeSetGauge(
    gauge: Gauge,
    labels: CheckMetricLabels,
    value: bigint,
    providerAddress: string,
    providerId: bigint,
    providerName: string,
  ): void {
    const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

    if (value > MAX_SAFE_INTEGER_BIGINT) {
      this.logger.warn({
        event: "overdue_periods_overflow",
        message: "Estimated overdue periods exceeds safe integer range. Clamping to MAX_SAFE_INTEGER.",
        providerAddress,
        providerId,
        providerName,
        estimatedOverduePeriods: value.toString(),
      });
      gauge.labels(labels).set(Number.MAX_SAFE_INTEGER);
    } else {
      gauge.labels(labels).set(Number(value));
    }
  }
}
