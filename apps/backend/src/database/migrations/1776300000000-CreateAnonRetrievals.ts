import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAnonRetrievals1776300000000 implements MigrationInterface {
  name = "CreateAnonRetrievals1776300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE anon_retrievals_piece_fetch_status_enum AS ENUM ('success', 'failed')
    `);
    await queryRunner.query(`
      CREATE TYPE anon_retrievals_ipni_status_enum AS ENUM ('valid', 'invalid', 'skipped', 'error')
    `);
    await queryRunner.query(`
      CREATE TYPE anon_retrievals_service_type_enum AS ENUM ('direct_sp', 'ipfs_pin')
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS anon_retrievals (
        id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
        started_at TIMESTAMPTZ NOT NULL,
        probe_location VARCHAR NOT NULL,
        sp_address VARCHAR NOT NULL,
        sp_id BIGINT,
        sp_name VARCHAR,
        piece_cid VARCHAR NOT NULL,
        data_set_id BIGINT NOT NULL,
        piece_id BIGINT NOT NULL,
        raw_size BIGINT NOT NULL,
        with_ipfs_indexing BOOLEAN NOT NULL,
        ipfs_root_cid VARCHAR,
        service_type anon_retrievals_service_type_enum NOT NULL DEFAULT 'direct_sp',
        retrieval_endpoint VARCHAR NOT NULL,
        piece_fetch_status anon_retrievals_piece_fetch_status_enum NOT NULL,
        http_response_code INTEGER,
        first_byte_ms DOUBLE PRECISION,
        last_byte_ms DOUBLE PRECISION,
        bytes_retrieved BIGINT,
        throughput_bps BIGINT,
        commp_valid BOOLEAN,
        car_parseable BOOLEAN,
        car_block_count INTEGER,
        block_fetch_endpoint VARCHAR,
        block_fetch_valid BOOLEAN,
        block_fetch_sampled_count INTEGER,
        block_fetch_failed_count INTEGER,
        ipni_status anon_retrievals_ipni_status_enum NOT NULL,
        ipni_verify_ms DOUBLE PRECISION,
        ipni_verified_cids_count INTEGER,
        ipni_unverified_cids_count INTEGER,
        error_message VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_anon_retrievals_sp_address_started_at"
      ON anon_retrievals (sp_address, started_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_anon_retrievals_started_at"
      ON anon_retrievals (started_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS anon_retrievals CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS anon_retrievals_service_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS anon_retrievals_ipni_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS anon_retrievals_piece_fetch_status_enum`);
  }
}
