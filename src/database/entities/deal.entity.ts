import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { type DealMetadata, DealStatus } from "../types.js";
import type { Retrieval } from "./retrieval.entity.js";
import { StorageProvider } from "./storage-provider.entity.js";

@Entity("deals")
export class Deal {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "sp_address" })
  spAddress: string;

  @Column({ name: "wallet_address" })
  walletAddress: string;

  @Column({ name: "file_name" })
  fileName: string;

  @Column({ name: "file_size", type: "bigint" })
  fileSize: number;

  @Column({ name: "piece_cid", nullable: true })
  pieceCid: string;

  @Column({ name: "data_set_id", nullable: true })
  dataSetId: number;

  @Column({ name: "piece_id", nullable: true })
  pieceId?: number;

  @Column({ name: "piece_size", nullable: true, type: "bigint" })
  pieceSize: number;

  @Column({
    type: "enum",
    enum: DealStatus,
    default: DealStatus.PENDING,
  })
  status: DealStatus;

  @Column({ name: "transaction_hash", nullable: true })
  transactionHash: string;

  @Column({ type: "jsonb", default: {} })
  metadata: DealMetadata;

  // Metrics
  @Column({ name: "upload_start_time", type: "timestamp", nullable: true })
  uploadStartTime: Date;

  @Column({ name: "upload_end_time", type: "timestamp", nullable: true })
  uploadEndTime: Date;

  @Column({ name: "piece_added_time", type: "timestamp", nullable: true })
  pieceAddedTime: Date;

  @Column({ name: "deal_confirmed_time", type: "timestamp", nullable: true })
  dealConfirmedTime: Date;

  @Column({ name: "ingest_latency_ms", nullable: true, type: "int" })
  ingestLatencyMs: number;

  @Column({ name: "chain_latency_ms", nullable: true, type: "int" })
  chainLatencyMs: number;

  @Column({ name: "deal_latency_ms", nullable: true, type: "int" })
  dealLatencyMs: number;

  @Column({ name: "ingest_throughput_bps", nullable: true, type: "int" })
  ingestThroughputBps: number;

  // Error tracking
  @Column({ name: "error_message", nullable: true, type: "text" })
  errorMessage: string;

  @Column({ name: "error_code", nullable: true })
  errorCode: string;

  @Column({ name: "retry_count", default: 0 })
  retryCount: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  // Relations
  @ManyToOne(
    () => StorageProvider,
    (sp) => sp.deals,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "sp_address" })
  storageProvider: StorageProvider;

  @OneToMany("Retrieval", "deal")
  retrievals: Retrieval[];
}
