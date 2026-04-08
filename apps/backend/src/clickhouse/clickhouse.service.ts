import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter, Gauge, Histogram } from "prom-client";
import { loadClickhouseConfig, type IClickhouseConfig } from "./clickhouse.config.js";

interface BufferedRow {
  table: string;
  row: Record<string, unknown>;
}

@Injectable()
export class ClickhouseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ClickhouseService.name);
  private readonly config: IClickhouseConfig;
  private client: ClickHouseClient | null = null;
  private buffer: BufferedRow[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectMetric("clickhouseFlushDurationMs") private readonly flushDuration: Histogram,
    @InjectMetric("clickhouseFlushErrorsTotal") private readonly flushErrors: Counter,
    @InjectMetric("clickhouseBufferRows") private readonly bufferRows: Gauge,
    @InjectMetric("clickhouseRowsInsertedTotal") private readonly rowsInserted: Counter,
  ) {
    this.config = loadClickhouseConfig();
  }

  onModuleInit() {
    if (!this.config.url) {
      this.logger.log("CLICKHOUSE_URL not set, writes to ClickHouse disabled");
      return;
    }

    this.client = createClient({
      url: this.config.url,
      database: this.config.database,
    });

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.logger.error({ event: "flush_interval_error", error: String(err) });
      });
    }, this.config.flushIntervalMs);

    this.logger.log({
      event: "clickhouse_initialized",
      url: this.config.url,
      database: this.config.database,
      batchSize: this.config.batchSize,
      flushIntervalMs: this.config.flushIntervalMs,
      probeLocation: this.config.probeLocation,
    });
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
   * Safe to call when ClickHouse is disable: rows are silently dropped.
   */
  insert(table: string, row: Record<string, unknown>): void {
    if (!this.client) return;

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

    const batch = this.buffer.splice(0, this.buffer.length);
    this.bufferRows.set(0);

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
      end();
    } catch (err) {
      end();
      this.flushErrors.inc();
      this.logger.error({
        event: "flush_failed",
        error: String(err),
        droppedRows: batch.length,
      });
    }
  }

  get probeLocation(): string {
    return this.config.probeLocation;
  }

  get enabled(): boolean {
    return this.client !== null;
  }
}
