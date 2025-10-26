import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { RetrievalStatus, ServiceType } from "./types.js";
import type { Deal } from "./deal.entity.js";

@Entity("retrievals")
export class Retrieval {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "deal_id", type: "uuid" })
  dealId!: string;

  @Column({ name: "service_type", type: "enum", enum: ServiceType, default: ServiceType.DIRECT_SP })
  serviceType!: ServiceType;

  @Column({ name: "retrieval_endpoint" })
  retrievalEndpoint!: string;

  @Column({
    type: "enum",
    enum: RetrievalStatus,
    default: RetrievalStatus.PENDING,
  })
  status!: RetrievalStatus;

  @Column({ name: "started_at", type: "timestamptz" })
  startedAt!: Date;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt!: Date;

  @Column({ name: "latency_ms", nullable: true })
  latencyMs!: number;

  @Column({ name: "throughput_bps", nullable: true })
  throughputBps!: number;

  @Column({ name: "bytes_retrieved", nullable: true })
  bytesRetrieved!: number;

  @Column({ name: "ttfb_ms", nullable: true })
  ttfbMs!: number;

  @Column({ name: "response_code", nullable: true })
  responseCode!: number;

  @Column({ name: "error_message", nullable: true })
  errorMessage!: string;

  @Column({ name: "retry_count", default: 0 })
  retryCount!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  // Relations
  @ManyToOne("Deal", "retrievals", { onDelete: "CASCADE" })
  @JoinColumn({ name: "deal_id" })
  deal: Deal;
}
