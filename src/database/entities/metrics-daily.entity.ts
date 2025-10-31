import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { ServiceType } from "../types.js";
import { StorageProvider } from "./storage-provider.entity.js";

@Entity("metrics_daily")
@Index(["dailyBucket"])
@Index(["spAddress", "dailyBucket"])
@Index(["serviceType", "dailyBucket"])
@Unique(["dailyBucket", "spAddress", "serviceType"])
export class MetricsDaily {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ name: "daily_bucket", type: "timestamptz" })
  dailyBucket: Date;

  @Column({ name: "sp_address", nullable: true })
  spAddress: string;

  @Column({ name: "service_type", type: "enum", enum: ServiceType, nullable: true })
  serviceType: ServiceType;

  // Deal metrics
  @Column({ name: "total_deals", type: "integer", default: 0 })
  totalDeals: number;

  @Column({ name: "successful_deals", type: "integer", default: 0 })
  successfulDeals: number;

  @Column({ name: "failed_deals", type: "integer", default: 0 })
  failedDeals: number;

  @Column({ name: "deal_success_rate", type: "float", nullable: true })
  dealSuccessRate: number;

  @Column({ name: "avg_ingest_latency_ms", type: "float", nullable: true })
  avgIngestLatencyMs!: number;

  @Column({ name: "avg_ingest_throughput_bps", type: "float", nullable: true })
  avgIngestThroughputBps!: number;

  @Column({ name: "avg_chain_latency_ms", type: "float", nullable: true })
  avgChainLatencyMs!: number;

  @Column({ name: "avg_deal_latency_ms", type: "integer", nullable: true })
  avgDealLatencyMs: number;

  @Column({ name: "total_data_stored_bytes", type: "bigint", default: 0 })
  totalDataStoredBytes: number;

  // Retrieval metrics
  @Column({ name: "total_retrievals", type: "integer", default: 0 })
  totalRetrievals: number;

  @Column({ name: "successful_retrievals", type: "integer", default: 0 })
  successfulRetrievals: number;

  @Column({ name: "failed_retrievals", type: "integer", default: 0 })
  failedRetrievals: number;

  @Column({ name: "retrieval_success_rate", type: "float", nullable: true })
  retrievalSuccessRate: number;

  @Column({ name: "avg_retrieval_latency_ms", type: "integer", nullable: true })
  avgRetrievalLatencyMs: number;

  @Column({ name: "avg_retrieval_ttfb_ms", type: "integer", nullable: true })
  avgRetrievalTtfbMs: number;

  @Column({
    name: "avg_retrieval_throughput_bps",
    type: "int",
    nullable: true,
  })
  avgRetrievalThroughputBps: number;

  @Column({ name: "total_data_retrieved_bytes", type: "bigint", default: 0 })
  totalDataRetrievedBytes: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => StorageProvider, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sp_address" })
  storageProvider: StorageProvider;
}
