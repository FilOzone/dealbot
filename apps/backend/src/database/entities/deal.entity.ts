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
import { BigIntColumn } from "../helpers/bigint-column.js";
import { type DealMetadata, DealStatus, IpniStatus, type ServiceType } from "../types.js";
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

  @Column({ name: "piece_cid", type: "varchar", nullable: true })
  pieceCid: string | null;

  @BigIntColumn({ name: "data_set_id", nullable: true })
  dataSetId: bigint | null;

  @Column({ name: "piece_id", type: "int", nullable: true })
  pieceId: number | null;

  @Column({ name: "piece_size", nullable: true, type: "bigint" })
  pieceSize: number | null;

  @Column({
    type: "enum",
    enum: DealStatus,
    default: DealStatus.PENDING,
  })
  status: DealStatus;

  @Column({ name: "transaction_hash", type: "varchar", nullable: true })
  transactionHash: `0x${string}` | null;

  @Column({ type: "jsonb", default: {} })
  metadata: DealMetadata;

  @Column({ name: "service_types", type: "simple-array", nullable: true })
  serviceTypes: ServiceType[] | null;

  // Metrics
  @Column({ name: "upload_start_time", type: "timestamp", nullable: true })
  uploadStartTime: Date | null;

  @Column({ name: "upload_end_time", type: "timestamp", nullable: true })
  uploadEndTime: Date | null;

  @Column({ name: "pieces_added_time", type: "timestamp", nullable: true })
  piecesAddedTime: Date | null;
  @Column({ name: "pieces_confirmed_time", type: "timestamp", nullable: true })
  piecesConfirmedTime: Date | null;

  @Column({ name: "deal_confirmed_time", type: "timestamp", nullable: true })
  dealConfirmedTime: Date | null;

  @Column({ name: "ingest_latency_ms", nullable: true, type: "int" })
  ingestLatencyMs: number | null;

  @Column({ name: "chain_latency_ms", nullable: true, type: "int" })
  chainLatencyMs: number | null;

  @Column({ name: "deal_latency_ms", nullable: true, type: "int" })
  dealLatencyMs: number | null;

  @Column({ name: "deal_latency_with_ipni_ms", nullable: true, type: "int" })
  dealLatencyWithIpniMs: number | null;

  @Column({ name: "ingest_throughput_bps", nullable: true, type: "int" })
  ingestThroughputBps: number | null;

  // IPNI tracking metrics
  @Column({
    name: "ipni_status",
    type: "enum",
    enum: IpniStatus,
    nullable: true,
  })
  ipniStatus: IpniStatus | null;

  @Column({ name: "ipni_indexed_at", type: "timestamp", nullable: true })
  ipniIndexedAt: Date | null;

  @Column({ name: "ipni_advertised_at", type: "timestamp", nullable: true })
  ipniAdvertisedAt: Date | null;

  @Column({ name: "ipni_verified_at", type: "timestamp", nullable: true })
  ipniVerifiedAt: Date | null;

  // Time from upload complete to each IPNI stage (in milliseconds)
  @Column({ name: "ipni_time_to_index_ms", nullable: true, type: "int" })
  ipniTimeToIndexMs: number | null;

  @Column({ name: "ipni_time_to_advertise_ms", nullable: true, type: "int" })
  ipniTimeToAdvertiseMs: number | null;

  @Column({ name: "ipni_time_to_verify_ms", nullable: true, type: "int" })
  ipniTimeToVerifyMs: number | null;

  @Column({ name: "ipni_verified_cids_count", nullable: true, type: "int" })
  ipniVerifiedCidsCount: number | null;

  @Column({ name: "ipni_unverified_cids_count", nullable: true, type: "int" })
  ipniUnverifiedCidsCount: number | null;

  // Error tracking
  @Column({ name: "error_message", nullable: true, type: "text" })
  errorMessage: string | null;

  @Column({ name: "error_code", type: "varchar", nullable: true })
  errorCode: string | null;

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
  storageProvider: StorageProvider | null;

  @OneToMany("Retrieval", "deal")
  retrievals: Retrieval[];
}
