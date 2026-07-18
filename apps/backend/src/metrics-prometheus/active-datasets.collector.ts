import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
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

/** TTL-cached inventory of the configured Dealbot wallet's active FWSS data sets. */
@Injectable()
export class ActiveDataSetsCollector implements OnModuleInit {
  private readonly logger = new Logger(ActiveDataSetsCollector.name);
  private readonly cacheTtlMs = 5 * 60 * 1000;
  private readonly errorCooldownMs = 60 * 1000;
  private nextRefreshAt = 0;
  private refreshPromise: Promise<void> | null = null;
  private readonly labelsByNetwork = new Map<Network, ActiveDataSetLabels[]>();

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly subgraphService: SubgraphService,
    @InjectMetric("dealbot_active_datasets") private readonly activeDataSetsGauge: Gauge,
    @InjectMetric("dealbot_expected_active_datasets") private readonly expectedActiveDataSetsGauge: Gauge,
    @InjectMetric("dealbot_active_datasets_last_success_timestamp_seconds")
    private readonly lastSuccessTimestampGauge: Gauge,
  ) {}

  onModuleInit(): void {
    // prom-client collects registered metrics concurrently. Attach the same guarded refresh
    // to all three gauges so the expected/freshness samples cannot race ahead of the inventory
    // update on the first scrape.
    for (const metric of [this.activeDataSetsGauge, this.expectedActiveDataSetsGauge, this.lastSuccessTimestampGauge]) {
      const gauge = metric as Gauge & { collect: () => Promise<void> };
      gauge.collect = async () => this.collect();
    }
  }

  private async collect(): Promise<void> {
    if (Date.now() < this.nextRefreshAt) return;
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    this.refreshPromise = this.refresh().finally(() => {
      this.refreshPromise = null;
    });
    await this.refreshPromise;
  }

  private async refresh(): Promise<void> {
    let allNetworksSucceeded = true;
    for (const network of this.configService.get("activeNetworks")) {
      const networkConfig = this.configService.get("networks")[network];
      this.expectedActiveDataSetsGauge.set({ network }, networkConfig.minNumDataSetsForChecks);

      try {
        const samples = await this.fetchNetworkSamples(network, networkConfig.walletAddress);
        this.replaceNetworkSamples(network, samples);
        this.lastSuccessTimestampGauge.set({ network }, Math.floor(Date.now() / 1000));
      } catch (error) {
        allNetworksSucceeded = false;
        this.logger.warn({
          event: "active_datasets_collect_failed",
          message: "Failed to collect active Dealbot data sets",
          network,
          wallet: networkConfig.walletAddress.slice(0, 8),
          error: toStructuredError(error),
        });
      }
    }

    const completedAt = Date.now();
    this.nextRefreshAt = completedAt + (allNetworksSucceeded ? this.cacheTtlMs : this.errorCooldownMs);
  }

  private async fetchNetworkSamples(network: Network, walletAddress: string): Promise<ActiveDataSetSample[]> {
    const providers = this.walletSdkService.getAllActiveProviders(network);
    const countsByAddress = await this.subgraphService.fetchActiveDataSetCounts(network, walletAddress);

    return providers.map((provider) => ({
      network,
      providerId: provider.id.toString(),
      providerName: provider.name,
      providerStatus: provider.isApproved ? "approved" : "unapproved",
      value: countsByAddress.get(provider.serviceProvider.toLowerCase()) ?? 0,
    }));
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
