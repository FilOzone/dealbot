import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter, Gauge, Histogram } from "prom-client";
import type { Network } from "../common/types.js";
import type { IClickhouseConfig, IConfig } from "../config/index.js";
import { getClickHouseMigrations } from "./clickhouse.migrations.js";
import { buildMigrations, CLICKHOUSE_NETWORK_TABLES } from "./clickhouse.schema.js";
import { ClickHouseRows } from "./clickhouse.types.js";

interface BufferedRow {
  table: string;
  row: Record<string, unknown> & { network: Network };
}

interface ClickhouseDestination {
  client: ClickHouseClient;
  database: string;
  buffer: BufferedRow[];
  inFlight: BufferedRow[];
  flushPromise: Promise<void> | null;
}

type InsertableClickHouseRow<T extends string> = (T extends keyof ClickHouseRows
  ? ClickHouseRows[T]
  : Record<string, unknown>) & { network: Network };

@Injectable()
export class ClickhouseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ClickhouseService.name);
  private readonly config: IClickhouseConfig;
  private readonly destinations = new Map<Network, ClickhouseDestination>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectMetric("clickhouseFlushDurationSeconds") private readonly flushDuration: Histogram,
    @InjectMetric("clickhouseFlushErrorsTotal") private readonly flushErrors: Counter,
    @InjectMetric("clickhouseBufferRows") private readonly bufferRows: Gauge,
    @InjectMetric("clickhouseRowsInsertedTotal") private readonly rowsInserted: Counter,
    @InjectMetric("clickhouseDroppedRowsTotal") private readonly droppedRows: Counter,
    private readonly configService: ConfigService<IConfig, true>,
  ) {
    this.config = this.configService.get("clickhouse", { infer: true });
  }

  async onModuleInit() {
    const activeNetworks = this.configService.get("activeNetworks", { infer: true });
    const networks = this.configService.get("networks", { infer: true });

    const configuredDestinations = activeNetworks.flatMap((network) => {
      const url = networks[network].clickhouseUrl;
      if (!url) {
        this.logger.log({
          event: "clickhouse_disabled",
          network,
          message: `${network.toUpperCase()}_CLICKHOUSE_URL not set`,
        });
        return [];
      }

      const parsedUrl = new URL(url);
      const database = parsedUrl.pathname.replace(/^\/+|\/+$/g, "");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) {
        throw new Error(
          `${network.toUpperCase()}_CLICKHOUSE_URL must include one database name that starts with a letter or underscore and contains only letters, digits, and underscores`,
        );
      }

      return [{ network, url, parsedUrl, database }];
    });

    if (configuredDestinations.length === 0) {
      this.logger.log("No network-specific ClickHouse URLs set, writes to ClickHouse disabled");
      return;
    }

    try {
      for (const { network, url, parsedUrl, database } of configuredDestinations) {
        const client = createClient({ url });
        try {
          await this.migrate(client, database, network);
        } catch (err) {
          await client.close();
          this.logger.error({
            event: "clickhouse_migration_failed",
            network,
            database,
            error: String(err),
          });
          throw err;
        }

        this.destinations.set(network, {
          client,
          database,
          buffer: [],
          inFlight: [],
          flushPromise: null,
        });

        this.logger.log({
          event: "clickhouse_initialized",
          network,
          host: parsedUrl.host,
          database,
          batchSize: this.config.batchSize,
          flushIntervalMs: this.config.flushIntervalMs,
          maxBufferSize: this.config.maxBufferSize,
          probeLocation: this.configService.get("app").probeLocation,
        });
      }
    } catch (err) {
      await this.closeClients();
      throw err;
    }

    this.flushTimer = setInterval(() => {
      this.flushAll().catch((err) => {
        this.logger.error({ event: "flush_interval_error", error: String(err) });
      });
    }, this.config.flushIntervalMs);
  }

  private async migrate(client: ClickHouseClient, database: string, network: Network): Promise<void> {
    await this.createSchemaMigrationsTable(client, database);
    if (!(await this.tryAcquireMigrationLock(client, database))) {
      const lockTable = this.migrationLockTable(database);
      throw new Error(
        `Could not acquire ClickHouse migration lock ${lockTable}. ` +
          `Another instance may be migrating this database. If no migration is running, drop the stale lock table and restart.`,
      );
    }

    let legacyBackfillNetwork: Network | undefined;
    let appliedCount = 0;
    let schemaVersion = 0;
    try {
      const missingNetworkTables = await this.findTablesMissingNetwork(client, database);
      legacyBackfillNetwork = missingNetworkTables.length > 0 ? network : undefined;

      const bootstrapStatements = buildMigrations(database, legacyBackfillNetwork);
      for (const sql of bootstrapStatements) {
        await client.command({ query: sql });
      }

      ({ appliedCount, schemaVersion } = await this.runSchemaMigrations(client, database));
    } finally {
      await this.releaseMigrationLock(client, database);
    }

    this.logger.log({
      event: "clickhouse_migrated",
      network,
      database,
      legacyBackfillNetwork,
      schemaVersion,
      appliedCount,
    });
  }

  private async findTablesMissingNetwork(client: ClickHouseClient, database: string): Promise<string[]> {
    const tableNames = CLICKHOUSE_NETWORK_TABLES.map((table) => `'${table}'`).join(", ");
    const result = await client.query({
      query: `SELECT name
        FROM (SELECT arrayJoin([${tableNames}]) AS name)
        WHERE name NOT IN (
          SELECT table
          FROM system.columns
          WHERE database = {database:String} AND name = 'network'
        )`,
      query_params: { database },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ name: string }>();
    return rows.map(({ name }) => name);
  }

  private async createSchemaMigrationsTable(client: ClickHouseClient, database: string): Promise<void> {
    await client.command({
      query: `CREATE TABLE IF NOT EXISTS ${database}.schema_migrations
(
    version    UInt32,
    name       String,
    applied_at DateTime64(3, 'UTC') DEFAULT now64()
)
ENGINE = MergeTree()
ORDER BY version`,
    });
  }

  private async runSchemaMigrations(
    client: ClickHouseClient,
    database: string,
  ): Promise<{ appliedCount: number; schemaVersion: number }> {
    const result = await client.query({
      query: `SELECT version FROM ${database}.schema_migrations ORDER BY version`,
      format: "JSONEachRow",
    });
    const rows = await result.json<{ version: number }>();
    const appliedVersions = new Set(rows.map(({ version }) => version));
    const migrations = getClickHouseMigrations(database).sort((a, b) => a.version - b.version);
    const pendingMigrations = migrations.filter(({ version }) => !appliedVersions.has(version));
    let schemaVersion = appliedVersions.size > 0 ? Math.max(...appliedVersions) : 0;
    let appliedCount = 0;

    if (pendingMigrations.length > 0) {
      await this.assertAtomicTableExchangeSupport(client, database);
    }

    for (const migration of pendingMigrations) {
      for (const sql of migration.up) {
        await client.command({ query: sql });
      }
      await client.command({
        query: `INSERT INTO ${database}.schema_migrations (version, name)
VALUES ({version:UInt32}, {name:String})`,
        query_params: { version: migration.version, name: migration.name },
      });

      this.logger.log({
        event: "clickhouse_migration_applied",
        database,
        version: migration.version,
        name: migration.name,
      });
      schemaVersion = migration.version;
      appliedCount++;
    }

    return { appliedCount, schemaVersion };
  }

  private async assertAtomicTableExchangeSupport(client: ClickHouseClient, database: string): Promise<void> {
    const result = await client.query({
      query: `SELECT engine FROM system.databases WHERE name = {database:String}`,
      query_params: { database },
      format: "JSONEachRow",
    });
    const [row] = await result.json<{ engine: string }>();

    if (!row || !["Atomic", "Shared"].includes(row.engine)) {
      throw new Error(
        `ClickHouse database ${database} must use the Atomic or Shared engine for versioned table migrations. ` +
          `Got: ${row?.engine ?? "not found"}`,
      );
    }
  }

  private migrationLockTable(database: string): string {
    return `${database}.schema_migration_lock`;
  }

  private async tryAcquireMigrationLock(client: ClickHouseClient, database: string): Promise<boolean> {
    try {
      await client.command({
        query: `CREATE TABLE ${this.migrationLockTable(database)}
          (locked UInt8)
          ENGINE = MergeTree()
          ORDER BY tuple()`,
      });
      return true;
    } catch (error) {
      if (error instanceof Error && /already exists/i.test(error.message)) return false;
      throw error;
    }
  }

  private async releaseMigrationLock(client: ClickHouseClient, database: string): Promise<void> {
    await client.command({
      query: `DROP TABLE IF EXISTS ${this.migrationLockTable(database)} SYNC`,
    });
  }

  async onApplicationShutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushAll();
    await this.closeClients();
  }

  private async closeClients(): Promise<void> {
    await Promise.all(Array.from(this.destinations.values(), ({ client }) => client.close()));
    this.destinations.clear();
  }

  /**
   * Queue a row for insertion. Returns immediately; the flush happens in the background.
   * Safe to call when ClickHouse is disabled for the row's network.
   *
   * Tables registered in {@link ClickHouseRows} are type-checked against their
   * row shape. Other table names accept any row with a valid `network`.
   */
  insert<T extends string>(table: T, row: InsertableClickHouseRow<T>): void {
    const destination = this.destinations.get(row.network);
    if (!destination) return;

    const totalRows = destination.inFlight.length + destination.buffer.length;
    if (totalRows >= this.config.maxBufferSize) {
      const dropped = destination.buffer.shift();
      if (!dropped) {
        this.droppedRows.inc({ reason: "buffer_full", network: row.network });
        return;
      }
      this.droppedRows.inc({ reason: "buffer_full", network: dropped.row.network });
    }

    destination.buffer.push({
      table,
      row: { ...row },
    });
    this.bufferRows.set({ network: row.network }, destination.inFlight.length + destination.buffer.length);

    if (destination.buffer.length >= this.config.batchSize) {
      this.flushNetwork(row.network).catch((err) => {
        this.logger.error({ event: "flush_batch_error", network: row.network, error: String(err) });
      });
    }
  }

  private async flushAll(): Promise<void> {
    await Promise.all(Array.from(this.destinations.keys(), (network) => this.flushNetwork(network)));
  }

  private flushNetwork(network: Network): Promise<void> {
    const destination = this.destinations.get(network);
    if (!destination) return Promise.resolve();
    if (destination.flushPromise) return destination.flushPromise;
    if (destination.buffer.length === 0) return Promise.resolve();

    destination.flushPromise = (async () => {
      while (destination.buffer.length > 0) {
        if (!(await this.flushDestination(network, destination))) break;
      }
    })().finally(() => {
      destination.flushPromise = null;
    });
    return destination.flushPromise;
  }

  private async flushDestination(network: Network, destination: ClickhouseDestination): Promise<boolean> {
    const n = destination.buffer.length;
    const batch = destination.buffer.splice(0, n);
    destination.inFlight = batch;

    // Group by table so we can do one insert call per table
    const byTable = new Map<string, BufferedRow[]>();
    for (const bufferedRow of batch) {
      const { table } = bufferedRow;
      let rows = byTable.get(table);
      if (!rows) {
        rows = [];
        byTable.set(table, rows);
      }
      rows.push(bufferedRow);
    }

    const end = this.flushDuration.startTimer({ network });
    try {
      await Promise.all(
        Array.from(byTable.entries()).map(async ([table, bufferedRows]) => {
          await destination.client.insert({
            table,
            values: bufferedRows.map(({ row }) => row),
            format: "JSONEachRow",
          });

          this.rowsInserted.inc({ table, network }, bufferedRows.length);
        }),
      );
      destination.inFlight = [];
      this.bufferRows.set({ network }, destination.buffer.length);
      return true;
    } catch (err) {
      destination.buffer.unshift(...batch);
      destination.inFlight = [];
      this.bufferRows.set({ network }, destination.buffer.length);
      this.flushErrors.inc({ network });
      this.logger.error({
        event: "flush_failed",
        network,
        database: destination.database,
        error: String(err),
        pendingRows: destination.buffer.length,
      });
      return false;
    } finally {
      end();
    }
  }

  get probeLocation(): string {
    return this.configService.get("app").probeLocation;
  }
}
