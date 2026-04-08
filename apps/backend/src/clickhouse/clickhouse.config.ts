export interface IClickhouseConfig {
  url: string | undefined;
  database: string;
  batchSize: number;
  flushIntervalMs: number;
  probeLocation: string;
}

export function loadClickhouseConfig(): IClickhouseConfig {
  return {
    url: process.env.CLICKHOUSE_URL || undefined,
    database: process.env.CLICKHOUSE_DATABASE || "dealbot",
    batchSize: Number.parseInt(process.env.CLICKHOUSE_BATCH_SIZE || "500", 10),
    flushIntervalMs: Number.parseInt(process.env.CLICKHOUSE_FLUSH_INTERVAL_MS || "5000", 10),
    probeLocation: process.env.DEALBOT_PROBE_LOCATION || "unknown",
  };
}
