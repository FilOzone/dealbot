import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DailyMetricsEntity, OperationType } from "../entities/daily-metrics.entity";
import { IMetricsRepository, DailyMetricsData } from "../../../domain/interfaces/metrics.interface";

@Injectable()
export class MetricsRepository implements IMetricsRepository {
  constructor(
    @InjectRepository(DailyMetricsEntity)
    private readonly dailyMetricsRepository: Repository<DailyMetricsEntity>,
  ) {}

  async findDailyMetrics(date: Date, provider?: string): Promise<DailyMetricsData[]> {
    const query = this.dailyMetricsRepository
      .createQueryBuilder("dm")
      .where("dm.date = :date", { date: this.formatDate(date) });

    if (provider) {
      query.andWhere("dm.storageProvider = :provider", { provider });
    }

    const entities = await query.getMany();
    return entities.map((entity) => this.toDailyMetricsData(entity));
  }

  async upsertDailyMetrics(metrics: DailyMetricsData): Promise<void> {
    await this.dailyMetricsRepository.upsert(
      {
        date: this.formatDate(metrics.date),
        storageProvider: metrics.storageProvider,
        withCDN: metrics.withCDN,
        operationType: metrics.operationType as OperationType,
        totalCalls: metrics.totalCalls,
        successfulCalls: metrics.successfulCalls,
        failedCalls: metrics.failedCalls,
        avgIngestLatency: metrics.avgIngestLatency,
        avgChainLatency: metrics.avgChainLatency,
        avgDealLatency: metrics.avgDealLatency,
        avgRetrievalLatency: metrics.avgRetrievalLatency,
        avgThroughput: metrics.avgThroughput,
        minThroughput: metrics.minThroughput,
        maxThroughput: metrics.maxThroughput,
        responseCodeCounts: metrics.responseCodeCounts,
      },
      ["date", "storageProvider", "withCDN", "operationType"],
    );
  }

  /**
   * Get aggregated deal metrics for a specific date range
   */
  async getDealMetricsForDateRange(startDate: Date, endDate: Date, provider?: string): Promise<DailyMetricsEntity[]> {
    const query = this.dailyMetricsRepository
      .createQueryBuilder("dm")
      .where("dm.date BETWEEN :startDate AND :endDate", {
        startDate: this.formatDate(startDate),
        endDate: this.formatDate(endDate),
      })
      .andWhere("dm.operationType = :operationType", { operationType: OperationType.DEAL });

    if (provider) {
      query.andWhere("dm.storageProvider = :provider", { provider });
    }

    return query.getMany();
  }

  /**
   * Get aggregated retrieval metrics for a specific date range
   */
  async getRetrievalMetricsForDateRange(
    startDate: Date,
    endDate: Date,
    provider?: string,
  ): Promise<DailyMetricsEntity[]> {
    const query = this.dailyMetricsRepository
      .createQueryBuilder("dm")
      .where("dm.date BETWEEN :startDate AND :endDate", {
        startDate: this.formatDate(startDate),
        endDate: this.formatDate(endDate),
      })
      .andWhere("dm.operationType = :operationType", { operationType: OperationType.RETRIEVAL });

    if (provider) {
      query.andWhere("dm.storageProvider = :provider", { provider });
    }

    return query.getMany();
  }

  private formatDate(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  private toDailyMetricsData(entity: DailyMetricsEntity): DailyMetricsData {
    return {
      date: entity.date,
      storageProvider: entity.storageProvider,
      withCDN: entity.withCDN,
      operationType: entity.operationType,
      totalCalls: entity.totalCalls,
      successfulCalls: entity.successfulCalls,
      failedCalls: entity.failedCalls,
      avgIngestLatency: entity.avgIngestLatency || undefined,
      avgChainLatency: entity.avgChainLatency || undefined,
      avgDealLatency: entity.avgDealLatency || undefined,
      avgRetrievalLatency: entity.avgRetrievalLatency || undefined,
      avgThroughput: entity.avgThroughput || undefined,
      minThroughput: entity.minThroughput || undefined,
      maxThroughput: entity.maxThroughput || undefined,
      responseCodeCounts: entity.responseCodeCounts || undefined,
    };
  }
}
