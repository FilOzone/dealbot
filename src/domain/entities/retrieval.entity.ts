import { Hex } from "../../common/types.js";
import { RetrievalStatus } from "../enums/deal-status.enum.js";

export class Retrieval {
  id!: string;
  cid!: string;
  storageProvider!: Hex;
  withCDN!: boolean;
  status!: RetrievalStatus;

  // Performance metrics
  startTime!: Date;
  endTime?: Date;
  latency?: number; // milliseconds
  throughput?: number; // bytes/second
  bytesRetrieved?: number;

  // Request details
  responseCode?: number;
  errorMessage?: string;
  retryCount!: number;

  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<Retrieval>) {
    Object.assign(this, partial);
    this.retryCount = partial.retryCount || 0;
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
    this.startTime = partial.startTime || new Date();
  }

  calculateLatency(): void {
    if (this.startTime && this.endTime) {
      this.latency = this.endTime.getTime() - this.startTime.getTime();
    }
  }

  calculateThroughput(): void {
    if (this.bytesRetrieved && this.latency && this.latency > 0) {
      this.throughput = (this.bytesRetrieved / this.latency) * 1000; // bytes per second
    }
  }
}
