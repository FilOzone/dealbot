import { ProviderInfo } from "@filoz/synapse-sdk";

export interface UploadResult {
  commP: any;
  size: number;
  rootId?: number;
}

export interface PieceAddedResult {
  transactionHash: string;
}

export interface DataFile {
  name: string;
  data: Buffer;
  size: number;
}

export interface RetrievalResult {
  success: boolean;
  data?: Buffer;
  latency: number;
  ttfb?: number;
  bytesRetrieved?: number;
  startTime: Date;
  endTime: Date;
  throughput?: number;
  error?: string;
  responseCode?: number;
}

export interface CreateDealInput {
  enableCDN: boolean;
  provider: ProviderInfo;
  dataFile: DataFile;
}
