import { Hex } from "../../common/types";
import { DataSourceType } from "../enums/deal-status.enum";

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
  bytesRetrieved?: number;
  startTime: Date;
  endTime: Date;
  throughput?: number;
  error?: string;
  responseCode?: number;
}

export interface CreateDealInput {
  dataSource: DataSourceType;
  enableCDN: boolean;
  storageProviderAddress: Hex;
  minFileSize: number;
  maxFileSize: number;
}
