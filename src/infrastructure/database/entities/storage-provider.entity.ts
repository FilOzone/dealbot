import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity("storage_providers")
export class StorageProviderEntity {
  @PrimaryColumn()
  address!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column()
  payee!: string;

  @Column()
  serviceUrl!: string;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: "timestamp", nullable: true })
  lastDealTime!: Date;

  // Metrics columns
  @Column({ default: 0 })
  totalDeals!: number;

  @Column({ default: 0 })
  totalDealsWithCDN!: number;

  @Column({ default: 0 })
  totalDealsWithoutCDN!: number;

  @Column({ default: 0 })
  successfulDeals!: number;

  @Column({ default: 0 })
  successfulDealsWithCDN!: number;

  @Column({ default: 0 })
  successfulDealsWithoutCDN!: number;

  @Column({ default: 0 })
  failedDeals!: number;

  @Column({ default: 0 })
  failedDealsWithCDN!: number;

  @Column({ default: 0 })
  failedDealsWithoutCDN!: number;

  @Column({ default: 0 })
  totalRetrievals!: number;

  @Column({ default: 0 })
  successfulRetrievals!: number;

  @Column({ default: 0 })
  failedRetrievals!: number;

  @Column({ nullable: true, type: "float" })
  averageIngestLatency!: number;

  @Column({ nullable: true, type: "float" })
  averageChainLatency!: number;

  @Column({ nullable: true, type: "float" })
  averageDealLatency!: number;

  @Column({ nullable: true, type: "float" })
  averageIngestThroughput!: number;

  @Column({ nullable: true, type: "float" })
  averageRetrievalLatency!: number;

  @Column({ nullable: true, type: "float" })
  averageRetrievalThroughput!: number;

  @Column({ default: 0, type: "float" })
  dealSuccessRate!: number;

  @Column({ default: 0, type: "float" })
  retrievalSuccessRate!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
