import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter, Gauge, Histogram } from "prom-client";
import type { IClickhouseConfig, IConfig } from "../config/app.config.js";
import { getMigrations } from "./clickhouse.migrations.js";

interface BufferedRow {
  table: string;
  row: Record<string, unknown>;
}

@Injectable()
export class ClickhouseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ClickhouseService.name);
  private readonly config: IClickhouseConfig;
  private client: ClickHouseClient | null = null;
  private database = "";
  private buffer: BufferedRow[] = [];
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
    if (!this.config.url) {
      this.logger.log("CLICKHOUSE_URL not set, writes to ClickHouse disabled");
      return;
    }

    this.client = createClient({
      url: this.config.url,
    });

    const parsedUrl = new URL(this.config.url);
    const dbName = parsedUrl.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
    if (!dbName || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(dbName)) {
      throw new Error(
        `CLICKHOUSE_URL database name "${dbName}" is invalid - must start with a letter and contain only letters, digits, and underscores, e.g. http://host:8123/dealbot`,
      );
    }
    this.database = dbName;
    try {
      await this.migrate(this.database);
    } catch (err) {
      this.logger.error({ event: "clickhouse_migration_failed", database: this.database, error: String(err) });
      throw err;
    }

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.logger.error({ event: "flush_interval_error", error: String(err) });
      });
    }, this.config.flushIntervalMs);

    this.logger.log({
      event: "clickhouse_initialized",
      host: parsedUrl.host,
      database: this.database,
      batchSize: this.config.batchSize,
      flushIntervalMs: this.config.flushIntervalMs,
      probeLocation: this.configService.get("app").probeLocation,
    });
  }

  private async migrate(database: string): Promise<void> {
    if (!this.client) return;

    await this.client.command({
      query: `CREATE TABLE IF NOT EXISTS ${database}.schema_migrations
(
    version    UInt32,
    name       String,
    applied_at DateTime64(3, 'UTC') DEFAULT now64()
)
ENGINE = MergeTree()
ORDER BY version`,
    });

    const lockAcquired = await this.tryAcquireMigrationLock(database);
    if (!lockAcquired) {
      const lockTable = this.migrationLockTable(database);
      const message = `Could not acquire migration lock on ${lockTable}. Another instance may be running migrations, or a previous migration process may have crashed and left a stale lock. If no migrations are currently running, drop the lock table and restart: DROP TABLE ${lockTable}`;
      this.logger.error({ event: "migration_locked", message, lockTable });
      throw new Error(message);
    }

    try {
      const result = await this.client.query({
        query: `SELECT version FROM ${database}.schema_migrations ORDER BY version`,
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as { version: number }[];
      const applied = new Set(rows.map((r) => r.version));

      const migrations = getMigrations(database).sort((a, b) => a.version - b.version);
      let count = 0;
      let schemaVersion = applied.size > 0 ? Math.max(...applied) : 0;
      for (const m of migrations) {
        if (applied.has(m.version)) continue;
        for (const sql of m.up) {
          await this.client.command({ query: sql });
        }
        await this.client.insert({
          table: `${database}.schema_migrations`,
          values: [{ version: m.version, name: m.name }],
          format: "JSONEachRow",
        });
        this.logger.log({ event: "migration_applied", version: m.version, name: m.name });
        schemaVersion = m.version;
        count++;
      }

      this.logger.log({ event: "clickhouse_migrated", database, schemaVersion, appliedCount: count });
    } finally {
      await this.releaseMigrationLock(database);
    }
  }

  private migrationLockTable(database: string): string {
    return `${database}.schema_migration_lock`;
  }

  // The lock table is normally dropped in the finally block after migrations complete.
  // If the process crashes while holding the lock the table is left behind, and all
  // subsequent startups will fail with "Migration lock is held by another instance".
  // To recover, drop the table manually:
  //   DROP TABLE <database>.schema_migration_lock
  private async tryAcquireMigrationLock(database: string): Promise<boolean> {
    if (!this.client) throw new Error("ClickHouse not connected");
    try {
      await this.client.command({
        query: `CREATE TABLE ${this.migrationLockTable(database)} (locked UInt8) ENGINE = TinyLog`,
      });
      return true;
    } catch (error) {
      if (error instanceof Error && /already exists/i.test(error.message)) {
        return false;
      }
      throw error;
    }
  }

  private async releaseMigrationLock(database: string): Promise<void> {
    if (!this.client) throw new Error("ClickHouse not connected");
    await this.client.command({
      query: `DROP TABLE IF EXISTS ${this.migrationLockTable(database)}`,
    });
  }

  async migrateDown(version: number): Promise<void> {
    if (!this.client) throw new Error("ClickHouse not connected");
    const migrations = getMigrations(this.database);
    const migration = migrations.find((m) => m.version === version);
    if (!migration) throw new Error(`Migration version ${version} not found`);

    for (const sql of migration.down) {
      await this.client.command({ query: sql });
    }
    await this.client.command({
      query: `DELETE FROM ${this.database}.schema_migrations WHERE version = {version:UInt32}`,
      query_params: { version },
    });
    this.logger.log({ event: "migration_rolled_back", version, name: migration.name });
  }

  async onApplicationShutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    await this.client?.close();
  }

  /**
   * Queue a row for insertion. Returns immediately; the flush happens in the background.
   * Safe to call when ClickHouse is disabled: rows are silently dropped.
   */
  insert(table: string, row: Record<string, unknown>): void {
    if (!this.client) return;

    if (this.buffer.length >= this.config.maxBufferSize) {
      this.buffer.shift();
      this.droppedRows.inc({ reason: "buffer_full" });
    }

    this.buffer.push({ table, row });
    this.bufferRows.set(this.buffer.length);

    if (this.buffer.length >= this.config.batchSize) {
      this.flush().catch((err) => {
        this.logger.error({ event: "flush_batch_error", error: String(err) });
      });
    }
  }

  private async flush(): Promise<void> {
    if (!this.client || this.buffer.length === 0) return;

    const n = this.buffer.length;
    const batch = this.buffer.slice(0, n);

    // Group by table so we can do one insert call per table
    const byTable = new Map<string, Record<string, unknown>[]>();
    for (const { table, row } of batch) {
      let rows = byTable.get(table);
      if (!rows) {
        rows = [];
        byTable.set(table, rows);
      }
      rows.push(row);
    }

    const end = this.flushDuration.startTimer();
    try {
      await Promise.all(
        Array.from(byTable.entries()).map(async ([table, rows]) => {
          await this.client!.insert({
            table,
            values: rows,
            format: "JSONEachRow",
          });
          this.rowsInserted.inc({ table }, rows.length);
        }),
      );
      this.buffer.splice(0, n);
      this.bufferRows.set(this.buffer.length);
    } catch (err) {
      this.flushErrors.inc();
      this.logger.error({
        event: "flush_failed",
        error: String(err),
        pendingRows: n,
      });
    } finally {
      end();
    }
  }

  get probeLocation(): string {
    return this.configService.get("app").probeLocation;
  }

  get enabled(): boolean {
    return this.client !== null;
  }
}
