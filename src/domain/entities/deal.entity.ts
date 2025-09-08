import { Hex } from "../../common/types.js";
import { DealStatus } from "../enums/deal-status.enum.js";

export class Deal {
  id!: string;
  fileName!: string;
  fileSize!: number;
  dataSetId!: number;
  cid!: string;
  dealId!: string;
  pieceSize?: number;
  storageProvider!: Hex;
  withCDN!: boolean;
  status!: DealStatus;
  transactionHash?: Hex;
  walletAddress!: Hex;

  // Metrics
  uploadStartTime?: Date;
  uploadEndTime?: Date;
  pieceAddedTime?: Date;
  dealConfirmedTime?: Date;
  ingestLatency?: number; // milliseconds
  chainLatency?: number; // milliseconds
  dealLatency?: number; // milliseconds
  ingestThroughput?: number; // bytes/second

  // Error tracking
  errorMessage?: string;
  errorCode?: string;
  retryCount!: number;

  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<Deal>) {
    Object.assign(this, partial);
    this.retryCount = partial.retryCount || 0;
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
  }

  calculateIngestLatency(): void {
    if (this.uploadStartTime && this.uploadEndTime) {
      this.ingestLatency = this.uploadEndTime.getTime() - this.uploadStartTime.getTime();
    }
  }

  calculateChainLatency(): void {
    if (this.uploadEndTime && this.pieceAddedTime) {
      this.chainLatency = this.pieceAddedTime.getTime() - this.uploadEndTime.getTime();
    }
  }

  calculateDealLatency(): void {
    if (this.uploadStartTime && this.dealConfirmedTime) {
      this.dealLatency = this.dealConfirmedTime.getTime() - this.uploadStartTime.getTime();
    }
  }

  calculateIngestThroughput(): void {
    if (this.uploadStartTime && this.uploadEndTime) {
      this.ingestThroughput = Math.round(
        this.fileSize / ((this.uploadEndTime.getTime() - this.uploadStartTime.getTime()) / 1000),
      );
    }
  }
}
