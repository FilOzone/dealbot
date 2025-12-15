import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMetricTypeColumn1730642400000 implements MigrationInterface {
  name = "AddMetricTypeColumn1730642400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Create the metric_type enum
    await queryRunner.query(`
      CREATE TYPE metrics_daily_metric_type_enum AS ENUM ('deal', 'retrieval')
    `);

    // Step 2: Add the metric_type column (nullable initially for migration)
    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS metric_type metrics_daily_metric_type_enum
    `);

    // Step 3: Populate metric_type based on service_type
    // If service_type IS NULL, it's a deal metric
    // If service_type IS NOT NULL, it's a retrieval metric
    await queryRunner.query(`
      UPDATE metrics_daily 
      SET metric_type = CASE 
        WHEN service_type IS NULL THEN 'deal'::metrics_daily_metric_type_enum
        ELSE 'retrieval'::metrics_daily_metric_type_enum
      END
    `);

    // Step 4: Make metric_type NOT NULL now that all rows are populated
    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ALTER COLUMN metric_type SET NOT NULL
    `);

    // Step 5: Drop the old unique constraint
    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP CONSTRAINT IF EXISTS "UQ_metrics_daily_daily_bucket_sp_address_service_type"
    `);

    // Step 6: Create new unique constraint with metric_type
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_metrics_daily_daily_bucket_sp_address_metric_type_service_type'
        ) THEN
          ALTER TABLE metrics_daily 
          ADD CONSTRAINT "UQ_metrics_daily_daily_bucket_sp_address_metric_type_service_type" 
          UNIQUE (daily_bucket, sp_address, metric_type, service_type);
        END IF;
      END;
      $$;
    `);

    // Step 7: Add index on metric_type
    await queryRunner.query(`
      CREATE INDEX "IDX_metrics_daily_metric_type_daily_bucket" 
      ON metrics_daily (metric_type, daily_bucket)
    `);

    // Step 8: Clean up any remaining duplicates (from the timezone bug)
    await queryRunner.query(`
      DELETE FROM metrics_daily
      WHERE id NOT IN (
        SELECT MAX(id)
        FROM metrics_daily
        GROUP BY daily_bucket, sp_address, metric_type, service_type
      )
    `);

    // Step 9: Normalize all daily_bucket values to 00:00 UTC
    await queryRunner.query(`
      UPDATE metrics_daily
      SET daily_bucket = date_trunc('day', daily_bucket)
      WHERE daily_bucket != date_trunc('day', daily_bucket)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the new constraint
    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP CONSTRAINT IF EXISTS "UQ_metrics_daily_daily_bucket_sp_address_metric_type_service_type"
    `);

    // Restore the old constraint
    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD CONSTRAINT "UQ_metrics_daily_daily_bucket_sp_address_service_type" 
      UNIQUE (daily_bucket, sp_address, service_type)
    `);

    // Drop the index
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_metrics_daily_metric_type_daily_bucket"
    `);

    // Drop the column
    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN metric_type
    `);

    // Drop the enum type
    await queryRunner.query(`
      DROP TYPE metrics_daily_metric_type_enum
    `);
  }
}
