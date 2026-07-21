import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Gauge } from "prom-client";
import { toStructuredError } from "../common/logging.js";
import type { Network } from "../common/types.js";
import type { IConfig } from "../config/index.js";
import { SubgraphService } from "../subgraph/subgraph.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

type ActiveDataSetLabels = {
  network: Network;
  providerId: string;
  providerName: string;
  providerStatus: "approved" | "unapproved";
};

type ActiveDataSetSample = ActiveDataSetLabels & { value: number };

/** Background inventory of the configured Dealbot wallet's active FWSS data sets. */
@Injectable()
export class ActiveDataSetsCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActiveDataSetsCollector.name);
  private readonly cacheTtlMs = 5 * 60 * 1000;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshPromise: Promise<void> | null = null;
  private stopped = false;
  private readonly labelsByNetwork = new Map<Network, ActiveDataSetLabels[]>();

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly subgraphService: SubgraphService,
    @InjectMetric("dealbot_active_datasets") private readonly activeDataSetsGauge: Gauge,
    @InjectMetric("dealbot_expected_active_datasets") private readonly expectedActiveDataSetsGauge: Gauge,
    @InjectMetric("dealbot_active_datasets_last_success_timestamp_seconds")
    private readonly lastSuccessTimestampGauge: Gauge,
    @InjectMetric("dealbot_subgraph_indexed_block_number") private readonly subgraphIndexedBlockGauge: Gauge,
  ) {}

  onModuleInit(): void {
    this.stopped = false;
    this.scheduleRefresh();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private scheduleRefresh(): void {
    void this.triggerRefresh()
      .catch((error) => {
        this.logger.error({
          event: "active_datasets_refresh_failed",
          message: "Unexpected failure refreshing active Dealbot data sets",
          error: toStructuredError(error),
        });
      })
      .finally(() => {
        if (!this.stopped) {
          this.refreshTimer = setTimeout(() => this.scheduleRefresh(), this.cacheTtlMs);
        }
      });
  }

  private async triggerRefresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.refresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async refresh(): Promise<void> {
    for (const network of this.configService.get("activeNetworks")) {
      const networkConfig = this.configService.get("networks")[network];
      if (!networkConfig.subgraphEndpoint) continue;
      this.expectedActiveDataSetsGauge.set({ network }, networkConfig.minNumDataSetsForChecks);

      try {
        const { samples, indexedAtBlock } = await this.fetchNetworkSamples(network, networkConfig.walletAddress);
        this.replaceNetworkSamples(network, samples);
        this.subgraphIndexedBlockGauge.set({ network }, indexedAtBlock);
        this.lastSuccessTimestampGauge.set({ network }, Math.floor(Date.now() / 1000));
      } catch (error) {
        this.logger.warn({
          event: "active_datasets_collect_failed",
          message: "Failed to collect active Dealbot data sets",
          network,
          wallet: networkConfig.walletAddress.slice(0, 8),
          error: toStructuredError(error),
        });
      }
    }
  }

  private async fetchNetworkSamples(
    network: Network,
    walletAddress: string,
  ): Promise<{ samples: ActiveDataSetSample[]; indexedAtBlock: number }> {
    const providers = this.walletSdkService.getAllActiveProviders(network);
    const { countsByAddress, indexedAtBlock } = await this.subgraphService.fetchActiveDataSetCounts(
      network,
      walletAddress,
    );

    return {
      indexedAtBlock,
      samples: providers.map((provider) => ({
        network,
        providerId: provider.id.toString(),
        providerName: provider.name,
        providerStatus: provider.isApproved ? "approved" : "unapproved",
        value: countsByAddress.get(provider.serviceProvider.toLowerCase()) ?? 0,
      })),
    };
  }

  private replaceNetworkSamples(network: Network, samples: ActiveDataSetSample[]): void {
    for (const labels of this.labelsByNetwork.get(network) ?? []) this.activeDataSetsGauge.remove(labels);

    const nextLabels: ActiveDataSetLabels[] = [];
    for (const { value, ...labels } of samples) {
      this.activeDataSetsGauge.set(labels, value);
      nextLabels.push(labels);
    }
    this.labelsByNetwork.set(network, nextLabels);
  }
}
