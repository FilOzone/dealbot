import { Deal } from "../entities/deal.entity.js";
import { Retrieval } from "../entities/retrieval.entity.js";

export interface IMetricsService {
  recordDealMetrics(deal: Deal): Promise<void>;
  recordRetrievalMetrics(retrieval: Retrieval): Promise<void>;
  aggregateDailyMetrics(date: Date): Promise<void>;
}

export interface IMetricsRepository {
  findDailyMetrics(date: Date, provider?: string): Promise<DailyMetricsData[]>;
  upsertDailyMetrics(metrics: DailyMetricsData): Promise<void>;
}

export interface DailyMetricsData {
  date: Date;
  storageProvider: string;
  withCDN: boolean;
  operationType: "DEAL" | "RETRIEVAL";
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgIngestLatency?: number;
  avgChainLatency?: number;
  avgDealLatency?: number;
  avgRetrievalLatency?: number;
  avgThroughput?: number;
  minThroughput?: number;
  maxThroughput?: number;
  responseCodeCounts?: Record<string, number>;
}
