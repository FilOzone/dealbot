import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { Deal } from "../../database/entities/deal.entity.js";
import { MetricsDaily } from "../../database/entities/metrics-daily.entity.js";
import { Retrieval } from "../../database/entities/retrieval.entity.js";
import { SpPerformanceAllTime } from "../../database/entities/sp-performance-all-time.entity.js";
import { SpPerformanceLastWeek } from "../../database/entities/sp-performance-last-week.entity.js";
import { StorageProvider } from "../../database/entities/storage-provider.entity.js";
import { DealStatus, IpniStatus, MetricType, RetrievalStatus, ServiceType } from "../../database/types.js";
import type { ProviderPerformanceDto, ProviderWindowPerformanceDto } from "../dto/provider-performance.dto.js";
import { calculateTimeWindow, parseCustomDateRange, sanitizePreset } from "../utils/time-window-parser.js";

/**
 * Service for querying pre-computed metrics from materialized views
 *
 * This service provides fast read access to aggregated performance metrics
 * without performing expensive calculations on-the-fly.
 *
 * All data is read from materialized views that are refreshed periodically
 * by the MetricsRefreshService.
 */
@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    @InjectRepository(SpPerformanceLastWeek)
    private readonly lastWeekPerformanceRepo: Repository<SpPerformanceLastWeek>,
    @InjectRepository(SpPerformanceAllTime)
    private readonly allTimePerformanceRepo: Repository<SpPerformanceAllTime>,
    @InjectRepository(MetricsDaily)
    private readonly dailyMetricsRepo: Repository<MetricsDaily>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
    @InjectRepository(Retrieval)
    private readonly retrievalRepo: Repository<Retrieval>,
  ) {}

  /**
   * Get Providers list
   */
  async getProvidersList(options?: {
    activeOnly?: boolean;
    approvedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ providers: StorageProvider[]; total: number }> {
    const query = this.spRepository.createQueryBuilder("sp");

    if (options?.activeOnly) {
      query.andWhere("sp.is_active = true");
    }

    if (options?.approvedOnly) {
      query.andWhere("sp.is_approved = true");
    }

    const total = await query.getCount();

    // Apply pagination
    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    const providers = await query.getMany();

    return { providers, total };
  }

  /**
   * Get Provider
   */
  async getProvider(address: string): Promise<StorageProvider> {
    const provider = await this.spRepository.findOne({ where: { address } });

    if (!provider) {
      throw new NotFoundException(`Provider not found for address ${address}`);
    }

    return provider;
  }

  /**
   * Get weekly performance for a specific storage provider
   */
  async getWeeklyPerformance(spAddress: string): Promise<SpPerformanceLastWeek | null> {
    const performance = await this.lastWeekPerformanceRepo.findOne({
      where: { spAddress },
    });

    if (!performance) {
      return null;
    }

    return performance;
  }

  /**
   * Get all-time performance for a specific storage provider
   */
  async getAllTimePerformance(spAddress: string): Promise<SpPerformanceAllTime | null> {
    const performance = await this.allTimePerformanceRepo.findOne({
      where: { spAddress },
    });

    if (!performance) {
      return null;
    }

    return performance;
  }

  /**
   * Get combined performance metrics (weekly + all-time) for a storage provider
   */
  async getCombinedPerformance(spAddress: string): Promise<{
    weekly: SpPerformanceLastWeek | null;
    allTime: SpPerformanceAllTime | null;
  }> {
    const [weekly, allTime] = await Promise.all([
      this.getWeeklyPerformance(spAddress),
      this.getAllTimePerformance(spAddress),
    ]);

    return { weekly, allTime };
  }

  /**
   * List all storage providers with their weekly performance
   * Sorted by health score (descending)
   */
  async listProvidersWeekly(options?: {
    minHealthScore?: number;
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ providers: SpPerformanceLastWeek[]; total: number }> {
    const query = this.lastWeekPerformanceRepo.createQueryBuilder("sp");

    // Filter by minimum health score
    if (options?.minHealthScore !== undefined) {
      query.andWhere(
        `(
          CASE 
            WHEN (sp.total_deals_7d > 0 OR sp.total_retrievals_7d > 0)
            THEN (COALESCE(sp.deal_success_rate_7d, 0) * 0.6 + COALESCE(sp.retrieval_success_rate_7d, 0) * 0.4)
            ELSE 0
          END
        ) >= :minHealthScore`,
        { minHealthScore: options.minHealthScore },
      );
    }

    // Filter active providers only
    if (options?.activeOnly) {
      query.andWhere("(sp.total_deals_7d > 0 OR sp.total_retrievals_7d > 0)");
    }

    // Get total count
    const total = await query.getCount();

    // Apply sorting (by health score descending)
    query.orderBy(
      `(
        CASE 
          WHEN (sp.total_deals_7d > 0 OR sp.total_retrievals_7d > 0)
          THEN (COALESCE(sp.deal_success_rate_7d, 0) * 0.6 + COALESCE(sp.retrieval_success_rate_7d, 0) * 0.4)
          ELSE 0
        END
      )`,
      "DESC",
    );

    // Apply pagination
    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    const providers = await query.getMany();

    return { providers, total };
  }

  /**
   * List all storage providers with their all-time performance
   * Sorted by reliability score (descending)
   */
  async listProvidersAllTime(options?: {
    minReliabilityScore?: number;
    experienceLevel?: "new" | "intermediate" | "experienced" | "veteran";
    limit?: number;
    offset?: number;
  }): Promise<{ providers: SpPerformanceAllTime[]; total: number }> {
    const query = this.allTimePerformanceRepo.createQueryBuilder("sp");

    // Filter by minimum reliability score
    if (options?.minReliabilityScore !== undefined) {
      query.andWhere(
        `(
          CASE 
            WHEN (sp.total_deals > 0 OR sp.total_retrievals > 0)
            THEN (COALESCE(sp.deal_success_rate, 0) * 0.6 + COALESCE(sp.retrieval_success_rate, 0) * 0.4)
            ELSE 0
          END
        ) >= :minReliabilityScore`,
        { minReliabilityScore: options.minReliabilityScore },
      );
    }

    // Filter by experience level
    if (options?.experienceLevel) {
      const ranges = {
        new: [0, 10],
        intermediate: [10, 100],
        experienced: [100, 1000],
        veteran: [1000, Number.MAX_SAFE_INTEGER],
      };

      const [min, max] = ranges[options.experienceLevel];
      query.andWhere("(sp.total_deals + sp.total_retrievals) >= :min", { min });
      query.andWhere("(sp.total_deals + sp.total_retrievals) < :max", { max });
    }

    // Get total count
    const total = await query.getCount();

    // Apply sorting (by reliability score descending)
    query.orderBy(
      `(
        CASE 
          WHEN (sp.total_deals > 0 OR sp.total_retrievals > 0)
          THEN (COALESCE(sp.deal_success_rate, 0) * 0.6 + COALESCE(sp.retrieval_success_rate, 0) * 0.4)
          ELSE 0
        END
      )`,
      "DESC",
    );

    // Apply pagination
    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    const providers = await query.getMany();

    return { providers, total };
  }

  /**
   * Compare multiple storage providers side-by-side
   */
  async compareProviders(spAddresses: string[]): Promise<{
    weekly: SpPerformanceLastWeek[];
    allTime: SpPerformanceAllTime[];
  }> {
    if (spAddresses.length === 0) {
      return { weekly: [], allTime: [] };
    }

    if (spAddresses.length > 10) {
      throw new Error("Cannot compare more than 10 providers at once");
    }

    const [weekly, allTime] = await Promise.all([
      this.lastWeekPerformanceRepo
        .createQueryBuilder("sp")
        .where("sp.sp_address IN (:...addresses)", { addresses: spAddresses })
        .getMany(),
      this.allTimePerformanceRepo
        .createQueryBuilder("sp")
        .where("sp.sp_address IN (:...addresses)", { addresses: spAddresses })
        .getMany(),
    ]);

    return { weekly, allTime };
  }

  /**
   * Get daily metrics time series for a storage provider
   */
  async getDailyMetricsTimeSeries(
    spAddress: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    },
  ): Promise<MetricsDaily[]> {
    const query = this.dailyMetricsRepo
      .createQueryBuilder("md")
      .where("md.sp_address = :spAddress", { spAddress })
      .orderBy("md.date", "DESC");

    if (options?.startDate) {
      query.andWhere("md.date >= :startDate", { startDate: options.startDate });
    }

    if (options?.endDate) {
      query.andWhere("md.date <= :endDate", { endDate: options.endDate });
    }

    if (options?.limit) {
      query.limit(options.limit);
    }

    return await query.getMany();
  }

  /**
   * Get aggregated daily metrics across all providers
   */
  async getAggregatedDailyMetrics(options?: { startDate?: Date; endDate?: Date }): Promise<
    Array<{
      date: Date;
      totalDeals: number;
      successfulDeals: number;
      totalRetrievals: number;
      successfulRetrievals: number;
      avgDealLatencyMs: number;
      avgRetrievalLatencyMs: number;
    }>
  > {
    const query = this.dailyMetricsRepo
      .createQueryBuilder("md")
      .select("md.date", "date")
      .addSelect("SUM(md.total_deals)", "totalDeals")
      .addSelect("SUM(md.successful_deals)", "successfulDeals")
      .addSelect("SUM(md.total_retrievals)", "totalRetrievals")
      .addSelect("SUM(md.successful_retrievals)", "successfulRetrievals")
      .addSelect("ROUND(AVG(md.avg_deal_latency_ms), 2)", "avgDealLatencyMs")
      .addSelect("ROUND(AVG(md.avg_retrieval_latency_ms), 2)", "avgRetrievalLatencyMs")
      .groupBy("md.date")
      .orderBy("md.date", "DESC");

    if (options?.startDate) {
      query.andWhere("md.date >= :startDate", { startDate: options.startDate });
    }

    if (options?.endDate) {
      query.andWhere("md.date <= :endDate", { endDate: options.endDate });
    }

    return await query.getRawMany();
  }

  /**
   * Get top performing providers by specific metric
   */
  async getTopProviders(
    metric: "deal_success_rate" | "retrieval_success_rate" | "deal_latency" | "retrieval_latency",
    options?: {
      period?: "last_week" | "all_time";
      limit?: number;
    },
  ): Promise<SpPerformanceLastWeek[] | SpPerformanceAllTime[]> {
    const period = options?.period || "last_week";
    const limit = options?.limit || 10;

    if (period === "last_week") {
      const query = this.lastWeekPerformanceRepo.createQueryBuilder("sp");

      switch (metric) {
        case "deal_success_rate":
          query.orderBy("sp.deal_success_rate", "DESC");
          break;
        case "retrieval_success_rate":
          query.orderBy("sp.retrieval_success_rate", "DESC");
          break;
        case "deal_latency":
          query.orderBy("sp.avg_deal_latency_ms", "ASC");
          break;
        case "retrieval_latency":
          query.orderBy("sp.avg_retrieval_latency_ms", "ASC");
          break;
      }

      return await query.limit(limit).getMany();
    } else {
      const query = this.allTimePerformanceRepo.createQueryBuilder("sp");

      switch (metric) {
        case "deal_success_rate":
          query.orderBy("sp.deal_success_rate", "DESC");
          break;
        case "retrieval_success_rate":
          query.orderBy("sp.retrieval_success_rate", "DESC");
          break;
        case "deal_latency":
          query.orderBy("sp.avg_deal_latency_ms", "ASC");
          break;
        case "retrieval_latency":
          query.orderBy("sp.avg_retrieval_latency_ms", "ASC");
          break;
      }

      return await query.limit(limit).getMany();
    }
  }

  /**
   * Get Curio versions for multiple storage providers in batch
   */
  async getProviderCurioVersionsBatch(spAddresses: string[]): Promise<Record<string, string>> {
    this.logger.debug(`Batch fetching versions for ${spAddresses.length} providers`);

    // Fetch all versions in parallel
    const versionPromises = spAddresses.map(async (spAddress) => {
      try {
        const version = await this.getProviderCurioVersion(spAddress);
        return { spAddress, version };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to fetch version for ${spAddress}: ${errorMessage}`);
        return { spAddress, version: null };
      }
    });

    const results = await Promise.all(versionPromises);

    // Convert to object map, filtering out failed requests
    const versionMap: Record<string, string> = {};
    for (const result of results) {
      if (result.version) {
        versionMap[result.spAddress] = result.version;
      }
    }

    return versionMap;
  }

  /**
   * Get Curio version from a storage provider's service URL
   */
  async getProviderCurioVersion(spAddress: string): Promise<string> {
    // Get provider to retrieve service URL
    const provider = await this.getProvider(spAddress);

    if (!provider.serviceUrl) {
      throw new NotFoundException(`Service URL not available for provider ${spAddress}`);
    }

    try {
      const versionUrl = `${provider.serviceUrl}/version`;
      this.logger.debug(`Fetching version from: ${versionUrl}`);

      const response = await fetch(versionUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; DealBot/1.0)",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const version = await response.text();
      this.logger.debug(`Retrieved version for ${spAddress}: ${version}`);

      return version;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch version for ${spAddress}: ${errorMessage}`);
      throw new NotFoundException(`Unable to fetch version from provider ${spAddress}: ${errorMessage}`);
    }
  }

  /**
   * Get provider performance for a preset time window
   * Uses materialized views when possible (7d, all), falls back to dynamic aggregation
   */
  async getPresetWindowPerformance(spAddress: string, preset: string): Promise<ProviderWindowPerformanceDto> {
    // Sanitize input
    const sanitized = sanitizePreset(preset);

    try {
      // Calculate time window
      const timeWindow = calculateTimeWindow(sanitized);

      // Get provider info
      const provider = await this.getProvider(spAddress);

      // Use materialized views for 7d and all-time (fast path)
      if (sanitized === "7d") {
        const weekly = await this.getWeeklyPerformance(spAddress);
        if (!weekly) {
          throw new NotFoundException(`No metrics found for provider ${spAddress} in last 7 days`);
        }

        return {
          provider,
          window: {
            startDate: timeWindow.startDate.toISOString(),
            endDate: timeWindow.endDate.toISOString(),
            days: timeWindow.days,
            preset: sanitized,
          },
          metrics: this.mapEntityToPerformanceDto(weekly),
        };
      }

      if (sanitized === "all") {
        const allTime = await this.getAllTimePerformance(spAddress);
        if (!allTime) {
          throw new NotFoundException(`No metrics found for provider ${spAddress}`);
        }

        return {
          provider,
          window: {
            startDate: timeWindow.startDate.toISOString(),
            endDate: timeWindow.endDate.toISOString(),
            days: timeWindow.days,
            preset: sanitized,
          },
          metrics: this.mapEntityToPerformanceDto(allTime),
        };
      }

      // For other presets - choose aggregation strategy based on window size
      const hoursDiff = (timeWindow.endDate.getTime() - timeWindow.startDate.getTime()) / (1000 * 60 * 60);

      // For windows < 24 hours, aggregate from raw deals/retrievals tables
      if (hoursDiff < 24) {
        this.logger.debug(`Using raw aggregation for ${sanitized} (${hoursDiff}h < 24h)`);
        return this.aggregateFromRawTables(provider, timeWindow.startDate, timeWindow.endDate, sanitized);
      }

      // For windows >= 24 hours, aggregate from metrics_daily
      this.logger.debug(`Using daily metrics aggregation for ${sanitized} (${hoursDiff}h >= 24h)`);
      return this.aggregateWindowMetrics(provider, timeWindow.startDate, timeWindow.endDate, sanitized);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Invalid time window preset: ${errorMessage}`);
    }
  }

  /**
   * Get provider performance for a custom date range
   */
  async getCustomWindowPerformance(
    spAddress: string,
    startDateStr: string,
    endDateStr: string,
  ): Promise<ProviderWindowPerformanceDto> {
    try {
      // Parse and validate date range
      const timeWindow = parseCustomDateRange(startDateStr, endDateStr);

      // Get provider info
      const provider = await this.getProvider(spAddress);

      // Choose aggregation strategy based on window size
      const hoursDiff = (timeWindow.endDate.getTime() - timeWindow.startDate.getTime()) / (1000 * 60 * 60);

      // For windows < 24 hours, aggregate from raw deals/retrievals tables
      if (hoursDiff < 24) {
        this.logger.debug(`Using raw aggregation for custom range (${hoursDiff}h < 24h)`);
        return this.aggregateFromRawTables(provider, timeWindow.startDate, timeWindow.endDate, null);
      }

      // For windows >= 24 hours, aggregate from metrics_daily
      this.logger.debug(`Using daily metrics aggregation for custom range (${hoursDiff}h >= 24h)`);
      return this.aggregateWindowMetrics(provider, timeWindow.startDate, timeWindow.endDate, null);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Invalid date range: ${errorMessage}`);
    }
  }

  /**
   * Aggregate metrics from raw deals and retrievals tables for sub-24h windows
   * @private
   */
  private async aggregateFromRawTables(
    provider: StorageProvider,
    startDate: Date,
    endDate: Date,
    preset: string | null,
  ): Promise<ProviderWindowPerformanceDto> {
    this.logger.debug(`Aggregating from raw tables for ${provider.address}: ${startDate} to ${endDate}`);

    // Query raw deals within time window
    const deals = await this.dealRepo
      .createQueryBuilder("d")
      .where("d.sp_address = :spAddress", { spAddress: provider.address })
      .andWhere("d.created_at >= :startDate", { startDate })
      .andWhere("d.created_at <= :endDate", { endDate })
      .getMany();

    // Query raw retrievals within time window (join with deals to get sp_address)
    const retrievals = await this.retrievalRepo
      .createQueryBuilder("r")
      .innerJoin("r.deal", "d")
      .where("d.sp_address = :spAddress", { spAddress: provider.address })
      .andWhere("r.service_type = :serviceType", { serviceType: ServiceType.DIRECT_SP })
      .andWhere("r.created_at >= :startDate", { startDate })
      .andWhere("r.created_at <= :endDate", { endDate })
      .getMany();

    if (deals.length === 0 && retrievals.length === 0) {
      return this.getEmptyWindowResponse(provider, startDate, endDate, preset);
    }

    // Aggregate deal metrics
    let totalDeals = 0;
    let successfulDeals = 0;
    let failedDeals = 0;
    let totalIpniDeals = 0;
    let ipniIndexedDeals = 0;
    let ipniAdvertisedDeals = 0;
    let ipniRetrievedDeals = 0;
    let ipniFailedDeals = 0;
    let timeToIndexSum = 0;
    let timeToAdvertiseSum = 0;
    let timeToRetrieveSum = 0;
    let dealLatencySum = 0;
    let ingestLatencySum = 0;
    let chainLatencySum = 0;
    let ingestThroughputSum = 0;
    let totalDataStoredBytes = BigInt(0);
    let lastDealAt: Date | null = null;

    for (const deal of deals) {
      totalDeals++;

      if (deal.status === DealStatus.DEAL_CREATED) {
        successfulDeals++;
        totalDataStoredBytes += BigInt(deal.fileSize || 0);

        if (deal.dealLatencyMs) dealLatencySum += deal.dealLatencyMs;
        if (deal.ingestLatencyMs) ingestLatencySum += deal.ingestLatencyMs;
        if (deal.chainLatencyMs) chainLatencySum += deal.chainLatencyMs;
        if (deal.ingestThroughputBps) ingestThroughputSum += deal.ingestThroughputBps;
        if (deal.serviceTypes.includes(ServiceType.IPFS_PIN)) {
          totalIpniDeals++;
          if (deal.ipniStatus === IpniStatus.INDEXED) ipniIndexedDeals++;
          if (deal.ipniStatus === IpniStatus.ADVERTISED) ipniAdvertisedDeals++;
          if (deal.ipniStatus === IpniStatus.RETRIEVED) ipniRetrievedDeals++;
          if (deal.ipniStatus === IpniStatus.FAILED) ipniFailedDeals++;
          if (deal.ipniTimeToIndexMs) timeToIndexSum += deal.ipniTimeToIndexMs;
          if (deal.ipniTimeToAdvertiseMs) timeToAdvertiseSum += deal.ipniTimeToAdvertiseMs;
          if (deal.ipniTimeToRetrieveMs) timeToRetrieveSum += deal.ipniTimeToRetrieveMs;
        }
      } else if (deal.status === DealStatus.FAILED) {
        failedDeals++;
      }

      if (!lastDealAt || deal.createdAt > lastDealAt) {
        lastDealAt = deal.createdAt;
      }
    }

    // Aggregate retrieval metrics
    let totalRetrievals = 0;
    let totalIpfsRetrievals = 0;
    let successfulRetrievals = 0;
    let successfulIpfsRetrievals = 0;
    let failedRetrievals = 0;
    let failedIpfsRetrievals = 0;
    let retrievalLatencySum = 0;
    let retrievalIpfsLatencySum = 0;
    let retrievalTtfbSum = 0;
    let retrievalIpfsTtfbSum = 0;
    let retrievalThroughputSum = 0;
    let retrievalIpfsThroughputSum = 0;
    let totalDataRetrievedBytes = BigInt(0);
    let lastRetrievalAt: Date | null = null;

    for (const retrieval of retrievals) {
      totalRetrievals++;
      if (retrieval.serviceType === ServiceType.IPFS_PIN) totalIpfsRetrievals++;

      if (retrieval.status === RetrievalStatus.SUCCESS) {
        successfulRetrievals++;
        if (retrieval.latencyMs) retrievalLatencySum += retrieval.latencyMs;
        if (retrieval.ttfbMs) retrievalTtfbSum += retrieval.ttfbMs;
        if (retrieval.throughputBps) retrievalThroughputSum += retrieval.throughputBps;
        if (retrieval.bytesRetrieved) totalDataRetrievedBytes += BigInt(retrieval.bytesRetrieved);

        if (retrieval.serviceType === ServiceType.IPFS_PIN) {
          successfulIpfsRetrievals++;
          if (retrieval.latencyMs) retrievalIpfsLatencySum += retrieval.latencyMs;
          if (retrieval.ttfbMs) retrievalIpfsTtfbSum += retrieval.ttfbMs;
          if (retrieval.throughputBps) retrievalIpfsThroughputSum += retrieval.throughputBps;
          if (retrieval.bytesRetrieved) totalDataRetrievedBytes += BigInt(retrieval.bytesRetrieved);
        }
      } else if (retrieval.status === RetrievalStatus.FAILED || retrieval.status === RetrievalStatus.TIMEOUT) {
        failedRetrievals++;
        if (retrieval.serviceType === ServiceType.IPFS_PIN) failedIpfsRetrievals++;
      }

      if (!lastRetrievalAt || retrieval.createdAt > lastRetrievalAt) {
        lastRetrievalAt = retrieval.createdAt;
      }
    }

    // Calculate rates and averages
    const dealSuccessRate = totalDeals > 0 ? (successfulDeals / totalDeals) * 100 : 0;
    const ipniSuccessRate = totalIpniDeals > 0 ? (ipniIndexedDeals / totalIpniDeals) * 100 : 0;
    const retrievalSuccessRate = totalRetrievals > 0 ? (successfulRetrievals / totalRetrievals) * 100 : 0;
    const ipfsRetrievalSuccessRate =
      totalIpfsRetrievals > 0 ? (successfulIpfsRetrievals / totalIpfsRetrievals) * 100 : 0;

    const avgDealLatencyMs = successfulDeals > 0 ? Math.round(dealLatencySum / successfulDeals) : 0;
    const avgIngestLatencyMs = successfulDeals > 0 ? Math.round(ingestLatencySum / successfulDeals) : 0;
    const avgChainLatencyMs = successfulDeals > 0 ? Math.round(chainLatencySum / successfulDeals) : 0;
    const avgIngestThroughputBps = successfulDeals > 0 ? Math.round(ingestThroughputSum / successfulDeals) : 0;
    const avgIpniTimeToIndexMs = totalIpniDeals > 0 ? Math.round(timeToIndexSum / totalIpniDeals) : 0;
    const avgIpniTimeToAdvertiseMs = totalIpniDeals > 0 ? Math.round(timeToAdvertiseSum / totalIpniDeals) : 0;
    const avgIpniTimeToRetrieveMs = totalIpniDeals > 0 ? Math.round(timeToRetrieveSum / totalIpniDeals) : 0;

    const avgRetrievalLatencyMs = successfulRetrievals > 0 ? Math.round(retrievalLatencySum / successfulRetrievals) : 0;
    const avgRetrievalTtfbMs = successfulRetrievals > 0 ? Math.round(retrievalTtfbSum / successfulRetrievals) : 0;
    const avgRetrievalThroughputBps =
      successfulRetrievals > 0 ? Math.round(retrievalThroughputSum / successfulRetrievals) : 0;
    const avgIpfsRetrievalLatencyMs =
      totalIpfsRetrievals > 0 ? Math.round(retrievalIpfsLatencySum / totalIpfsRetrievals) : 0;
    const avgIpfsRetrievalTtfbMs = totalIpfsRetrievals > 0 ? Math.round(retrievalIpfsTtfbSum / totalIpfsRetrievals) : 0;
    const avgIpfsRetrievalThroughputBps =
      totalIpfsRetrievals > 0 ? Math.round(retrievalIpfsThroughputSum / totalIpfsRetrievals) : 0;

    // Calculate health score
    const healthScore =
      totalDeals > 0 || totalRetrievals > 0 ? Math.round(dealSuccessRate * 0.6 + retrievalSuccessRate * 0.4) : 0;

    // Calculate average deal size
    const avgDealSize = successfulDeals > 0 ? Math.round(Number(totalDataStoredBytes) / successfulDeals) : null;

    // Calculate days
    const days = Math.round(((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) * 10) / 10;

    return {
      provider,
      window: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days,
        preset,
      },
      metrics: {
        spAddress: provider.address,
        totalDeals,
        successfulDeals,
        failedDeals,
        dealSuccessRate: Math.round(dealSuccessRate * 10) / 10,
        avgIngestLatencyMs,
        avgChainLatencyMs,
        avgDealLatencyMs,
        avgIngestThroughputBps,
        totalDataStoredBytes: totalDataStoredBytes.toString(),
        totalRetrievals,
        successfulRetrievals,
        failedRetrievals,
        retrievalSuccessRate: Math.round(retrievalSuccessRate * 10) / 10,
        avgRetrievalLatencyMs,
        avgRetrievalTtfbMs,
        avgRetrievalThroughputBps,
        totalDataRetrievedBytes: totalDataRetrievedBytes.toString(),
        totalIpniDeals,
        ipniIndexedDeals,
        ipniAdvertisedDeals,
        ipniRetrievedDeals,
        ipniFailedDeals,
        ipniSuccessRate,
        avgIpniTimeToIndexMs,
        avgIpniTimeToAdvertiseMs,
        avgIpniTimeToRetrieveMs,
        totalIpfsRetrievals,
        successfulIpfsRetrievals,
        failedIpfsRetrievals,
        ipfsRetrievalSuccessRate,
        avgIpfsRetrievalLatencyMs,
        avgIpfsRetrievalTtfbMs,
        avgIpfsRetrievalThroughputBps,
        healthScore,
        avgDealSize: avgDealSize ?? undefined,
        lastDealAt: lastDealAt || new Date(0),
        lastRetrievalAt: lastRetrievalAt || new Date(0),
        refreshedAt: new Date(),
      },
    };
  }

  /**
   * Aggregate metrics from metrics_daily table for a time window
   * @private
   */
  private async aggregateWindowMetrics(
    provider: StorageProvider,
    startDate: Date,
    endDate: Date,
    preset: string | null,
  ): Promise<ProviderWindowPerformanceDto> {
    const metrics = await this.dailyMetricsRepo
      .createQueryBuilder("md")
      .where("md.sp_address = :spAddress", { spAddress: provider.address })
      .andWhere("md.daily_bucket >= :startDate", { startDate })
      .andWhere("md.daily_bucket <= :endDate", { endDate })
      .andWhere(
        "(md.metric_type = :dealType OR (md.metric_type = :retrievalType AND md.service_type = :serviceType))",
        {
          dealType: MetricType.DEAL,
          retrievalType: MetricType.RETRIEVAL,
          serviceType: ServiceType.DIRECT_SP,
        },
      )
      .orderBy("md.daily_bucket", "DESC")
      .getMany();

    if (metrics.length === 0) {
      return this.getEmptyWindowResponse(provider, startDate, endDate, preset);
    }

    // Aggregate metrics
    const aggregated = this.aggregateMetrics(metrics);

    // Calculate days
    const days = Math.round(((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) * 10) / 10;

    return {
      provider,
      window: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days,
        preset,
      },
      metrics: aggregated,
    };
  }

  /**
   * Aggregate multiple daily metrics into a single performance DTO
   * @private
   */
  private aggregateMetrics(metrics: MetricsDaily[]): ProviderPerformanceDto {
    // Initialize accumulators
    let totalDeals = 0;
    let successfulDeals = 0;
    let failedDeals = 0;
    let totalRetrievals = 0;
    let successfulRetrievals = 0;
    let failedRetrievals = 0;
    let totalIpniDeals = 0;
    let ipniIndexedDeals = 0;
    let ipniAdvertisedDeals = 0;
    let ipniRetrievedDeals = 0;
    let ipniFailedDeals = 0;
    let totalIpfsRetrievals = 0;
    let successfulIpfsRetrievals = 0;
    let failedIpfsRetrievals = 0;

    let dealLatencySum = 0;
    let dealLatencyCount = 0;
    let ingestLatencySum = 0;
    let ingestLatencyCount = 0;
    let chainLatencySum = 0;
    let chainLatencyCount = 0;
    let retrievalLatencySum = 0;
    let retrievalLatencyCount = 0;
    let retrievalTtfbSum = 0;
    let retrievalTtfbCount = 0;
    let timeToIndexSum = 0;
    let timeToIndexCount = 0;
    let timeToAdvertiseSum = 0;
    let timeToAdvertiseCount = 0;
    let timeToRetrieveSum = 0;
    let timeToRetrieveCount = 0;
    let retrievalIpfsLatencySum = 0;
    let retrievalIpfsLatencyCount = 0;
    let retrievalIpfsTtfbSum = 0;
    let retrievalIpfsTtfbCount = 0;

    let ingestThroughputSum = 0;
    let ingestThroughputCount = 0;
    let retrievalThroughputSum = 0;
    let retrievalThroughputCount = 0;
    let retrievalIpfsThroughputSum = 0;
    let retrievalIpfsThroughputCount = 0;

    let totalDataStoredBytes = BigInt(0);
    let totalDataRetrievedBytes = BigInt(0);

    let lastDealAt: Date | null = null;
    let lastRetrievalAt: Date | null = null;

    // Aggregate across all daily metrics
    for (const metric of metrics) {
      // Deal metrics
      if (metric.metricType === MetricType.DEAL) {
        totalDeals += metric.totalDeals || 0;
        successfulDeals += metric.successfulDeals || 0;
        failedDeals += metric.failedDeals || 0;
        totalDataStoredBytes += BigInt(metric.totalDataStoredBytes || 0);

        if (metric.avgDealLatencyMs) {
          dealLatencySum += metric.avgDealLatencyMs * (metric.totalDeals || 0);
          dealLatencyCount += metric.totalDeals || 0;
        }

        if (metric.avgIngestLatencyMs) {
          ingestLatencySum += metric.avgIngestLatencyMs * (metric.totalDeals || 0);
          ingestLatencyCount += metric.totalDeals || 0;
        }

        if (metric.avgChainLatencyMs) {
          chainLatencySum += metric.avgChainLatencyMs * (metric.totalDeals || 0);
          chainLatencyCount += metric.totalDeals || 0;
        }

        if (metric.avgIngestThroughputBps) {
          ingestThroughputSum += metric.avgIngestThroughputBps * (metric.totalDeals || 0);
          ingestThroughputCount += metric.totalDeals || 0;
        }

        // Track last deal date
        if (metric.totalDeals > 0) {
          if (!lastDealAt || metric.dailyBucket > lastDealAt) {
            lastDealAt = metric.dailyBucket;
          }
        }

        if (metric.serviceType === ServiceType.IPFS_PIN) {
          totalIpniDeals += metric.totalIpniDeals;
          ipniIndexedDeals += metric.ipniIndexedDeals;
          ipniAdvertisedDeals += metric.ipniAdvertisedDeals;
          ipniRetrievedDeals += metric.ipniRetrievedDeals;
          ipniFailedDeals += metric.ipniFailedDeals;

          if (metric.avgIpniTimeToIndexMs) {
            timeToIndexSum += metric.avgIpniTimeToIndexMs * (metric.totalIpniDeals || 0);
            timeToIndexCount += metric.totalIpniDeals || 0;
          }

          if (metric.avgIpniTimeToAdvertiseMs) {
            timeToAdvertiseSum += metric.avgIpniTimeToAdvertiseMs * (metric.totalIpniDeals || 0);
            timeToAdvertiseCount += metric.totalIpniDeals || 0;
          }

          if (metric.avgIpniTimeToRetrieveMs) {
            timeToRetrieveSum += metric.avgIpniTimeToRetrieveMs * (metric.totalIpniDeals || 0);
            timeToRetrieveCount += metric.totalIpniDeals || 0;
          }
        }
      }

      // Retrieval metrics
      if (metric.metricType === MetricType.RETRIEVAL) {
        totalRetrievals += metric.totalRetrievals || 0;
        successfulRetrievals += metric.successfulRetrievals || 0;
        failedRetrievals += metric.failedRetrievals || 0;
        totalDataRetrievedBytes += BigInt(metric.totalDataRetrievedBytes || 0);

        if (metric.avgRetrievalLatencyMs) {
          retrievalLatencySum += metric.avgRetrievalLatencyMs * (metric.totalRetrievals || 0);
          retrievalLatencyCount += metric.totalRetrievals || 0;
        }

        if (metric.avgRetrievalTtfbMs) {
          retrievalTtfbSum += metric.avgRetrievalTtfbMs * (metric.totalRetrievals || 0);
          retrievalTtfbCount += metric.totalRetrievals || 0;
        }

        if (metric.avgRetrievalThroughputBps) {
          retrievalThroughputSum += metric.avgRetrievalThroughputBps * (metric.totalRetrievals || 0);
          retrievalThroughputCount += metric.totalRetrievals || 0;
        }

        // Track last retrieval date
        if (metric.totalRetrievals > 0) {
          if (!lastRetrievalAt || metric.dailyBucket > lastRetrievalAt) {
            lastRetrievalAt = metric.dailyBucket;
          }
        }

        if (metric.serviceType === ServiceType.IPFS_PIN) {
          totalIpfsRetrievals += metric.totalRetrievals;
          successfulIpfsRetrievals += metric.successfulRetrievals;
          failedIpfsRetrievals += metric.failedRetrievals;

          if (metric.avgRetrievalLatencyMs) {
            retrievalIpfsLatencySum += metric.avgRetrievalLatencyMs * (metric.totalRetrievals || 0);
            retrievalIpfsLatencyCount += metric.totalRetrievals || 0;
          }

          if (metric.avgRetrievalTtfbMs) {
            retrievalIpfsTtfbSum += metric.avgRetrievalTtfbMs * (metric.totalRetrievals || 0);
            retrievalIpfsTtfbCount += metric.totalRetrievals || 0;
          }

          if (metric.avgRetrievalThroughputBps) {
            retrievalIpfsThroughputSum += metric.avgRetrievalThroughputBps * (metric.totalRetrievals || 0);
            retrievalIpfsThroughputCount += metric.totalRetrievals || 0;
          }
        }
      }
    }

    // Calculate averages and rates
    const dealSuccessRate = totalDeals > 0 ? (successfulDeals / totalDeals) * 100 : 0;
    const retrievalSuccessRate = totalRetrievals > 0 ? (successfulRetrievals / totalRetrievals) * 100 : 0;
    const ipniSuccessRate = totalIpniDeals > 0 ? (ipniIndexedDeals / totalIpniDeals) * 100 : 0;
    const ipfsRetrievalSuccessRate =
      totalIpfsRetrievals > 0 ? (successfulIpfsRetrievals / totalIpfsRetrievals) * 100 : 0;

    const avgDealLatencyMs = dealLatencyCount > 0 ? Math.round(dealLatencySum / dealLatencyCount) : 0;
    const avgIngestLatencyMs = ingestLatencyCount > 0 ? Math.round(ingestLatencySum / ingestLatencyCount) : 0;
    const avgChainLatencyMs = chainLatencyCount > 0 ? Math.round(chainLatencySum / chainLatencyCount) : 0;
    const avgIpniTimeToIndexMs = timeToIndexCount > 0 ? Math.round(timeToIndexSum / timeToIndexCount) : 0;
    const avgIpniTimeToAdvertiseMs =
      timeToAdvertiseCount > 0 ? Math.round(timeToAdvertiseSum / timeToAdvertiseCount) : 0;
    const avgIpniTimeToRetrieveMs = timeToRetrieveCount > 0 ? Math.round(timeToRetrieveSum / timeToRetrieveCount) : 0;
    const avgRetrievalLatencyMs =
      retrievalLatencyCount > 0 ? Math.round(retrievalLatencySum / retrievalLatencyCount) : 0;
    const avgRetrievalTtfbMs = retrievalTtfbCount > 0 ? Math.round(retrievalTtfbSum / retrievalTtfbCount) : 0;
    const avgIpfsRetrievalLatencyMs =
      retrievalIpfsLatencyCount > 0 ? Math.round(retrievalIpfsLatencySum / retrievalIpfsLatencyCount) : 0;
    const avgIpfsRetrievalTtfbMs =
      retrievalIpfsTtfbCount > 0 ? Math.round(retrievalIpfsTtfbSum / retrievalIpfsTtfbCount) : 0;

    const avgIngestThroughputBps =
      ingestThroughputCount > 0 ? Math.round(ingestThroughputSum / ingestThroughputCount) : 0;
    const avgRetrievalThroughputBps =
      retrievalThroughputCount > 0 ? Math.round(retrievalThroughputSum / retrievalThroughputCount) : 0;
    const avgIpfsRetrievalThroughputBps =
      retrievalIpfsThroughputCount > 0 ? Math.round(retrievalIpfsThroughputSum / retrievalIpfsThroughputCount) : 0;

    // Calculate health score (same formula as materialized views)
    const healthScore =
      totalDeals > 0 || totalRetrievals > 0 ? Math.round(dealSuccessRate * 0.6 + retrievalSuccessRate * 0.4) : 0;

    // Calculate average deal size
    const avgDealSize = successfulDeals > 0 ? Math.round(Number(totalDataStoredBytes) / successfulDeals) : null;

    return {
      spAddress: metrics[0].spAddress,
      totalDeals,
      successfulDeals,
      failedDeals,
      dealSuccessRate: Math.round(dealSuccessRate * 10) / 10,
      avgIngestLatencyMs,
      avgChainLatencyMs,
      avgDealLatencyMs,
      avgIngestThroughputBps,
      totalDataStoredBytes: totalDataStoredBytes.toString(),
      totalRetrievals,
      successfulRetrievals,
      failedRetrievals,
      retrievalSuccessRate: Math.round(retrievalSuccessRate * 10) / 10,
      avgRetrievalLatencyMs,
      avgRetrievalTtfbMs,
      avgRetrievalThroughputBps,
      totalDataRetrievedBytes: totalDataRetrievedBytes.toString(),
      totalIpfsRetrievals,
      successfulIpfsRetrievals,
      failedIpfsRetrievals,
      ipfsRetrievalSuccessRate: Math.round(ipfsRetrievalSuccessRate * 10) / 10,
      avgIpfsRetrievalLatencyMs,
      avgIpfsRetrievalTtfbMs,
      avgIpfsRetrievalThroughputBps,
      totalIpniDeals,
      ipniIndexedDeals,
      ipniAdvertisedDeals,
      ipniRetrievedDeals,
      ipniFailedDeals,
      ipniSuccessRate: Math.round(ipniSuccessRate * 10) / 10,
      avgIpniTimeToIndexMs,
      avgIpniTimeToAdvertiseMs,
      avgIpniTimeToRetrieveMs,
      healthScore,
      avgDealSize: avgDealSize ?? undefined,
      lastDealAt: lastDealAt || new Date(0),
      lastRetrievalAt: lastRetrievalAt || new Date(0),
      refreshedAt: new Date(),
    };
  }

  /**
   * Get empty window response when no activity found
   * @private
   */
  private getEmptyWindowResponse(
    provider: StorageProvider,
    startDate: Date,
    endDate: Date,
    preset: string | null,
  ): ProviderWindowPerformanceDto {
    const days = Math.round(((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) * 10) / 10;

    return {
      provider,
      window: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days,
        preset,
      },
      metrics: {
        spAddress: provider.address,
        totalDeals: 0,
        successfulDeals: 0,
        failedDeals: 0,
        dealSuccessRate: 0,
        avgIngestLatencyMs: 0,
        avgChainLatencyMs: 0,
        avgDealLatencyMs: 0,
        avgIngestThroughputBps: 0,
        totalDataStoredBytes: "0",
        totalRetrievals: 0,
        successfulRetrievals: 0,
        failedRetrievals: 0,
        retrievalSuccessRate: 0,
        avgRetrievalLatencyMs: 0,
        avgRetrievalTtfbMs: 0,
        avgRetrievalThroughputBps: 0,
        totalDataRetrievedBytes: "0",
        totalIpniDeals: 0,
        ipniIndexedDeals: 0,
        ipniAdvertisedDeals: 0,
        ipniRetrievedDeals: 0,
        ipniFailedDeals: 0,
        ipniSuccessRate: 0,
        avgIpniTimeToIndexMs: 0,
        avgIpniTimeToAdvertiseMs: 0,
        avgIpniTimeToRetrieveMs: 0,
        totalIpfsRetrievals: 0,
        successfulIpfsRetrievals: 0,
        failedIpfsRetrievals: 0,
        ipfsRetrievalSuccessRate: 0,
        avgIpfsRetrievalLatencyMs: 0,
        avgIpfsRetrievalTtfbMs: 0,
        avgIpfsRetrievalThroughputBps: 0,
        healthScore: 0,
        avgDealSize: undefined,
        lastDealAt: new Date(0),
        lastRetrievalAt: new Date(0),
        refreshedAt: new Date(),
      },
    };
  }

  /**
   * Map entity to ProviderPerformanceDto
   */
  mapEntityToPerformanceDto(entity: SpPerformanceAllTime | SpPerformanceLastWeek): ProviderPerformanceDto {
    return {
      spAddress: entity.spAddress,
      totalDeals: entity.totalDeals,
      successfulDeals: entity.successfulDeals,
      failedDeals: entity.failedDeals,
      dealSuccessRate: entity.dealSuccessRate,
      avgIngestLatencyMs: entity.avgIngestLatencyMs,
      avgChainLatencyMs: entity.avgChainLatencyMs,
      avgDealLatencyMs: entity.avgDealLatencyMs,
      avgIngestThroughputBps: entity.avgIngestThroughputBps,
      totalDataStoredBytes: entity.totalDataStoredBytes,
      totalRetrievals: entity.totalRetrievals,
      successfulRetrievals: entity.successfulRetrievals,
      failedRetrievals: entity.failedRetrievals,
      retrievalSuccessRate: entity.retrievalSuccessRate,
      avgRetrievalLatencyMs: entity.avgRetrievalLatencyMs,
      avgRetrievalTtfbMs: entity.avgRetrievalTtfbMs,
      avgRetrievalThroughputBps: entity.avgThroughputBps,
      totalDataRetrievedBytes: entity.totalDataRetrievedBytes,
      totalIpniDeals: entity.totalIpniDeals,
      ipniIndexedDeals: entity.ipniIndexedDeals,
      ipniAdvertisedDeals: entity.ipniAdvertisedDeals,
      ipniRetrievedDeals: entity.ipniRetrievedDeals,
      ipniFailedDeals: entity.ipniFailedDeals,
      ipniSuccessRate: entity.ipniSuccessRate,
      avgIpniTimeToIndexMs: entity.avgIpniTimeToIndexMs,
      avgIpniTimeToAdvertiseMs: entity.avgIpniTimeToAdvertiseMs,
      avgIpniTimeToRetrieveMs: entity.avgIpniTimeToRetrieveMs,
      totalIpfsRetrievals: entity.totalIpfsRetrievals,
      successfulIpfsRetrievals: entity.successfulIpfsRetrievals,
      failedIpfsRetrievals: entity.failedIpfsRetrievals,
      ipfsRetrievalSuccessRate: entity.ipfsRetrievalSuccessRate,
      avgIpfsRetrievalLatencyMs: entity.avgIpfsRetrievalLatencyMs,
      avgIpfsRetrievalTtfbMs: entity.avgIpfsRetrievalTtfbMs,
      avgIpfsRetrievalThroughputBps: entity.avgIpfsRetrievalThroughputBps,
      healthScore: entity.getHealthScore?.() || 0,
      avgDealSize: entity.getAvgDealSize?.() ?? undefined,
      lastDealAt: entity.lastDealAt,
      lastRetrievalAt: entity.lastRetrievalAt,
      refreshedAt: entity.refreshedAt,
    };
  }
}
