import { getConstructionPlans } from "pg-boss";
import type { MigrationInterface, QueryRunner } from "typeorm";

export class EnsurePgBossSchema1760550000000 implements MigrationInterface {
  name = "EnsurePgBossSchema1760550000000";
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    try {
      const schema = "pgboss";
      const legacySchema = "pgboss_v6";
      const newSchema = "pgboss_new";

      const schemaExists = await this.schemaExists(queryRunner, schema);
      if (!schemaExists) {
        await this.installSchema(queryRunner, schema);
      }

      const queueExists = await this.relationExists(queryRunner, `${schema}.queue`);
      if (queueExists) {
        // Already on v12+ schema; skip swap logic.
        await this.ensureCompatColumns(queryRunner, schema);
        await this.ensureQueues(queryRunner, schema);
        return;
      }
      const legacyExists = await this.schemaExists(queryRunner, legacySchema);
      if (legacyExists) {
        throw new Error(
          `Legacy schema ${legacySchema} already exists. Rename or drop it before upgrading pg-boss schema.`,
        );
      }

      const newSchemaExists = await this.schemaExists(queryRunner, newSchema);
      if (newSchemaExists) {
        throw new Error(
          `Target schema ${newSchema} already exists. Rename or drop it before upgrading pg-boss schema.`,
        );
      }

      await this.installSchema(queryRunner, newSchema);
      await this.copyQueues(queryRunner, schema, newSchema);
      await this.copySchedules(queryRunner, schema, newSchema);
      await this.copyJobs(queryRunner, schema, newSchema);
      await this.ensureCompatColumns(queryRunner, newSchema);

      await queryRunner.query(`ALTER SCHEMA ${schema} RENAME TO ${legacySchema}`);
      await queryRunner.query(`ALTER SCHEMA ${newSchema} RENAME TO ${schema}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`pg-boss migration failed: ${message}. See docs/runbooks/jobs.md for manual migration steps.`);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {}

  private async schemaExists(queryRunner: QueryRunner, name: string): Promise<boolean> {
    const rows = await queryRunner.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [name]);
    return rows.length > 0;
  }

  private async relationExists(queryRunner: QueryRunner, qualifiedName: string): Promise<boolean> {
    const rows = await queryRunner.query("SELECT to_regclass($1) AS reg", [qualifiedName]);
    return Boolean(rows?.[0]?.reg);
  }

  private async installSchema(queryRunner: QueryRunner, name: string): Promise<void> {
    const sql = getConstructionPlans(name);
    await queryRunner.query(sql);
  }

  private async ensureCompatColumns(queryRunner: QueryRunner, name: string): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ${name}.job ADD COLUMN IF NOT EXISTS createdon timestamptz GENERATED ALWAYS AS (created_on) STORED`,
    );
    await queryRunner.query(
      `ALTER TABLE ${name}.job ADD COLUMN IF NOT EXISTS startedon timestamptz GENERATED ALWAYS AS (started_on) STORED`,
    );
  }

  private async ensureQueues(queryRunner: QueryRunner, name: string): Promise<void> {
    const queues = ["deal.run", "retrieval.run", "metrics.run", "metrics.cleanup"];
    for (const queueName of queues) {
      await queryRunner.query(`SELECT ${name}.create_queue($1, '{"policy":"standard"}'::jsonb)`, [queueName]);
    }
  }

  private async copyQueues(queryRunner: QueryRunner, source: string, target: string): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO ${target}.queue (
        name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max,
        expire_seconds, retention_seconds, deletion_seconds, dead_letter, partition, table_name,
        deferred_count, queued_count, warning_queued, active_count, total_count,
        singletons_active, monitor_on, maintain_on, created_on, updated_on
      )
      SELECT
        q.name,
        'standard', 2, 0, false, NULL,
        900, 1209600, 604800, NULL, false, 'job_common',
        0, 0, 0, 0, 0,
        NULL, NULL, NULL, now(), now()
      FROM (
        SELECT DISTINCT name FROM ${source}.job
        UNION
        SELECT DISTINCT name FROM ${source}.schedule
      ) q
      LEFT JOIN ${target}.queue existing ON existing.name = q.name
      WHERE existing.name IS NULL
      `,
    );
  }

  private async copySchedules(queryRunner: QueryRunner, source: string, target: string): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO ${target}.schedule (
        name, key, cron, timezone, data, options, created_on, updated_on
      )
      SELECT
        name, '' AS key, cron, timezone, data, options, created_on, updated_on
      FROM ${source}.schedule
      ON CONFLICT (name, key) DO NOTHING
      `,
    );
  }

  private async copyJobs(queryRunner: QueryRunner, source: string, target: string): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO ${target}.job (
        id, name, priority, data, state,
        retry_limit, retry_count, retry_delay, retry_backoff, retry_delay_max,
        expire_seconds, deletion_seconds,
        singleton_key, singleton_on, group_id, group_tier,
        start_after, created_on, started_on, completed_on, keep_until,
        output, dead_letter, policy
      )
      SELECT
        id,
        name,
        priority,
        data,
        (CASE WHEN state::text = 'expired' THEN 'cancelled' ELSE state::text END)::${target}.job_state,
        retrylimit,
        retrycount,
        retrydelay,
        retrybackoff,
        NULL::int,
        COALESCE(EXTRACT(EPOCH FROM expirein)::int, 900),
        604800,
        singletonkey,
        singletonon,
        NULL::text,
        NULL::text,
        startafter,
        createdon,
        startedon,
        completedon,
        keepuntil,
        output,
        NULL::text,
        'standard'
      FROM ${source}.job
      `,
    );
  }
}
