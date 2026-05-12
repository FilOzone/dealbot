import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { SUPPORTED_NETWORKS } from "../../common/constants.js";
import type { Network } from "../../common/types.js";

// `job_type` is stored as TEXT in Postgres, so legacy rows may still contain
// values that are no longer scheduled for new work. Keep them in the entity
// type until a DB cleanup/migration removes or rewrites existing rows.
export type JobType =
  | "deal"
  | "retrieval"
  | "data_set_creation"
  | "metrics" // legacy: no longer scheduled; see RemoveMetricsJobScheduleRows migration. TODO(#457): remove.
  | "metrics_cleanup" // legacy: no longer scheduled; see RemoveMetricsJobScheduleRows migration. TODO(#457): remove.
  | "providers_refresh"
  | "data_retention_poll"
  | "piece_cleanup";

@Entity("job_schedule_state")
@Index("job_schedule_state_job_type_sp_network_unique", ["jobType", "spAddress", "network"], { unique: true })
@Index("idx_job_schedule_state_next_run", ["nextRunAt"])
export class JobScheduleState {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "job_type", type: "text" })
  jobType!: JobType;

  @Column({ name: "sp_address", type: "text", default: "" })
  spAddress!: string;

  @Column({
    name: "network",
    type: "enum",
    enum: [...SUPPORTED_NETWORKS],
    enumName: "network_enum",
  })
  network!: Network;

  @Column({ name: "interval_seconds" })
  intervalSeconds!: number;

  @Column({ name: "next_run_at", type: "timestamptz" })
  nextRunAt!: Date;

  @Column({ name: "last_run_at", type: "timestamptz", nullable: true })
  lastRunAt: Date | null;

  @Column({ default: false })
  paused!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
