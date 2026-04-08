export interface IClickhouseConfig {
  /**
   * ClickHouse connection URL. Must include the database in the path.
   * Example: http://default:password@host:8123/dealbot
   * If unset, ClickHouse emission is disabled.
   */
  url: string | undefined;
  batchSize: number;
  flushIntervalMs: number;
  probeLocation: string;
}

export function loadClickhouseConfig(): IClickhouseConfig {
  return {
    url: process.env.CLICKHOUSE_URL || undefined,
    batchSize: Number.parseInt(process.env.CLICKHOUSE_BATCH_SIZE || "500", 10),
    flushIntervalMs: Number.parseInt(process.env.CLICKHOUSE_FLUSH_INTERVAL_MS || "5000", 10),
    probeLocation: process.env.DEALBOT_PROBE_LOCATION || "unknown",
  };
}
