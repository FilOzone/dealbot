import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * Persisted registration of a temporary pull piece served at
 * `/api/piece/:pieceCid` during an in-flight pull check.
 *
 * Backing this with Postgres (instead of in-memory) allows the API pod(s) to
 * resolve registrations created by a separate worker pod.
 */
@Entity("pull_pieces")
export class PullPiece {
  @PrimaryColumn({ name: "piece_cid", type: "text" })
  pieceCid!: string;

  @Column({ name: "provider_address", type: "text" })
  providerAddress!: string;

  @Column({ name: "key", type: "text" })
  key!: string;

  @Column({ name: "size", type: "int" })
  size!: number;

  @Column({ name: "pull_submitted_at", type: "timestamptz", nullable: true })
  pullSubmittedAt: Date | null;

  @Column({ name: "first_byte_at", type: "timestamptz", nullable: true })
  firstByteAt: Date | null;

  @Index()
  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
