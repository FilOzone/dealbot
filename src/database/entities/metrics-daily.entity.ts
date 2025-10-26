import {
  Entity,
  Index,
  Unique,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { StorageProvider } from "./storage-provider.entity.js";
import { ServiceType } from "./types.js";

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
  @Column({ name: "deals_initiated", type: "integer", default: 0 })
  dealsInitiated: number;

  @Column({ name: "deals_completed", type: "integer", default: 0 })
  dealsCompleted: number;

  @Column({ type: "float", nullable: true })
  avgIngestLatencyMs!: number | null;

  @Column({ type: "float", nullable: true })
  avgIngestThroughputBps!: number | null;

  @Column({ type: "float", nullable: true })
  avgChainLatencyMs!: number | null;

  @Column({ name: "avg_deal_latency_ms", type: "integer", nullable: true })
  avgDealLatencyMs: number;

  // Retrieval metrics
  @Column({ name: "retrievals_attempted", type: "integer", default: 0 })
  retrievalsAttempted: number;

  @Column({ name: "retrievals_successful", type: "integer", default: 0 })
  retrievalsSuccessful: number;

  @Column({ name: "avg_retrieval_latency_ms", type: "integer", nullable: true })
  avgRetrievalLatencyMs: number;

  @Column({
    name: "avg_throughput_bps",
    type: "int",
    nullable: true,
  })
  avgThroughputBps: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => StorageProvider, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sp_address" })
  storageProvider: StorageProvider;
}
