import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { PullCheckStatus, PullVerificationStatus } from "../types.js";

@Entity("pull_checks")
@Index("idx_pull_checks_sp_address", ["spAddress"])
@Index("idx_pull_checks_status", ["status"])
@Index("idx_pull_checks_created_at", ["createdAt"])
export class PullCheck {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "sp_address", type: "varchar" })
  spAddress: string;

  @Column({ name: "piece_cid", type: "varchar" })
  pieceCid: string;

  @Column({ name: "source_url", type: "text" })
  sourceUrl: string;

  @Column({ name: "request_id", type: "varchar", nullable: true })
  requestId: string | null;

  @Column({
    name: "status",
    type: "enum",
    enum: PullCheckStatus,
    default: PullCheckStatus.PENDING,
  })
  status: PullCheckStatus;

  @Column({ name: "provider_status", type: "varchar", nullable: true })
  providerStatus: string | null;

  @Column({ name: "failure_reason", type: "text", nullable: true })
  failureReason: string | null;

  @Column({ name: "request_started_at", type: "timestamptz", nullable: true })
  requestStartedAt: Date | null;

  @Column({ name: "request_completed_at", type: "timestamptz", nullable: true })
  requestCompletedAt: Date | null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null;

  @Column({
    name: "verification_status",
    type: "enum",
    enum: PullVerificationStatus,
    nullable: true,
  })
  verificationStatus: PullVerificationStatus | null;

  @Column({ name: "verification_completed_at", type: "timestamptz", nullable: true })
  verificationCompletedAt: Date | null;

  @Column({ name: "verification_message", type: "text", nullable: true })
  verificationMessage: string | null;

  @Column({ name: "hosted_piece_expires_at", type: "timestamptz" })
  hostedPieceExpiresAt: Date;

  @Column({ name: "hosted_piece_cleaned_up_at", type: "timestamptz", nullable: true })
  hostedPieceCleanedUpAt: Date | null;

  @Column({ name: "error_code", type: "varchar", nullable: true })
  errorCode: string | null;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string | null;

  @Column({ name: "retry_count", type: "int", default: 0 })
  retryCount: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
