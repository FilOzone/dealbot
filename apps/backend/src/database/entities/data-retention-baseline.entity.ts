import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("data_retention_baselines")
export class DataRetentionBaseline {
  @PrimaryColumn({ name: "provider_address", type: "text" })
  providerAddress!: string;

  @Column({ name: "faulted_periods", type: "bigint" })
  faultedPeriods!: string; // bigint stored as string

  @Column({ name: "success_periods", type: "bigint" })
  successPeriods!: string; // bigint stored as string

  @Column({ name: "last_block_number", type: "bigint" })
  lastBlockNumber!: string; // bigint stored as string

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
