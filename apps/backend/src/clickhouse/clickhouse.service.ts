import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter, Gauge, Histogram } from "prom-client";
import { resolveLegacyNetworkBackfill } from "../common/legacy-network-backfill.js";
import type { Network } from "../common/types.js";
import type { IClickhouseConfig, IConfig } from "../config/index.js";
import { buildMigrations, CLICKHOUSE_TABLES, LEGACY_CLICKHOUSE_TABLES } from "./clickhouse.schema.js";
import { ClickHouseRows } from "./clickhouse.types.js";

interface BufferedRow {
  table: string;
  row: Record<string, unknown> & { network: Network };
}

type InsertableClickHouseRow<T extends string> = (T extends keyof ClickHouseRows
  ? ClickHouseRows[T]
  : Record<string, unknown>) & { network: Network };

@Injectable()
export class ClickhouseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ClickhouseService.name);
  private readonly config: IClickhouseConfig;
  private client: ClickHouseClient | null = null;
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
    const database = parsedUrl.pathname.replace(/^\//, "");
    try {
      await this.migrate(database);
    } catch (err) {
      this.logger.error({ event: "clickhouse_migration_failed", database, error: String(err) });
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
      database,
      batchSize: this.config.batchSize,
      flushIntervalMs: this.config.flushIntervalMs,
      probeLocation: this.configService.get("app").probeLocation,
    });
  }

  private async migrate(database: string): Promise<void> {
    if (!this.client) return;

    const missingNetworkTables = await this.findTablesMissingNetwork(database);
    const legacyBackfillNetwork =
      missingNetworkTables.length > 0 ? this.resolveLegacyBackfillNetwork(missingNetworkTables) : undefined;
    const migrations = buildMigrations(database, legacyBackfillNetwork);
    for (const sql of migrations) {
      await this.client.command({ query: sql });
    }
    this.logger.log({ event: "clickhouse_migrated", database, legacyBackfillNetwork });
  }

  private async findTablesMissingNetwork(database: string): Promise<string[]> {
    if (!this.client) return [];

    const tableNames = [...CLICKHOUSE_TABLES, ...LEGACY_CLICKHOUSE_TABLES].map((table) => `'${table}'`).join(", ");
    const result = await this.client.query({
      query: `SELECT name
        FROM system.tables
        WHERE database = {database:String}
          AND name IN (${tableNames})
          AND name NOT IN (
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

  private resolveLegacyBackfillNetwork(missingTables: string[]): Network {
    return resolveLegacyNetworkBackfill(
      `ClickHouse network migration requires DEALBOT_LEGACY_NETWORK_BACKFILL (or legacy NETWORK) to be set to a ` +
        `supported network. Existing tables without network: ${missingTables.join(", ")}.`,
    );
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
   *
   * Tables registered in {@link ClickHouseRows} are type-checked against their
   * row shape. Other table names accept any row with a valid `network`.
   */
  insert<T extends string>(table: T, row: InsertableClickHouseRow<T>): void {
    if (!this.client) return;

    if (this.buffer.length >= this.config.maxBufferSize) {
      const dropped = this.buffer.shift();
      if (dropped) this.droppedRows.inc({ reason: "buffer_full", network: dropped.row.network });
    }

    this.buffer.push({
      table,
      row: { ...row },
    });
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

    const end = this.flushDuration.startTimer();
    try {
      await Promise.all(
        Array.from(byTable.entries()).map(async ([table, bufferedRows]) => {
          await this.client!.insert({
            table,
            values: bufferedRows.map(({ row }) => row),
            format: "JSONEachRow",
          });

          const rowsByNetwork = new Map<Network, number>();
          for (const {
            row: { network },
          } of bufferedRows) {
            rowsByNetwork.set(network, (rowsByNetwork.get(network) ?? 0) + 1);
          }
          for (const [network, count] of rowsByNetwork) {
            this.rowsInserted.inc({ table, network }, count);
          }
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
