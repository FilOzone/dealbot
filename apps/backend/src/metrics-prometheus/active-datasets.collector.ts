import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Gauge } from "prom-client";
import type { Address } from "viem";
import { toStructuredError } from "../common/logging.js";
import type { Network } from "../common/types.js";
import type { IConfig } from "../config/index.js";
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
  private cachedAt = 0;
  private refreshPromise: Promise<void> | null = null;
  private readonly labelsByNetwork = new Map<Network, ActiveDataSetLabels[]>();

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
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
    const now = Date.now();
    if (now - this.cachedAt < this.cacheTtlMs) return;
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    this.refreshPromise = this.refresh(now).finally(() => {
      this.refreshPromise = null;
    });
    await this.refreshPromise;
  }

  private async refresh(now: number): Promise<void> {
    let allNetworksSucceeded = true;
    for (const network of this.configService.get("activeNetworks")) {
      const networkConfig = this.configService.get("networks")[network];
      this.expectedActiveDataSetsGauge.set({ network }, networkConfig.minNumDataSetsForChecks);

      try {
        const samples = await this.fetchNetworkSamples(network, networkConfig.walletAddress as Address);
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

    this.cachedAt = allNetworksSucceeded ? now : now - this.cacheTtlMs + this.errorCooldownMs;
  }

  private async fetchNetworkSamples(network: Network, walletAddress: Address): Promise<ActiveDataSetSample[]> {
    const { warmStorageService } = this.walletSdkService.getWalletServices(network);
    const dataSets: Awaited<ReturnType<typeof warmStorageService.getClientDataSets>> = [];
    const pageSize = 100n;
    let offset = 0n;

    // Own the pagination here instead of relying on the SDK's default fetch-all behavior. This
    // inventory is meant to detect create/reuse regressions, including a regression in the same
    // default-pagination path used by StorageContext.resolveByProviderId.
    while (true) {
      const page = await warmStorageService.getClientDataSets({ address: walletAddress, offset, limit: pageSize });
      dataSets.push(...page);
      if (page.length < Number(pageSize)) break;
      offset += BigInt(page.length);
    }
    const providers = this.walletSdkService.getAllActiveProviders(network);
    const providersById = new Map(providers.map((provider) => [provider.id.toString(), provider]));
    const counts = new Map<string, number>();

    for (const dataSet of dataSets) {
      if (dataSet.dataSetId === 0n || dataSet.pdpEndEpoch !== 0n) continue;
      const providerId = dataSet.providerId.toString();
      counts.set(providerId, (counts.get(providerId) ?? 0) + 1);
    }
    for (const provider of providers) counts.set(provider.id.toString(), counts.get(provider.id.toString()) ?? 0);

    return [...counts.entries()].map(([providerId, value]) => {
      const provider = providersById.get(providerId);
      return {
        network,
        providerId,
        providerName: provider?.name ?? "unknown",
        providerStatus: provider?.isApproved ? "approved" : "unapproved",
        value,
      };
    });
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
