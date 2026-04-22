import type { MigrationInterface, QueryRunner } from "typeorm";
import { SUPPORTED_NETWORKS } from "../../common/constants.js";
import { Network } from "../../common/types.js";

/**
 * Add a `network` column to runtime tables so records from mainnet and calibration
 * are isolated correctly when a single dealbot instance operates on both networks.
 *
 * Backfill strategy: existing rows are assigned 'calibration' because all
 * currently running dealbot deployments target calibration. Operators switching a
 * previously single-network deployment to mainnet must ensure their NETWORKS env
 * var reflects the correct value and re-run a providers_refresh to populate the
 * correct network-scoped rows.
 */
export class AddNetworkColumn1776790420000 implements MigrationInterface {
  name = "AddNetworkColumn1776790420000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const backfillNetwork = (process.env.DEALBOT_LEGACY_NETWORK_BACKFILL ?? process.env.NETWORK ?? "").trim();
    if (!SUPPORTED_NETWORKS.includes(backfillNetwork as Network)) {
      throw new Error(
        `AddNetworkColumn migration requires DEALBOT_LEGACY_NETWORK_BACKFILL (or legacy NETWORK) ` +
          `to be set to one of: ${SUPPORTED_NETWORKS.join(", ")}. Got: "${backfillNetwork}"`,
      );
    }

    // -------------------------------------------------------------------------
    // Add `network` columns first so composite PK/FK can reference them.
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE storage_providers
        ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT '${backfillNetwork}'
    `);

    await queryRunner.query(`
      ALTER TABLE deals
        ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT '${backfillNetwork}'
    `);

    // -------------------------------------------------------------------------
    // Indexes on storage_providers
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_storage_providers_region_is_active"
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_storage_providers_location_is_active"
      ON storage_providers (location, is_active)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_storage_providers_network_is_active"
      ON storage_providers (network, is_active)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_deals_network_sp_address"
      ON deals (network, sp_address)
    `);

    // -------------------------------------------------------------------------
    // Drop FK before dropping the PK it depends on.
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE deals DROP CONSTRAINT IF EXISTS "FK_deals_storage_providers"
    `);

    // -------------------------------------------------------------------------
    // storage_providers: change single-column PK to composite (address, network)
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE storage_providers DROP CONSTRAINT IF EXISTS "PK_4edd0e54ccdb29b54a3ef1e2547"
    `);
    await queryRunner.query(`
      ALTER TABLE storage_providers DROP CONSTRAINT IF EXISTS storage_providers_pkey
    `);

    await queryRunner.query(`
      ALTER TABLE storage_providers ADD PRIMARY KEY (address, network)
    `);

    // -------------------------------------------------------------------------
    // Recreate deals FK against the new composite PK.
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE deals
        ADD CONSTRAINT "FK_deals_storage_providers"
        FOREIGN KEY (sp_address, network)
        REFERENCES storage_providers(address, network)
        ON DELETE CASCADE
    `);

    // -------------------------------------------------------------------------
    // job_schedule_state: replace unique constraint to include network
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE job_schedule_state
        ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT '${backfillNetwork}'
    `);

    await queryRunner.query(`
      ALTER TABLE job_schedule_state
        DROP CONSTRAINT IF EXISTS job_schedule_state_job_type_sp_unique
    `);

    await queryRunner.query(`
      ALTER TABLE job_schedule_state
        ADD CONSTRAINT job_schedule_state_job_type_sp_network_unique
        UNIQUE (job_type, sp_address, network)
    `);

    // -------------------------------------------------------------------------
    // data_retention_baselines: change single-column PK to composite (provider_address, network)
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE data_retention_baselines
        ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT '${backfillNetwork}'
    `);

    await queryRunner.query(`
      ALTER TABLE data_retention_baselines
        DROP CONSTRAINT IF EXISTS data_retention_baselines_pkey
    `);

    await queryRunner.query(`
      ALTER TABLE data_retention_baselines
        ADD PRIMARY KEY (provider_address, network)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // data_retention_baselines
    await queryRunner.query(`
      ALTER TABLE data_retention_baselines DROP CONSTRAINT IF EXISTS data_retention_baselines_pkey
    `);
    await queryRunner.query(`
      ALTER TABLE data_retention_baselines ADD PRIMARY KEY (provider_address)
    `);
    await queryRunner.query(`
      ALTER TABLE data_retention_baselines DROP COLUMN IF EXISTS network
    `);

    // job_schedule_state
    await queryRunner.query(`
      ALTER TABLE job_schedule_state
        DROP CONSTRAINT IF EXISTS job_schedule_state_job_type_sp_network_unique
    `);
    await queryRunner.query(`
      ALTER TABLE job_schedule_state
        ADD CONSTRAINT job_schedule_state_job_type_sp_unique
        UNIQUE (job_type, sp_address)
    `);
    await queryRunner.query(`
      ALTER TABLE job_schedule_state DROP COLUMN IF EXISTS network
    `);

    // deals
    await queryRunner.query(`
      ALTER TABLE deals DROP CONSTRAINT IF EXISTS "FK_deals_storage_providers"
    `);
    await queryRunner.query(`
      ALTER TABLE deals
        ADD CONSTRAINT "FK_deals_storage_providers"
        FOREIGN KEY (sp_address)
        REFERENCES storage_providers(address)
        ON DELETE CASCADE
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_deals_network_sp_address"`);
    await queryRunner.query(`ALTER TABLE deals DROP COLUMN IF EXISTS network`);

    // storage_providers
    await queryRunner.query(`
      ALTER TABLE storage_providers DROP CONSTRAINT IF EXISTS storage_providers_pkey
    `);
    await queryRunner.query(`
      ALTER TABLE storage_providers ADD PRIMARY KEY (address)
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_storage_providers_network_is_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_storage_providers_location_is_active"`);
    await queryRunner.query(`ALTER TABLE storage_providers DROP COLUMN IF EXISTS network`);
  }
}
