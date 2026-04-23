import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter, Gauge } from "prom-client";
import { Raw, Repository } from "typeorm";
import { toStructuredError } from "../common/logging.js";
import { isSpBlocked } from "../common/sp-blocklist.js";
import type { Network } from "../common/types.js";
import type { IConfig, INetworkConfig, INetworksConfig } from "../config/types.js";
import { DataRetentionBaseline } from "../database/entities/data-retention-baseline.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { buildCheckMetricLabels, CheckMetricLabels } from "../metrics-prometheus/check-metric-labels.js";
import { PDPSubgraphService } from "../pdp-subgraph/pdp-subgraph.service.js";
import { type ProviderDataSetResponse } from "../pdp-subgraph/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { type PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  private static readonly MAX_PROVIDER_BATCH_LENGTH = 50;
  // NOTE: taken from https://github.com/FilOzone/filecoin-services/blob/c04be93aa680082e359481f0776e41ed157a2ac2/service_contracts/src/FilecoinWarmStorageService.sol#L26
  private static readonly CHALLENGES_PER_PROVING_PERIOD = 5n;

  /**
   * Tracks cumulative faulted/success period totals keyed by "network:providerAddress".
   * Used to compute deltas between consecutive polls for Prometheus counter increments.
   * Populated from the database on first poll, then kept in sync.
   * Note: Baselines are stored in periods, but emitted metrics are converted to challenges
   * by multiplying period deltas by CHALLENGES_PER_PROVING_PERIOD.
   */
  private readonly providerCumulativeTotals: Map<
    string,
    {
      faultedPeriods: bigint;
      successPeriods: bigint;
    }
  >;

  /** Per-network baseline load flags */
  private readonly baselinesLoadedByNetwork: Map<Network, boolean> = new Map();

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
  ) {
    this.providerCumulativeTotals = new Map();
  }

  private cumulativeTotalsKey(network: Network, address: string): string {
    return `${network}:${address}`;
  }

  /**
   * Polls the PDP subgraph for provider proof-set data, computes proving period deltas,
   * converts them to challenge counts, and increments Prometheus counters with the
   * challenge delta since the last poll.
   */
  async pollDataRetention(network: Network): Promise<void> {
    const networkConfig = this.configService.get<INetworkConfig>("networks")[network];
    const pdpSubgraphEndpoint = networkConfig.pdpSubgraphEndpoint;
    if (!pdpSubgraphEndpoint) {
      this.logger.warn({
        event: "pdp_subgraph_endpoint_not_configured",
        message: "No PDP subgraph endpoint configured",
        network,
      });
      return;
    }

    await this.loadBaselinesFromDb(network);

    if (!this.baselinesLoadedByNetwork.get(network)) {
      // Cannot safely compute deltas without baselines — would emit full cumulative history
      this.logger.log({
        event: "failed_to_load_baselines_by_network",
      });
      return;
    }

    try {
      const subgraphMeta = await this.pdpSubgraphService.fetchSubgraphMeta(pdpSubgraphEndpoint);
      const allProviderInfos = this.walletSdkService.getTestingProviders(network);
      const spBlocklists = this.configService.get<INetworksConfig>("networks")[network];
      const providerInfos = allProviderInfos?.filter((p) => !isSpBlocked(spBlocklists, p.serviceProvider, p.id));

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
          const providersFromSubgraph = await this.pdpSubgraphService.fetchProvidersWithDatasets(pdpSubgraphEndpoint, {
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
              return this.processProvider(provider, providerInfo, blockNumberBigInt, network);
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
                network,
                error: toStructuredError(result.reason),
              });
            } else {
              const addr = providersFromSubgraph[index].address.toLowerCase();
              upsertPromises.push(this.persistBaseline(addr, result.value, blockNumberBigInt, network));
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
        await this.cleanupStaleProviders(providerAddresses, network);
      } else {
        this.logger.warn({
          event: "stale_provider_cleanup_skipped",
          message: "Skipping stale provider cleanup due to processing errors",
          network,
        });
      }
    } catch (error) {
      this.logger.error({
        event: "data_retention_poll_failed",
        message: "Failed to poll data retention",
        network,
        error: toStructuredError(error),
      });
    }
  }

  /**
   * Removes stale provider entries from the cumulative totals map and their associated
   * Prometheus counter and gauge metrics.
   *
   * CRITICAL: Local baselines are ONLY deleted if the Prometheus metrics are successfully
   * removed. This prevents massive metric inflation (double-counting) if a provider
   * temporarily drops offline and returns later.
   *
   * @param activeProviderAddresses - Array of currently active provider addresses (normalized to lowercase)
   */
  private async cleanupStaleProviders(activeProviderAddresses: string[], network: Network): Promise<void> {
    const activeAddressSet = new Set(activeProviderAddresses);
    const staleAddresses: string[] = [];

    for (const [key] of this.providerCumulativeTotals) {
      const [keyNetwork, address] = key.split(":", 2);
      if (keyNetwork === network && address && !activeAddressSet.has(address)) {
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
        where: {
          network,
          address: Raw((alias) => `LOWER(${alias}) IN (:...addresses)`, { addresses: staleAddresses }),
        },
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
      const totalsKey = this.cumulativeTotalsKey(network, address);
      try {
        const provider = providerLookup.get(address);

        if (provider && provider.providerId != null) {
          const approvedLabels = buildCheckMetricLabels({
            network,
            checkType: "dataRetention",
            providerId: provider.providerId,
            providerName: provider.name,
            providerIsApproved: true,
          });
          const unapprovedLabels = buildCheckMetricLabels({
            network,
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
          this.providerCumulativeTotals.delete(totalsKey);

          // Also remove persisted baseline from DB
          this.baselineRepository.delete({ providerAddress: address, network }).catch((err) => {
            this.logger.warn({
              event: "baseline_db_delete_failed",
              message: "Failed to delete persisted baseline for stale provider",
              providerAddress: address,
              network,
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
    network: Network,
  ): Promise<{ faultedPeriods: bigint; successPeriods: bigint }> {
    const { address, totalFaultedPeriods, totalProvingPeriods, proofSets } = provider;
    // Note: Query filters proofSets with nextDeadline_lt: $blockNumber, so all deadlines are in the past
    const estimatedOverduePeriods = proofSets.reduce((acc, proofSet) => {
      if (proofSet.maxProvingPeriod === 0n) {
        return acc;
      }
      return acc + (currentBlock - (proofSet.nextDeadline + 1n)) / proofSet.maxProvingPeriod;
    }, 0n);

    const confirmedTotalSuccess = totalProvingPeriods - totalFaultedPeriods;

    const normalizedAddress = address.toLowerCase();
    const totalsKey = this.cumulativeTotalsKey(network, normalizedAddress);
    const previous = this.providerCumulativeTotals.get(totalsKey);

    const newBaseline = {
      faultedPeriods: totalFaultedPeriods,
      successPeriods: confirmedTotalSuccess,
    };

    const providerLabels = buildCheckMetricLabels({
      network,
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
      this.providerCumulativeTotals.set(totalsKey, newBaseline);
      return newBaseline;
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
      // Reset baseline without incrementing counters
      this.providerCumulativeTotals.set(totalsKey, newBaseline);
      return newBaseline;
    }

    if (faultedChallengesDelta > 0n) {
      this.safeIncrementCounter(this.dataSetChallengeStatusCounter, providerLabels, "failure", faultedChallengesDelta);
    }

    if (successChallengesDelta > 0n) {
      this.safeIncrementCounter(this.dataSetChallengeStatusCounter, providerLabels, "success", successChallengesDelta);
    }

    this.providerCumulativeTotals.set(totalsKey, newBaseline);

    return newBaseline;
  }

  /**
   * Loads persisted baselines from the database into the in-memory map.
   * Only runs once per network; if the DB read fails, retries on the next poll.
   */
  private async loadBaselinesFromDb(network: Network): Promise<void> {
    if (this.baselinesLoadedByNetwork.get(network)) {
      return;
    }

    try {
      const rows = await this.baselineRepository.find({ where: { network } });
      for (const row of rows) {
        this.providerCumulativeTotals.set(this.cumulativeTotalsKey(network, row.providerAddress), {
          faultedPeriods: BigInt(row.faultedPeriods),
          successPeriods: BigInt(row.successPeriods),
        });
      }
      this.baselinesLoadedByNetwork.set(network, true);
      this.logger.log({
        event: "baselines_loaded_from_db",
        message: "Loaded baseline(s) from database",
        network,
        baselineCount: rows.length,
      });
    } catch (error) {
      this.logger.error({
        event: "baseline_load_failed",
        message: "Failed to load baselines from database. Will retry on next poll.",
        network,
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
    network: Network,
  ): Promise<void> {
    await this.baselineRepository.upsert(
      {
        providerAddress,
        network,
        faultedPeriods: baseline.faultedPeriods.toString(),
        successPeriods: baseline.successPeriods.toString(),
        lastBlockNumber: blockNumber.toString(),
      },
      ["providerAddress", "network"],
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
