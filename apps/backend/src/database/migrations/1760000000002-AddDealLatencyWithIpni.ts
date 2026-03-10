import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDealLatencyWithIpni1760000000002 implements MigrationInterface {
  name = "AddDealLatencyWithIpni1760000000002";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deals
      ADD COLUMN deal_latency_with_ipni_ms INTEGER
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deals
      DROP COLUMN deal_latency_with_ipni_ms
    `);
  }
}
