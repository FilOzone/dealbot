import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

export enum OperationType {
  DEAL = "DEAL",
  RETRIEVAL = "RETRIEVAL",
}

@Entity("daily_metrics")
@Index(["date", "storageProvider", "withCDN", "operationType"], { unique: true })
@Index(["date"])
@Index(["storageProvider"])
export class DailyMetricsEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "date" })
  date!: Date;

  @Column({ length: 42 })
  storageProvider!: string;

  @Column({ type: "boolean" })
  withCDN!: boolean;

  @Column({
    type: "enum",
    enum: OperationType,
  })
  operationType!: OperationType;

  // Call counts
  @Column({ type: "int", default: 0 })
  totalCalls!: number;

  @Column({ type: "int", default: 0 })
  successfulCalls!: number;

  @Column({ type: "int", default: 0 })
  failedCalls!: number;

  // Deal-specific latency metrics (milliseconds)
  @Column({ type: "float", nullable: true })
  avgIngestLatency!: number | null;

  @Column({ type: "float", nullable: true })
  avgIngestThroughput!: number | null;

  @Column({ type: "float", nullable: true })
  avgChainLatency!: number | null;

  @Column({ type: "float", nullable: true })
  avgDealLatency!: number | null;

  // Retrieval-specific metrics
  @Column({ type: "float", nullable: true })
  avgRetrievalLatency!: number | null;

  @Column({ type: "float", nullable: true })
  avgRetrievalTTFB!: number | null;

  @Column({ type: "float", nullable: true })
  avgRetrievalThroughput!: number | null;

  // Response code tracking for retrievals
  @Column({ type: "json", nullable: true })
  responseCodeCounts!: Record<string, number> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Calculate success rate as percentage
   */
  get successRate(): number {
    return this.totalCalls > 0 ? (this.successfulCalls / this.totalCalls) * 100 : 0;
  }

  /**
   * Calculate failure rate as percentage
   */
  get failureRate(): number {
    return this.totalCalls > 0 ? (this.failedCalls / this.totalCalls) * 100 : 0;
  }
}
