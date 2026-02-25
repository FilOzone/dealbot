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

const execFileAsync = promisify(execFile);
const dockerCheck = spawnSync("docker", ["info"], { stdio: "ignore" });
if (dockerCheck.status !== 0) {
  console.warn("[migrations.e2e] Skipping migration integration tests. Docker is not available.");
}
const describeWithDocker = dockerCheck.status === 0 ? describe : describe.skip;

const TARGET_MIGRATION_NAMES = [
  "RemoveSpReceivedRetrieveRequest1761500000000",
  "RemoveIpniRetrievedColumns1761500000001",
];

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

async function indexDefinition(dataSource: DataSource, indexName: string): Promise<string | null> {
  const rows = await dataSource.query(
    `
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = $1
      LIMIT 1
    `,
    [indexName],
  );
  return rows[0]?.indexdef ?? null;
}

async function dealIpniStatus(dataSource: DataSource, dealId: string): Promise<string | null> {
  const rows = await dataSource.query(`SELECT ipni_status FROM deals WHERE id = $1`, [dealId]);
  return rows[0]?.ipni_status ?? null;
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

  it("roundtrips latest IPNI migrations (up/down/up) with expected schema and data behavior", async () => {
    const dataSource = migrationDataSource;
    if (!dataSource) {
      throw new Error("migration data source is not initialized");
    }

    const initialRun = await dataSource.runMigrations();
    expect(initialRun.length).toBeGreaterThan(0);

    await dataSource.undoLastMigration();
    await dataSource.undoLastMigration();

    expect(await enumValues(dataSource, "deals_ipni_status_enum")).toContain("sp_received_retrieve_request");
    expect(await columnExists(dataSource, "metrics_daily", "ipni_retrieved_deals")).toBe(true);
    expect(await columnExists(dataSource, "deals", "ipni_retrieved_at")).toBe(true);
    expect(await columnExists(dataSource, "deals", "ipni_time_to_retrieve_ms")).toBe(true);
    expect(await columnExists(dataSource, "metrics_daily", "avg_ipni_time_to_retrieve_ms")).toBe(true);

    const spAddress = "f01234567";
    const dealId = "00000000-0000-0000-0000-000000000001";

    await dataSource.query(
      `
        INSERT INTO storage_providers (address, name, description, payee, region, metadata, is_active, is_approved)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, true)
      `,
      [spAddress, "Migration Test SP", "Migration test provider", "f01234567", "test-region", JSON.stringify({})],
    );
    await dataSource.query(
      `
        INSERT INTO deals (
          id,
          sp_address,
          wallet_address,
          file_name,
          file_size,
          status,
          metadata,
          service_types,
          ipni_status,
          ipni_retrieved_at,
          ipni_time_to_retrieve_ms,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'deal_created',
          $6::jsonb,
          $7,
          'sp_received_retrieve_request',
          NOW(),
          123,
          NOW(),
          NOW()
        )
      `,
      [dealId, spAddress, "0x123", "test-file.car", 1024, JSON.stringify({}), "ipfs_pin"],
    );

    const rerunLatest = await dataSource.runMigrations();
    expect(rerunLatest.map((migration) => migration.name)).toEqual(expect.arrayContaining(TARGET_MIGRATION_NAMES));

    expect(await dealIpniStatus(dataSource, dealId)).toBe("sp_advertised");
    expect(await enumValues(dataSource, "deals_ipni_status_enum")).not.toContain("sp_received_retrieve_request");
    expect(await columnExists(dataSource, "metrics_daily", "ipni_retrieved_deals")).toBe(false);
    expect(await columnExists(dataSource, "deals", "ipni_retrieved_at")).toBe(false);
    expect(await columnExists(dataSource, "deals", "ipni_time_to_retrieve_ms")).toBe(false);
    expect(await columnExists(dataSource, "metrics_daily", "avg_ipni_time_to_retrieve_ms")).toBe(false);

    await dataSource.undoLastMigration();
    await dataSource.undoLastMigration();

    expect(await enumValues(dataSource, "deals_ipni_status_enum")).toContain("sp_received_retrieve_request");
    expect(await dealIpniStatus(dataSource, dealId)).toBe("sp_received_retrieve_request");
    expect(await columnExists(dataSource, "metrics_daily", "ipni_retrieved_deals")).toBe(true);
    expect(await columnExists(dataSource, "deals", "ipni_retrieved_at")).toBe(true);
    expect(await columnExists(dataSource, "deals", "ipni_time_to_retrieve_ms")).toBe(true);
    expect(await columnExists(dataSource, "metrics_daily", "avg_ipni_time_to_retrieve_ms")).toBe(true);

    const retrievedAtIndex = await indexDefinition(dataSource, "IDX_deals_ipni_retrieved_at");
    expect(retrievedAtIndex).not.toBeNull();
    expect(retrievedAtIndex).toMatch(/where\s+\(?ipni_retrieved_at\s+is\s+not\s+null\)?/i);

    const finalRun = await dataSource.runMigrations();
    expect(finalRun.map((migration) => migration.name)).toEqual(expect.arrayContaining(TARGET_MIGRATION_NAMES));
    expect(await dealIpniStatus(dataSource, dealId)).toBe("sp_advertised");
  }, 180_000);
});
