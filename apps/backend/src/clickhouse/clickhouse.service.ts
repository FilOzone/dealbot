import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { Counter, Gauge, Histogram } from "prom-client";
import type { Network } from "../common/types.js";
import type { IClickhouseConfig, IConfig } from "../config/index.js";
import { buildMigrations } from "./clickhouse.schema.js";
import { ClickHouseRows } from "./clickhouse.types.js";

interface BufferedRow {
  table: string;
  row: Record<string, unknown>;
}

interface ClickhouseDestination {
  client: ClickHouseClient;
  database: string;
  buffer: BufferedRow[];
  inFlight: BufferedRow[];
  flushPromise: Promise<void> | null;
}

type InsertableClickHouseRow<T extends string> = T extends keyof ClickHouseRows
  ? ClickHouseRows[T]
  : Record<string, unknown>;

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

    const databaseOwners = new Map<string, Network>();
    for (const { network, parsedUrl, database } of configuredDestinations) {
      const databaseKey = `${parsedUrl.origin}/${database}`;
      const existingNetwork = databaseOwners.get(databaseKey);
      if (existingNetwork) {
        throw new Error(
          `${existingNetwork.toUpperCase()}_CLICKHOUSE_URL and ${network.toUpperCase()}_CLICKHOUSE_URL must use different ClickHouse databases`,
        );
      }
      databaseOwners.set(databaseKey, network);
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
    const migrations = buildMigrations(database);
    for (const sql of migrations) {
      await client.command({ query: sql });
    }

    this.logger.log({ event: "clickhouse_migrated", network, database });
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
   * Safe to call when ClickHouse is disabled for the selected network.
   * The network selects a database and is not included in the stored row.
   *
   * Tables registered in {@link ClickHouseRows} are type-checked against their
   * row shape. Other table names accept any row.
   */
  insert<T extends string>(network: Network, table: T, row: InsertableClickHouseRow<T>): void {
    const destination = this.destinations.get(network);
    if (!destination) return;

    const totalRows = destination.inFlight.length + destination.buffer.length;
    if (totalRows >= this.config.maxBufferSize) {
      const dropped = destination.buffer.shift();
      if (!dropped) {
        this.droppedRows.inc({ reason: "buffer_full", network });
        return;
      }
      this.droppedRows.inc({ reason: "buffer_full", network });
    }

    destination.buffer.push({
      table,
      row: { ...row },
    });
    this.bufferRows.set({ network }, destination.inFlight.length + destination.buffer.length);

    if (destination.buffer.length >= this.config.batchSize) {
      this.flushNetwork(network).catch((err) => {
        this.logger.error({ event: "flush_batch_error", network, error: String(err) });
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
