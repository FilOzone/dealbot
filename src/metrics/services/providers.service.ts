import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { MetricsDaily } from "../../database/entities/metrics-daily.entity.js";
import { SpPerformanceAllTime } from "../../database/entities/sp-performance-all-time.entity.js";
import { SpPerformanceLastWeek } from "../../database/entities/sp-performance-last-week.entity.js";
import { StorageProvider } from "../../database/entities/storage-provider.entity.js";

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
  constructor(
    @InjectRepository(SpPerformanceLastWeek)
    private readonly lastWeekPerformanceRepo: Repository<SpPerformanceLastWeek>,
    @InjectRepository(SpPerformanceAllTime)
    private readonly allTimePerformanceRepo: Repository<SpPerformanceAllTime>,
    @InjectRepository(MetricsDaily)
    private readonly dailyMetricsRepo: Repository<MetricsDaily>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
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
}
