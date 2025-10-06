import { Deal } from "../entities/deal.entity.js";
import { StorageProvider } from "../entities/storage-provider.entity.js";
import { Retrieval } from "../entities/retrieval.entity.js";
import { DealStatus, DealType } from "../enums/deal-status.enum.js";

export interface IDealRepository {
  create(deal: Deal): Promise<Deal>;
  update(id: string, deal: Partial<Deal>): Promise<Deal>;
  findById(id: string): Promise<Deal | null>;
  findByDealId(dealId: string): Promise<Deal | null>;
  findByCid(cid: string): Promise<Deal | null>;
  findByStatus(status: DealStatus): Promise<Deal[]>;
  findByStorageProvider(providerId: string): Promise<Deal[]>;
  findPendingDeals(): Promise<Deal[]>;
  findRecentCompletedDeals(limit: number): Promise<Deal[]>;
  getMetrics(startDate: Date, endDate: Date): Promise<DealMetrics>;
}

export interface IStorageProviderRepository {
  create(provider: StorageProvider): Promise<StorageProvider>;
  update(id: string, provider: Partial<StorageProvider>): Promise<StorageProvider>;
  upsert(provider: StorageProvider): Promise<StorageProvider>;
  findByAddress(address: string): Promise<StorageProvider | null>;
  findActive(): Promise<StorageProvider[]>;
  findProvidersForDeals(intervalMinutes: number): Promise<StorageProvider[]>;
}

export interface IRetrievalRepository {
  create(retrieval: Retrieval): Promise<Retrieval>;
  update(id: string, retrieval: Partial<Retrieval>): Promise<Retrieval>;
  findById(id: string): Promise<Retrieval | null>;
  findByCid(cid: string): Promise<Retrieval[]>;
  findPendingRetrievals(): Promise<Retrieval[]>;
  getMetrics(startDate: Date, endDate: Date): Promise<RetrievalMetrics>;
}

export interface DealMetrics {
  totalDeals: number;
  successfulDeals: number;
  failedDeals: number;
  averageIngestLatency: number;
  averageChainLatency: number;
  dealsByProvider: Map<string, number>;
  dealsByType: Map<DealType, number>;
}

export interface ProviderMetrics {
  totalDeals: number;
  successfulDeals: number;
  failedDeals: number;
  averageIngestLatency: number;
  averageRetrievalLatency: number;
}

export interface RetrievalMetrics {
  totalRetrievals: number;
  successfulRetrievals: number;
  failedRetrievals: number;
  averageLatency: number;
  averageTtfb: number;
  averageThroughput: number;
  cdnVsDirectComparison: {
    cdn: { avgLatency: number; avgTtfb: number; successRate: number };
    direct: { avgLatency: number; avgTtfb: number; successRate: number };
  };
}
