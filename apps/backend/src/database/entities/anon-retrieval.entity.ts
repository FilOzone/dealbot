import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { BigIntColumn } from "../helpers/bigint-column.js";
import { RetrievalStatus, ServiceType } from "../types.js";

/**
 * Anonymous retrieval check records — pieces the dealbot did NOT upload,
 * sampled from the subgraph and probed against an SP.
 *
 * Kept as a separate table from `retrievals` because the two checks have
 * different input domains: basic retrievals reference a dealbot-owned deal,
 * anonymous retrievals carry their own piece identity inline.
 */
@Entity("anon_retrievals")
export class AnonRetrieval {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Lowercased SP address. Indexed for per-SP dashboards and dedup. */
  @Index("IDX_anon_retrievals_sp_address")
  @Column({ name: "sp_address", type: "varchar" })
  spAddress!: string;

  /** Piece CID (v2/CommP). Indexed for the recent-dedup selector query. */
  @Index("IDX_anon_retrievals_piece_cid")
  @Column({ name: "piece_cid", type: "varchar" })
  pieceCid!: string;

  @BigIntColumn({ name: "data_set_id" })
  dataSetId!: bigint;

  @BigIntColumn({ name: "piece_id" })
  pieceId!: bigint;

  /** Raw (unpadded) piece size in bytes, as reported by the subgraph at selection time. */
  @BigIntColumn({ name: "raw_size" })
  rawSize!: bigint;

  @Column({ name: "with_ipfs_indexing", type: "boolean" })
  withIpfsIndexing!: boolean;

  /** Root CID of the contained DAG; null when the piece isn't IPFS-indexed. */
  @Column({ name: "ipfs_root_cid", type: "varchar", nullable: true })
  ipfsRootCid: string | null;

  @Column({
    name: "service_type",
    type: "enum",
    enum: ServiceType,
    default: ServiceType.DIRECT_SP,
  })
  serviceType!: ServiceType;

  @Column({ name: "retrieval_endpoint", type: "varchar" })
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

  @Column({ name: "ttfb_ms", type: "int", nullable: true })
  ttfbMs: number | null;

  @Column({ name: "throughput_bps", type: "int", nullable: true })
  throughputBps: number | null;

  @Column({ name: "bytes_retrieved", type: "bigint", nullable: true })
  bytesRetrieved: number | null;

  @Column({ name: "response_code", type: "int", nullable: true })
  responseCode: number | null;

  @Column({ name: "error_message", type: "varchar", nullable: true })
  errorMessage: string | null;

  /** NULL when the retrieval failed before the CommP hash was computed. */
  @Column({ name: "commp_valid", type: "boolean", nullable: true })
  commpValid: boolean | null;

  /** NULL when the CAR validation step was skipped (no IPFS indexing, or piece fetch failed). */
  @Column({ name: "car_valid", type: "boolean", nullable: true })
  carValid: boolean | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
