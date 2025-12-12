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
import { MetricType, ServiceType } from "../types.js";
import { StorageProvider } from "./storage-provider.entity.js";

@Entity("metrics_daily")
@Index(["dailyBucket"])
@Index(["spAddress", "dailyBucket"])
@Index(["metricType", "dailyBucket"])
@Index(["serviceType", "dailyBucket"])
@Unique(["dailyBucket", "spAddress", "metricType", "serviceType"])
export class MetricsDaily {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ name: "daily_bucket", type: "timestamptz" })
  dailyBucket: Date;

  @Column({ name: "sp_address", nullable: true })
  spAddress: string;

  @Column({ name: "metric_type", type: "enum", enum: MetricType })
  metricType: MetricType;

  @Column({
    name: "service_type",
    type: "enum",
    enum: ServiceType,
    nullable: true,
  })
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

  // IPNI tracking metrics
  @Column({ name: "total_ipni_deals", type: "integer", default: 0 })
  totalIpniDeals: number;

  @Column({ name: "ipni_indexed_deals", type: "integer", default: 0 })
  ipniIndexedDeals: number;

  @Column({ name: "ipni_advertised_deals", type: "integer", default: 0 })
  ipniAdvertisedDeals: number;

  @Column({ name: "ipni_retrieved_deals", type: "integer", default: 0 })
  ipniRetrievedDeals: number;

  @Column({ name: "ipni_verified_deals", type: "integer", default: 0 })
  ipniVerifiedDeals: number;

  @Column({ name: "ipni_failed_deals", type: "integer", default: 0 })
  ipniFailedDeals: number;

  @Column({ name: "ipni_success_rate", type: "float", nullable: true })
  ipniSuccessRate: number;

  @Column({
    name: "avg_ipni_time_to_index_ms",
    type: "integer",
    nullable: true,
  })
  avgIpniTimeToIndexMs: number;

  @Column({
    name: "avg_ipni_time_to_advertise_ms",
    type: "integer",
    nullable: true,
  })
  avgIpniTimeToAdvertiseMs: number;

  @Column({
    name: "avg_ipni_time_to_retrieve_ms",
    type: "integer",
    nullable: true,
  })
  avgIpniTimeToRetrieveMs: number;

  @Column({
    name: "avg_ipni_time_to_verify_ms",
    type: "integer",
    nullable: true,
  })
  avgIpniTimeToVerifyMs: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => StorageProvider, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sp_address" })
  storageProvider: StorageProvider;
}
