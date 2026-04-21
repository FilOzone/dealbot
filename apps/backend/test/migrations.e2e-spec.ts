import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { DataSource, type MigrationInterface } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreateInitialTables1720000000000 } from "../src/database/migrations/1720000000000-CreateInitialTables.js";
import { CreateSpPerformanceMaterializedViews1730000000000 } from "../src/database/migrations/1730000000000-CreateSpPerformanceMaterializedViews.js";
import { AddMetricTypeColumn1730642400000 } from "../src/database/migrations/1730642400000-AddMetricTypeColumn.js";
import { AddIpniTrackingFields1730820000000 } from "../src/database/migrations/1730820000000-AddIpniTrackingFields.js";
import { AddIpniMetricsToDaily1730825000000 } from "../src/database/migrations/1730825000000-AddIpniMetricsToDaily.js";
import { AddIpniMetricsToSpPerformance1730830000000 } from "../src/database/migrations/1730830000000-AddIpniMetricsToSpPerformance.js";
import { AddJobScheduleState1760000000000 } from "../src/database/migrations/1760000000000-AddJobScheduleState.js";
import { AddPieceConfirmedTime1760000000000 } from "../src/database/migrations/1760000000000-AddPieceConfirmedTime.js";
import { AddPieceConfirmedStatus1760000000001 } from "../src/database/migrations/1760000000001-AddPieceConfirmedStatus.js";
import { AddDealLatencyWithIpni1760000000002 } from "../src/database/migrations/1760000000002-AddDealLatencyWithIpni.js";
import { EnsurePgBossSchema1760550000000 } from "../src/database/migrations/1760550000000-EnsurePgBossSchema.js";
import { RemoveCdnServiceType1760600000000 } from "../src/database/migrations/1760600000000-RemoveCdnServiceType.js";
import { RemoveSpReceivedRetrieveRequest1761500000000 } from "../src/database/migrations/1761500000000-RemoveSpReceivedRetrieveRequest.js";
import { RemoveIpniRetrievedColumns1761500000001 } from "../src/database/migrations/1761500000001-RemoveIpniRetrievedColumns.js";
import { CreateDataRetentionBaselines1761500000002 } from "../src/database/migrations/1761500000002-CreateDataRetentionBaselines.js";
import { RenameEvents1761500000003 } from "../src/database/migrations/1761500000003-RenameEvents.js";
import { RenameRegionToLocation1761500000004 } from "../src/database/migrations/1761500000004-RenameRegionToLocation.js";
import { ProviderIdBigInt1761500000005 } from "../src/database/migrations/1761500000005-ProviderIdBigInt.js";
import { DataSetIdBigInt1761500000006 } from "../src/database/migrations/1761500000006-DataSetIdBigInt.js";
import { RemoveMetricsJobScheduleRows1776147113065 } from "../src/database/migrations/1776147113065-RemoveMetricsJobScheduleRows.js";
import { DropMetricsSchema1776200000000 } from "../src/database/migrations/1776200000000-DropMetricsSchema.js";

const execFileAsync = promisify(execFile);
const dockerCheck = spawnSync("docker", ["info"], { stdio: "ignore" });
if (dockerCheck.status !== 0) {
  console.warn("[migrations.e2e] Skipping migration integration tests. Docker is not available.");
}
const describeWithDocker = dockerCheck.status === 0 ? describe : describe.skip;

const ALL_MIGRATIONS: Array<new () => MigrationInterface> = [
  CreateInitialTables1720000000000,
  CreateSpPerformanceMaterializedViews1730000000000,
  AddMetricTypeColumn1730642400000,
  AddIpniTrackingFields1730820000000,
  AddIpniMetricsToDaily1730825000000,
  AddIpniMetricsToSpPerformance1730830000000,
  AddJobScheduleState1760000000000,
  AddPieceConfirmedTime1760000000000,
  AddPieceConfirmedStatus1760000000001,
  AddDealLatencyWithIpni1760000000002,
  EnsurePgBossSchema1760550000000,
  RemoveCdnServiceType1760600000000,
  RemoveSpReceivedRetrieveRequest1761500000000,
  RemoveIpniRetrievedColumns1761500000001,
  CreateDataRetentionBaselines1761500000002,
  RenameEvents1761500000003,
  RenameRegionToLocation1761500000004,
  ProviderIdBigInt1761500000005,
  DataSetIdBigInt1761500000006,
  RemoveMetricsJobScheduleRows1776147113065,
  DropMetricsSchema1776200000000,
];

type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args);
  return stdout.trim();
}

function parseMappedPort(portOutput: string): number {
  const match = portOutput.trim().match(/:(\d+)$/);
  if (!match) {
    throw new Error(`Unable to parse mapped docker port from: ${portOutput}`);
  }
  const port = Number.parseInt(match[1], 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid mapped docker port: ${match[1]}`);
  }
  return port;
}

async function waitForDatabase(config: DatabaseConfig, timeoutMs: number): Promise<DataSource> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    const dataSource = new DataSource({
      type: "postgres",
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
      database: config.database,
      migrations: ALL_MIGRATIONS,
      migrationsTransactionMode: "each",
      logging: false,
    });

    try {
      await dataSource.initialize();
      await dataSource.query("SELECT 1");
      return dataSource;
    } catch (error) {
      lastError = error;
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Timed out waiting for test postgres container: ${String(lastError)}`);
}

async function columnExists(dataSource: DataSource, tableName: string, columnName: string): Promise<boolean> {
  const rows = await dataSource.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName],
  );
  return rows.length > 0;
}

async function enumValues(dataSource: DataSource, enumTypeName: string): Promise<string[]> {
  const rows = await dataSource.query(
    `
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = $1
      ORDER BY e.enumsortorder
    `,
    [enumTypeName],
  );
  return rows.map((row: { enumlabel: string }) => row.enumlabel);
}

async function jobScheduleRowCount(dataSource: DataSource, jobType: string): Promise<number> {
  const rows = await dataSource.query(`SELECT COUNT(*)::int AS count FROM job_schedule_state WHERE job_type = $1`, [
    jobType,
  ]);
  return rows[0].count;
}

async function tableExists(dataSource: DataSource, tableName: string): Promise<boolean> {
  const rows = await dataSource.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
      LIMIT 1
    `,
    [tableName],
  );
  return rows.length > 0;
}

async function materializedViewExists(dataSource: DataSource, viewName: string): Promise<boolean> {
  const rows = await dataSource.query(
    `
      SELECT 1
      FROM pg_matviews
      WHERE schemaname = 'public'
        AND matviewname = $1
      LIMIT 1
    `,
    [viewName],
  );
  return rows.length > 0;
}

async function functionExists(dataSource: DataSource, functionName: string): Promise<boolean> {
  const rows = await dataSource.query(
    `
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = $1
      LIMIT 1
    `,
    [functionName],
  );
  return rows.length > 0;
}

async function typeExists(dataSource: DataSource, typeName: string): Promise<boolean> {
  const rows = await dataSource.query(
    `
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = $1
      LIMIT 1
    `,
    [typeName],
  );
  return rows.length > 0;
}

describeWithDocker("Migrations (integration)", () => {
  let migrationDataSource: DataSource | null = null;
  let containerId = "";

  beforeAll(async () => {
    const containerName = `dealbot-migrations-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    containerId = await runDocker([
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      "POSTGRES_USER=test",
      "-e",
      "POSTGRES_PASSWORD=test",
      "-e",
      "POSTGRES_DB=dealbot_migrations",
      "-P",
      "postgres:16",
    ]);
    const mappedPort = parseMappedPort(await runDocker(["port", containerId, "5432/tcp"]));

    migrationDataSource = await waitForDatabase(
      {
        host: "127.0.0.1",
        port: mappedPort,
        user: "test",
        password: "test",
        database: "dealbot_migrations",
      },
      60_000,
    );
  }, 180_000);

  afterAll(async () => {
    if (migrationDataSource?.isInitialized) {
      await migrationDataSource.destroy();
    }
    if (containerId) {
      try {
        await runDocker(["stop", containerId]);
      } catch {
        // Ignore cleanup failures for already-stopped containers.
      }
    }
  }, 120_000);

  it("applies all migrations cleanly on a fresh database and yields the expected end state", async () => {
    const dataSource = migrationDataSource;
    if (!dataSource) {
      throw new Error("migration data source is not initialized");
    }

    const applied = await dataSource.runMigrations();
    expect(applied.length).toBe(ALL_MIGRATIONS.length);

    // Core tables present.
    expect(await tableExists(dataSource, "storage_providers")).toBe(true);
    expect(await tableExists(dataSource, "deals")).toBe(true);
    expect(await tableExists(dataSource, "retrievals")).toBe(true);
    expect(await tableExists(dataSource, "job_schedule_state")).toBe(true);
    expect(await tableExists(dataSource, "data_retention_baselines")).toBe(true);

    // Metrics schema fully dropped by DropMetricsSchema1776200000000.
    expect(await tableExists(dataSource, "metrics_daily")).toBe(false);
    expect(await materializedViewExists(dataSource, "sp_performance_last_week")).toBe(false);
    expect(await materializedViewExists(dataSource, "sp_performance_all_time")).toBe(false);
    expect(await functionExists(dataSource, "refresh_sp_performance_last_week")).toBe(false);
    expect(await functionExists(dataSource, "refresh_sp_performance_all_time")).toBe(false);
    expect(await typeExists(dataSource, "metrics_daily_metric_type_enum")).toBe(false);
    expect(await typeExists(dataSource, "metrics_daily_service_type_enum")).toBe(false);

    // IPNI cleanup migrations applied.
    expect(await columnExists(dataSource, "deals", "ipni_retrieved_at")).toBe(false);
    expect(await columnExists(dataSource, "deals", "ipni_time_to_retrieve_ms")).toBe(false);
    expect(await enumValues(dataSource, "deals_ipni_status_enum")).not.toContain("sp_received_retrieve_request");

    // Running migrations again is a no-op.
    const rerun = await dataSource.runMigrations();
    expect(rerun.length).toBe(0);
  }, 180_000);

  it("RemoveMetricsJobScheduleRows deletes legacy job schedule rows and preserves valid ones", async () => {
    const dataSource = migrationDataSource;
    if (!dataSource) {
      throw new Error("migration data source is not initialized");
    }

    const nextRunAt = new Date().toISOString();
    await dataSource.query(
      `
        INSERT INTO job_schedule_state (job_type, sp_address, interval_seconds, next_run_at, paused)
        VALUES
          ('metrics',         '',        1800,   $1, false),
          ('metrics_cleanup', '',        604800, $1, false),
          ('deal',            '0xkeep',  3600,   $1, false)
        ON CONFLICT (job_type, sp_address) DO NOTHING
      `,
      [nextRunAt],
    );

    // Re-apply the migration against the seeded rows by removing its row from TypeORM's bookkeeping table.
    await dataSource.query(`DELETE FROM migrations WHERE name = 'RemoveMetricsJobScheduleRows1776147113065'`);
    await dataSource.runMigrations();

    expect(await jobScheduleRowCount(dataSource, "metrics")).toBe(0);
    expect(await jobScheduleRowCount(dataSource, "metrics_cleanup")).toBe(0);
    expect(await jobScheduleRowCount(dataSource, "deal")).toBeGreaterThan(0);
  }, 60_000);
});
