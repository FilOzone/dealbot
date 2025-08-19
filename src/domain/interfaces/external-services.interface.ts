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
  contentType: string;
  source: string;
}

export interface RetrievalResult {
  success: boolean;
  data?: Buffer;
  latency: number;
  throughput?: number;
  error?: string;
  responseCode?: number;
}

export interface CreateDealInput {
  dataSource: DataSourceType;
  enableCDN: boolean;
  storageProviderAddress: Hex;
  maxFileSize: number;
}
