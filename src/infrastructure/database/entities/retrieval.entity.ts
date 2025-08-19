import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { RetrievalStatus } from "../../../domain/enums/deal-status.enum";

@Entity("retrievals")
@Index(["cid"])
@Index(["storageProvider", "status"])
export class RetrievalEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ nullable: true })
  cid!: string;

  @Column()
  storageProvider!: string;

  @Column({ type: "boolean" })
  withCDN!: boolean;

  @Column({
    type: "enum",
    enum: RetrievalStatus,
    default: RetrievalStatus.PENDING,
  })
  status!: RetrievalStatus;

  // Performance metrics
  @Column({ type: "timestamp" })
  startTime!: Date;

  @Column({ type: "timestamp", nullable: true })
  endTime!: Date;

  @Column({ nullable: true, type: "int" })
  latency!: number;

  @Column({ nullable: true, type: "float" })
  throughput!: number;

  @Column({ nullable: true, type: "bigint" })
  bytesRetrieved!: number;

  // Request details
  @Column({ nullable: true })
  responseCode!: number;

  @Column({ nullable: true, type: "text" })
  errorMessage!: string;

  @Column({ default: 0 })
  retryCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
