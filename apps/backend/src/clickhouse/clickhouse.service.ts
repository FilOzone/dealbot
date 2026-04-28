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
    this.database = parsedUrl.pathname.replace(/^\//, "");
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

    const result = await this.client.query({
      query: `SELECT version FROM ${database}.schema_migrations ORDER BY version`,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as { version: number }[];
    const applied = new Set(rows.map((r) => r.version));

    const migrations = getMigrations(database);
    let count = 0;
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
      count++;
    }

    this.logger.log({ event: "clickhouse_migrated", database, appliedCount: count });
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
      query: `ALTER TABLE ${this.database}.schema_migrations DELETE WHERE version = ${version}`,
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
