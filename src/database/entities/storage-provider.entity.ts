import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { Deal } from "./deal.entity.js";

@Entity("storage_providers")
@Index(["region", "isActive"])
export class StorageProvider {
  @PrimaryColumn()
  address!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column()
  payee!: string;

  @Column({ name: "service_url", nullable: true })
  serviceUrl!: string;

  @Column({ name: "is_active", default: true })
  isActive!: boolean;

  @Column({ name: "is_approved", default: false })
  isApproved!: boolean;

  @Column()
  region!: string;

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
  deals: Deal[];
}
