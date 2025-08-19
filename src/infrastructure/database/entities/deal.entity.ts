import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { DealStatus } from "../../../domain/enums/deal-status.enum";

@Entity("deals")
@Index(["storageProvider", "status"])
@Index(["cid"])
@Index(["createdAt"])
export class DealEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  fileName!: string;

  @Column("bigint")
  fileSize!: number;

  @Column({ nullable: true })
  cid!: string;

  @Column({ nullable: true })
  dealId!: string;

  @Column({ nullable: true, type: "bigint" })
  pieceSize!: number;

  @Column()
  storageProvider!: string;

  @Column({ type: "boolean" })
  withCDN!: boolean;

  @Column({
    type: "enum",
    enum: DealStatus,
    default: DealStatus.PENDING,
  })
  status!: DealStatus;

  @Column({ nullable: true })
  transactionHash!: string;

  @Column()
  walletAddress!: string;

  // Metrics columns
  @Column({ type: "timestamp", nullable: true })
  uploadStartTime!: Date;

  @Column({ type: "timestamp", nullable: true })
  uploadEndTime!: Date;

  @Column({ type: "timestamp", nullable: true })
  pieceAddedTime!: Date;

  @Column({ type: "timestamp", nullable: true })
  dealConfirmedTime!: Date;

  @Column({ nullable: true, type: "int" })
  ingestLatency!: number;

  @Column({ nullable: true, type: "int" })
  chainLatency!: number;

  @Column({ nullable: true, type: "int" })
  dealLatency!: number;

  // Error tracking
  @Column({ nullable: true, type: "text" })
  errorMessage!: string;

  @Column({ nullable: true })
  errorCode!: string;

  @Column({ default: 0 })
  retryCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
