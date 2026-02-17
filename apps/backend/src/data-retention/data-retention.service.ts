import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter } from "prom-client";
import { IConfig } from "../config/app.config.js";
import { PDPSubgraphService } from "../pdp-subgraph/pdp-subgraph.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

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
    @InjectMetric("data_retention_periods_total")
    private readonly dataRetentionPeriodsTotalCounter: Counter,
  ) {
    this.providerCumulativeTotals = new Map();
  }

  /**
   * Polls the PDP subgraph for provider proof-set data, computes estimated
   * faulted and successful proving periods, and increments Prometheus counters
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
      const blockNumber = await this.walletSdkService.getBlockNumber();
      const providers = await this.pdpSubgraphService.fetchProvidersWithDatasets(blockNumber);

      for (const provider of providers) {
        const { address, totalFaultedPeriods, totalProvingPeriods, proofSets } = provider;

        const estimatedOverduePeriods = proofSets.reduce((acc, proofSet) => {
          if (proofSet.maxProvingPeriod === 0n) {
            return acc;
          }
          return acc + (BigInt(blockNumber) - (proofSet.nextDeadline + 1n)) / proofSet.maxProvingPeriod;
        }, 0n);

        const estimatedTotalFaulted = totalFaultedPeriods + estimatedOverduePeriods;
        const estimatedTotalPeriods = totalProvingPeriods + estimatedOverduePeriods;
        const estimatedTotalSuccess = estimatedTotalPeriods - estimatedTotalFaulted;

        const previous = this.providerCumulativeTotals.get(address);
        const faultedDelta = previous ? estimatedTotalFaulted - previous.faultedPeriods : estimatedTotalFaulted;
        const successDelta = previous ? estimatedTotalSuccess - previous.successPeriods : estimatedTotalSuccess;

        if (faultedDelta < 0n || successDelta < 0n) {
          this.logger.warn(
            `Negative delta detected for provider ${address} (faulted: ${faultedDelta}, success: ${successDelta}); skipping counter update`,
          );
        }

        if (faultedDelta > 0n) {
          this.dataRetentionPeriodsTotalCounter
            .labels({ status: "faulted", provider: address })
            .inc(Number(faultedDelta));
        }

        if (successDelta > 0n) {
          this.dataRetentionPeriodsTotalCounter
            .labels({ status: "success", provider: address })
            .inc(Number(successDelta));
        }

        this.providerCumulativeTotals.set(address, {
          faultedPeriods: estimatedTotalFaulted,
          successPeriods: estimatedTotalSuccess,
        });
      }
    } catch (error) {
      this.logger.error("Failed to poll data retention", error);
    }
  }
}
