import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type JobType =
  | "deal"
  | "retrieval"
  | "metrics"
  | "metrics_cleanup"
  | "providers_refresh"
  | "data_retention_poll";

@Entity("job_schedule_state")
@Index("job_schedule_state_job_type_sp_unique", ["jobType", "spAddress"], { unique: true })
@Index("idx_job_schedule_state_next_run", ["nextRunAt"])
export class JobScheduleState {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "job_type" })
  jobType!: JobType;

  @Column({ name: "sp_address", default: "" })
  spAddress!: string;

  @Column({ name: "interval_seconds" })
  intervalSeconds!: number;

  @Column({ name: "next_run_at", type: "timestamptz" })
  nextRunAt!: Date;

  @Column({ name: "last_run_at", type: "timestamptz", nullable: true })
  lastRunAt?: Date | null;

  @Column({ default: false })
  paused!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
