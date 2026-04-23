import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { RetrievalStatus, ServiceType } from "../types.js";
import type { Deal } from "./deal.entity.js";

@Entity("retrievals")
export class Retrieval {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "deal_id", type: "uuid" })
  dealId!: string;

  @Column({
    name: "service_type",
    type: "enum",
    enum: ServiceType,
    default: ServiceType.DIRECT_SP,
  })
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
  completedAt: Date | null;

  @Column({ name: "latency_ms", type: "int", nullable: true })
  latencyMs: number | null;

  @Column({ name: "throughput_bps", type: "int", nullable: true })
  throughputBps: number | null;

  @Column({ name: "bytes_retrieved", type: "int", nullable: true })
  bytesRetrieved: number | null;

  @Column({ name: "ttfb_ms", type: "int", nullable: true })
  ttfbMs: number | null;

  @Column({ name: "response_code", type: "int", nullable: true })
  responseCode: number | null;

  @Column({ name: "error_message", type: "varchar", nullable: true })
  errorMessage: string | null;

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
