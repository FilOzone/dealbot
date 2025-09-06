import { Hex } from "../../common/types.js";

export class StorageProvider {
  address!: Hex;
  name!: string;
  description!: string;
  payee!: string;
  serviceUrl!: string;

  lastDealTime?: Date;

  // Metrics
  totalDeals!: number;
  totalDealsWithCDN!: number;
  totalDealsWithoutCDN!: number;
  successfulDeals!: number;
  successfulDealsWithCDN!: number;
  successfulDealsWithoutCDN!: number;
  failedDeals!: number;
  failedDealsWithCDN!: number;
  failedDealsWithoutCDN!: number;
  totalRetrievals!: number;
  successfulRetrievals!: number;
  failedRetrievals!: number;
  averageIngestLatency!: number;
  averageIngestThroughput!: number;
  averageChainLatency!: number;
  averageDealLatency!: number;
  averageRetrievalLatency!: number;
  averageRetrievalThroughput!: number;
  dealSuccessRate!: number;
  retrievalSuccessRate!: number;

  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<StorageProvider>) {
    Object.assign(this, partial);
    this.totalDeals = partial.totalDeals || 0;
    this.totalDealsWithCDN = partial.totalDealsWithCDN || 0;
    this.totalDealsWithoutCDN = partial.totalDealsWithoutCDN || 0;
    this.successfulDeals = partial.successfulDeals || 0;
    this.successfulDealsWithCDN = partial.successfulDealsWithCDN || 0;
    this.successfulDealsWithoutCDN = partial.successfulDealsWithoutCDN || 0;
    this.failedDeals = partial.failedDeals || 0;
    this.failedDealsWithCDN = partial.failedDealsWithCDN || 0;
    this.failedDealsWithoutCDN = partial.failedDealsWithoutCDN || 0;
    this.totalRetrievals = partial.totalRetrievals || 0;
    this.successfulRetrievals = partial.successfulRetrievals || 0;
    this.failedRetrievals = partial.failedRetrievals || 0;
    this.averageIngestLatency = partial.averageIngestLatency || 0;
    this.averageIngestThroughput = partial.averageIngestThroughput || 0;
    this.averageChainLatency = partial.averageChainLatency || 0;
    this.averageDealLatency = partial.averageDealLatency || 0;
    this.averageRetrievalLatency = partial.averageRetrievalLatency || 0;
    this.averageRetrievalThroughput = partial.averageRetrievalThroughput || 0;
    this.dealSuccessRate = partial.dealSuccessRate || 0;
    this.retrievalSuccessRate = partial.retrievalSuccessRate || 0;
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
  }

  calculateDealSuccessRate(): void {
    if (this.totalDeals > 0) {
      this.dealSuccessRate = (this.successfulDeals / this.totalDeals) * 100;
    }
  }

  calculateRetrievalSuccessRate(): void {
    if (this.totalRetrievals > 0) {
      this.retrievalSuccessRate = (this.successfulRetrievals / this.totalRetrievals) * 100;
    }
  }
}
