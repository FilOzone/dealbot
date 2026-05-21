import type { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveLegacyPgBossQueues1778889600000 implements MigrationInterface {
  name = "RemoveLegacyPgBossQueues1778889600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM pgboss.queue
      WHERE name IN ('deal.run', 'retrieval.run', 'metrics.run', 'metrics.cleanup')
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Irreversible: legacy queues are no longer used.
  }
}
