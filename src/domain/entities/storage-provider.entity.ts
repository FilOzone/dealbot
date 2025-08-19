import { Hex } from "../../common/types";

export class StorageProvider {
  id!: string;
  address!: Hex;
  serviceUrl!: string;
  peerId!: string;

  lastDealTime?: Date;

  // Metrics
  totalDeals!: number;
  successfulDeals!: number;
  failedDeals!: number;
  averageIngestLatency?: number;
  averageRetrievalLatency?: number;
  successRate!: number;

  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<StorageProvider>) {
    Object.assign(this, partial);
    this.totalDeals = partial.totalDeals || 0;
    this.successfulDeals = partial.successfulDeals || 0;
    this.failedDeals = partial.failedDeals || 0;
    this.successRate = partial.successRate || 0;
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
  }

  calculateSuccessRate(): void {
    if (this.totalDeals > 0) {
      this.successRate = (this.successfulDeals / this.totalDeals) * 100;
    }
  }

  shouldReceiveDeal(currentTime: Date, intervalMinutes: number = 30): boolean {
    if (!this.lastDealTime) return true;

    const timeDiff = currentTime.getTime() - this.lastDealTime.getTime();
    const minutesDiff = timeDiff / (1000 * 60);

    return minutesDiff >= intervalMinutes;
  }
}
