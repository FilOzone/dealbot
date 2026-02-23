import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter } from "prom-client";
import { IConfig } from "../config/app.config.js";
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
              this.logger.error(`Failed to process provider ${providersFromSubgraph[index].address}: ${result.reason}`);
            }
          });
        } catch (error) {
          this.logger.error(
            `Failed to fetch batch starting at index ${i}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          // Continue processing next batch
        }
      }
    } catch (error) {
      this.logger.error("Failed to poll data retention", error);
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
    const faultedDelta = previous ? estimatedTotalFaulted - previous.faultedPeriods : estimatedTotalFaulted;
    const successDelta = previous ? estimatedTotalSuccess - previous.successPeriods : estimatedTotalSuccess;

    if (faultedDelta < 0n || successDelta < 0n) {
      this.logger.warn(
        `Negative delta detected for provider ${address} (faulted: ${faultedDelta}, success: ${successDelta}); skipping counter update`,
      );
      return;
    }

    const providerIdStr = providerInfo.id.toString();
    const providerStatus = providerInfo.isApproved ? "approved" : "unapproved";

    if (faultedDelta > 0n) {
      this.dataSetChallengeStatusCounter
        .labels({
          checkType: "dataRetention",
          providerId: providerIdStr,
          providerStatus,
          value: "fault",
        })
        .inc(Number(faultedDelta));
    }

    if (successDelta > 0n) {
      this.dataSetChallengeStatusCounter
        .labels({
          checkType: "dataRetention",
          providerId: providerIdStr,
          providerStatus,
          value: "success",
        })
        .inc(Number(successDelta));
    }

    this.providerCumulativeTotals.set(normalizedAddress, {
      faultedPeriods: estimatedTotalFaulted,
      successPeriods: estimatedTotalSuccess,
    });
  }
}
