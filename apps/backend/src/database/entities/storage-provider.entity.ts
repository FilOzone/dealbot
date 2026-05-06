import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { SUPPORTED_NETWORKS } from "../../common/constants.js";
import type { Network } from "../../common/types.js";
import { BigIntColumn } from "../helpers/bigint-column.js";
import { Deal } from "./deal.entity.js";

@Entity("storage_providers")
@Index(["location", "isActive"])
@Index(["network", "isActive"])
export class StorageProvider {
  @PrimaryColumn()
  address!: string;

  @PrimaryColumn({
    name: "network",
    type: "enum",
    enum: [...SUPPORTED_NETWORKS],
    enumName: "network_enum",
  })
  network!: Network;

  @BigIntColumn({ nullable: true })
  providerId: bigint | null;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column()
  payee!: string;

  @Column({ name: "service_url", type: "varchar", nullable: true })
  serviceUrl: string | null;

  @Column({ name: "is_active", default: true })
  isActive!: boolean;

  @Column({ name: "is_approved", default: false })
  isApproved!: boolean;

  @Column()
  location!: string;

  @Column({ type: "jsonb" })
  @Index("idx_sp_metadata", { synchronize: false })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  // Relations
  @OneToMany(
    () => Deal,
    (deal) => deal.storageProvider,
  )
  deals: Deal[] | null;
}
