import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between } from "typeorm";
import { Deal } from "../domain/entities/deal.entity.js";
import { Retrieval } from "../domain/entities/retrieval.entity.js";
import { DealEntity } from "../infrastructure/database/entities/deal.entity.js";
import { RetrievalEntity } from "../infrastructure/database/entities/retrieval.entity.js";
import { MetricsRepository } from "../infrastructure/database/repositories/metrics.repository.js";
import { IMetricsService, DailyMetricsData } from "../domain/interfaces/metrics.interface.js";
import { DealStatus } from "../domain/enums/deal-status.enum.js";
import { RetrievalStatus } from "../domain/enums/deal-status.enum.js";

@Injectable()
export class MetricsService implements IMetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private readonly metricsRepository: MetricsRepository,
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    @InjectRepository(RetrievalEntity)
    private readonly retrievalRepository: Repository<RetrievalEntity>,
  ) {}

  /**
   * Record metrics for a completed deal
   */
  async recordDealMetrics(deal: Deal): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const isSuccessful = deal.status === DealStatus.DEAL_CREATED;

      // Get existing metrics or create new
      const existingMetrics = await this.metricsRepository.findDailyMetrics(today, deal.storageProvider);

      const existing = existingMetrics.find((m) => m.withCDN === deal.withCDN && m.operationType === "DEAL");

      const metricsData: DailyMetricsData = {
        date: today,
        storageProvider: deal.storageProvider,
        withCDN: deal.withCDN,
        operationType: "DEAL",
        totalCalls: (existing?.totalCalls || 0) + 1,
        successfulCalls: (existing?.successfulCalls || 0) + (isSuccessful ? 1 : 0),
        failedCalls: (existing?.failedCalls || 0) + (isSuccessful ? 0 : 1),
        ...this.calculateDealLatencyMetrics(deal, existing),
      };

      await this.metricsRepository.upsertDailyMetrics(metricsData);

      this.logger.debug(`Deal metrics recorded for provider ${deal.storageProvider}`);
    } catch (error) {
      this.logger.error(`Failed to record deal metrics: ${error.message}`, error);
    }
  }

  /**
   * Record metrics for a completed retrieval
   */
  async recordRetrievalMetrics(retrieval: Retrieval): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const isSuccessful = retrieval.status === RetrievalStatus.SUCCESS;

      // Get existing metrics or create new
      const existingMetrics = await this.metricsRepository.findDailyMetrics(today, retrieval.storageProvider);

      const existing = existingMetrics.find((m) => m.withCDN === retrieval.withCDN && m.operationType === "RETRIEVAL");

      const metricsData: DailyMetricsData = {
        date: today,
        storageProvider: retrieval.storageProvider,
        withCDN: retrieval.withCDN,
        operationType: "RETRIEVAL",
        totalCalls: (existing?.totalCalls || 0) + 1,
        successfulCalls: (existing?.successfulCalls || 0) + (isSuccessful ? 1 : 0),
        failedCalls: (existing?.failedCalls || 0) + (isSuccessful ? 0 : 1),
        ...this.calculateRetrievalMetrics(retrieval, existing),
      };

      await this.metricsRepository.upsertDailyMetrics(metricsData);

      this.logger.debug(`Retrieval metrics recorded for provider ${retrieval.storageProvider}`);
    } catch (error) {
      this.logger.error(`Failed to record retrieval metrics: ${error.message}`, error);
    }
  }

  /**
   * Aggregate daily metrics from raw deal and retrieval data
   */
  async aggregateDailyMetrics(date: Date): Promise<void> {
    const startTime = Date.now();
    let totalRecordsProcessed = 0;
    let successfulAggregations = 0;
    let failedAggregations = 0;

    try {
      this.logger.log(`Starting daily metrics aggregation for ${date.toISOString().split("T")[0]}`);

      // Set date boundaries
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Aggregate deal metrics
      const dealAggregation = await this.aggregateDealsForDate(startOfDay, endOfDay);
      totalRecordsProcessed += dealAggregation.recordsProcessed;
      successfulAggregations += dealAggregation.successful;
      failedAggregations += dealAggregation.failed;

      // Aggregate retrieval metrics
      const retrievalAggregation = await this.aggregateRetrievalsForDate(startOfDay, endOfDay);
      totalRecordsProcessed += retrievalAggregation.recordsProcessed;
      successfulAggregations += retrievalAggregation.successful;
      failedAggregations += retrievalAggregation.failed;

      const processingTimeMs = Date.now() - startTime;

      this.logger.log(
        `Daily metrics aggregation completed: ${successfulAggregations} successful, ` +
          `${failedAggregations} failed in ${processingTimeMs}ms`,
      );
    } catch (error) {
      this.logger.error(`Failed to aggregate daily metrics: ${error.message}`, error);
      throw error;
    }
  }

  private calculateDealLatencyMetrics(deal: Deal, existing?: DailyMetricsData) {
    return {
      avgIngestLatency: this.calculateRunningAverage(
        existing?.avgIngestLatency,
        deal.ingestLatency ? [deal.ingestLatency] : [],
        existing?.totalCalls || 0,
      ),
      avgIngestThroughput: this.calculateRunningAverage(
        existing?.avgIngestThroughput,
        deal.ingestThroughput ? [deal.ingestThroughput] : [],
        existing?.totalCalls || 0,
      ),
      avgChainLatency: this.calculateRunningAverage(
        existing?.avgChainLatency,
        deal.chainLatency ? [deal.chainLatency] : [],
        existing?.totalCalls || 0,
      ),
      avgDealLatency: this.calculateRunningAverage(
        existing?.avgDealLatency,
        deal.dealLatency ? [deal.dealLatency] : [],
        existing?.totalCalls || 0,
      ),
    };
  }

  private calculateRetrievalMetrics(retrieval: Retrieval, existing?: DailyMetricsData) {
    const latencies: number[] = [];
    const throughputs: number[] = [];

    if (retrieval.latency) {
      latencies.push(retrieval.latency);
    }
    if (retrieval.throughput) {
      throughputs.push(retrieval.throughput);
    }

    // Update response code counts
    const responseCodeCounts = { ...(existing?.responseCodeCounts || {}) };
    if (retrieval.responseCode) {
      const code = retrieval.responseCode.toString();
      responseCodeCounts[code] = (responseCodeCounts[code] || 0) + 1;
    }

    return {
      avgRetrievalLatency: this.calculateRunningAverage(
        existing?.avgRetrievalLatency,
        latencies,
        existing?.totalCalls || 0,
      ),
      avgRetrievalThroughput: this.calculateRunningAverage(
        existing?.avgRetrievalThroughput,
        throughputs,
        existing?.totalCalls || 0,
      ),
      responseCodeCounts,
    };
  }

  private async aggregateDealsForDate(startOfDay: Date, endOfDay: Date) {
    const deals = await this.dealRepository.find({
      where: {
        uploadStartTime: Between(startOfDay, endOfDay),
      },
    });

    let recordsProcessed = 0;
    let successful = 0;
    let failed = 0;

    for (const dealEntity of deals) {
      try {
        recordsProcessed++;
        const deal = this.toDealDomain(dealEntity);
        await this.recordDealMetrics(deal);
        successful++;
      } catch (error) {
        failed++;
        this.logger.warn(`Failed to aggregate deal ${dealEntity.id}: ${error.message}`);
      }
    }

    return { recordsProcessed, successful, failed };
  }

  private async aggregateRetrievalsForDate(startOfDay: Date, endOfDay: Date) {
    const retrievals = await this.retrievalRepository.find({
      where: {
        startTime: Between(startOfDay, endOfDay),
      },
    });

    let recordsProcessed = 0;
    let successful = 0;
    let failed = 0;

    for (const retrievalEntity of retrievals) {
      try {
        recordsProcessed++;
        const retrieval = this.toRetrievalDomain(retrievalEntity);
        await this.recordRetrievalMetrics(retrieval);
        successful++;
      } catch (error) {
        failed++;
        this.logger.warn(`Failed to aggregate retrieval ${retrievalEntity.id}: ${error.message}`);
      }
    }

    return { recordsProcessed, successful, failed };
  }

  private calculateRunningAverage(
    existingAvg: number | undefined,
    newValues: number[],
    existingCount: number,
  ): number | undefined {
    if (newValues.length === 0) return existingAvg;

    const newSum = newValues.reduce((sum, val) => sum + val, 0);
    const existingSum = (existingAvg || 0) * existingCount;
    const totalSum = existingSum + newSum;
    const totalCount = existingCount + newValues.length;

    return totalCount > 0 ? totalSum / totalCount : undefined;
  }

  private calculateMin(existingMin: number | undefined, newValues: number[]): number | undefined {
    if (newValues.length === 0) return existingMin;
    const newMin = Math.min(...newValues);
    return existingMin !== undefined ? Math.min(existingMin, newMin) : newMin;
  }

  private calculateMax(existingMax: number | undefined, newValues: number[]): number | undefined {
    if (newValues.length === 0) return existingMax;
    const newMax = Math.max(...newValues);
    return existingMax !== undefined ? Math.max(existingMax, newMax) : newMax;
  }

  private toDealDomain(entity: DealEntity): Deal {
    // Convert entity to domain object - simplified for metrics purposes
    return new Deal({
      id: entity.id,
      cid: entity.cid,
      storageProvider: entity.storageProvider as `0x${string}`,
      withCDN: entity.withCDN,
      status: entity.status,
      walletAddress: entity.walletAddress as `0x${string}`,
      uploadStartTime: entity.uploadStartTime,
      uploadEndTime: entity.uploadEndTime,
      dealConfirmedTime: entity.dealConfirmedTime,
      ingestLatency: entity.ingestLatency,
      chainLatency: entity.chainLatency,
    });
  }

  private toRetrievalDomain(entity: RetrievalEntity): Retrieval {
    // Convert entity to domain object - simplified for metrics purposes
    return new Retrieval({
      id: entity.id,
      cid: entity.cid,
      storageProvider: entity.storageProvider as `0x${string}`,
      withCDN: entity.withCDN,
      status: entity.status,
      startTime: entity.startTime,
      endTime: entity.endTime,
      latency: entity.latency,
      throughput: entity.throughput,
      bytesRetrieved: entity.bytesRetrieved,
      responseCode: entity.responseCode,
    });
  }
}
