import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { SUPPORTED_NETWORKS } from "../../common/constants.js";
import type { Network } from "../../common/types.js";

@Entity("data_retention_baselines")
export class DataRetentionBaseline {
  @PrimaryColumn({ name: "provider_address", type: "text" })
  providerAddress!: string;

  @PrimaryColumn({
    name: "network",
    type: "enum",
    enum: [...SUPPORTED_NETWORKS],
    enumName: "network_enum",
  })
  network!: Network;

  @Column({ name: "faulted_periods", type: "bigint" })
  faultedPeriods!: string; // bigint stored as string

  @Column({ name: "success_periods", type: "bigint" })
  successPeriods!: string; // bigint stored as string

  @Column({ name: "last_block_number", type: "bigint" })
  lastBlockNumber!: string; // bigint stored as string

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
