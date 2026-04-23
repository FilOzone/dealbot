import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create the `anon_retrievals` table that stores anonymous retrieval check
 * records. Kept separate from `retrievals` because the two checks have
 * different input domains — `retrievals` is always tied to a dealbot-owned
 * deal, while `anon_retrievals` carries its own piece identity inline.
 */
export class CreateAnonRetrievals1762000000000 implements MigrationInterface {
  name = "CreateAnonRetrievals1762000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE anon_retrievals (
        id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        sp_address           VARCHAR      NOT NULL,
        piece_cid            VARCHAR      NOT NULL,
        data_set_id          BIGINT       NOT NULL,
        piece_id             BIGINT       NOT NULL,
        raw_size             BIGINT       NOT NULL,
        with_ipfs_indexing   BOOLEAN      NOT NULL,
        ipfs_root_cid        VARCHAR      NULL,
        service_type         VARCHAR      NOT NULL DEFAULT 'direct_sp',
        retrieval_endpoint   VARCHAR      NOT NULL,
        status               VARCHAR      NOT NULL DEFAULT 'pending',
        started_at           TIMESTAMPTZ  NOT NULL,
        completed_at         TIMESTAMPTZ  NULL,
        latency_ms           INT          NULL,
        ttfb_ms              INT          NULL,
        throughput_bps       INT          NULL,
        bytes_retrieved      BIGINT       NULL,
        response_code        INT          NULL,
        error_message        VARCHAR      NULL,
        commp_valid          BOOLEAN      NULL,
        car_valid            BOOLEAN      NULL,
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);

    // Per-SP dashboards.
    await queryRunner.query(`
      CREATE INDEX "IDX_anon_retrievals_sp_address"
      ON anon_retrievals (sp_address)
    `);

    // Used by the recent-dedup query in AnonPieceSelectorService — keeps the
    // most-recently-tested CIDs out of the next selection.
    await queryRunner.query(`
      CREATE INDEX "IDX_anon_retrievals_piece_cid"
      ON anon_retrievals (piece_cid)
    `);

    // Supports "last N anonymous retrievals" ordering used by the selector.
    await queryRunner.query(`
      CREATE INDEX "IDX_anon_retrievals_created_at"
      ON anon_retrievals (created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS anon_retrievals`);
  }
}
