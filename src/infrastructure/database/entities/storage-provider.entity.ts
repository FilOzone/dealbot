import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

@Entity("storage_providers")
@Index(["address"], { unique: true })
export class StorageProviderEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true })
  address!: string;

  @Column()
  serviceUrl!: string;

  @Column()
  peerId!: string;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: "timestamp", nullable: true })
  lastDealTime!: Date;

  // Metrics columns
  @Column({ default: 0 })
  totalDeals!: number;

  @Column({ default: 0 })
  successfulDeals!: number;

  @Column({ default: 0 })
  failedDeals!: number;

  @Column({ nullable: true, type: "float" })
  averageIngestLatency!: number;

  @Column({ nullable: true, type: "float" })
  averageRetrievalLatency!: number;

  @Column({ default: 0, type: "float" })
  successRate!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
