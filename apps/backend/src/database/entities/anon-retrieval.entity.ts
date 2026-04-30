import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { BigIntColumn } from "../helpers/bigint-column.js";
import { IpniCheckStatus, PieceFetchStatus, ServiceType } from "../types.js";

@Entity("anon_retrievals")
@Index(["spAddress", "startedAt"])
@Index(["startedAt"])
export class AnonRetrieval {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "started_at", type: "timestamptz" })
  startedAt!: Date;

  @Column({ name: "probe_location" })
  probeLocation!: string;

  @Column({ name: "sp_address" })
  spAddress!: string;

  @BigIntColumn({ name: "sp_id", nullable: true })
  spId: bigint | null;

  @Column({ name: "sp_name", type: "varchar", nullable: true })
  spName: string | null;

  @Column({ name: "piece_cid" })
  pieceCid!: string;

  @BigIntColumn({ name: "data_set_id" })
  dataSetId!: bigint;

  @BigIntColumn({ name: "piece_id" })
  pieceId!: bigint;

  @BigIntColumn({ name: "raw_size" })
  rawSize!: bigint;

  @Column({ name: "with_ipfs_indexing", type: "boolean" })
  withIpfsIndexing!: boolean;

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
    name: "piece_fetch_status",
    type: "enum",
    enum: PieceFetchStatus,
  })
  pieceFetchStatus!: PieceFetchStatus;

  @Column({ name: "http_response_code", type: "int", nullable: true })
  httpResponseCode: number | null;

  @Column({ name: "first_byte_ms", type: "double precision", nullable: true })
  firstByteMs: number | null;

  @Column({ name: "last_byte_ms", type: "double precision", nullable: true })
  lastByteMs: number | null;

  @BigIntColumn({ name: "bytes_retrieved", nullable: true })
  bytesRetrieved: bigint | null;

  @BigIntColumn({ name: "throughput_bps", nullable: true })
  throughputBps: bigint | null;

  @Column({ name: "commp_valid", type: "boolean", nullable: true })
  commpValid: boolean | null;

  @Column({ name: "car_parseable", type: "boolean", nullable: true })
  carParseable: boolean | null;

  @Column({ name: "car_block_count", type: "int", nullable: true })
  carBlockCount: number | null;

  @Column({ name: "block_fetch_endpoint", type: "varchar", nullable: true })
  blockFetchEndpoint: string | null;

  @Column({ name: "block_fetch_valid", type: "boolean", nullable: true })
  blockFetchValid: boolean | null;

  @Column({ name: "block_fetch_sampled_count", type: "int", nullable: true })
  blockFetchSampledCount: number | null;

  @Column({ name: "block_fetch_failed_count", type: "int", nullable: true })
  blockFetchFailedCount: number | null;

  @Column({
    name: "ipni_status",
    type: "enum",
    enum: IpniCheckStatus,
  })
  ipniStatus!: IpniCheckStatus;

  @Column({ name: "ipni_verify_ms", type: "double precision", nullable: true })
  ipniVerifyMs: number | null;

  @Column({ name: "ipni_verified_cids_count", type: "int", nullable: true })
  ipniVerifiedCidsCount: number | null;

  @Column({ name: "ipni_unverified_cids_count", type: "int", nullable: true })
  ipniUnverifiedCidsCount: number | null;

  @Column({ name: "error_message", type: "varchar", nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
