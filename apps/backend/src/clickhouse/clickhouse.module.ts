import { Global, Module } from "@nestjs/common";
import { makeCounterProvider, makeGaugeProvider, makeHistogramProvider } from "@willsoto/nestjs-prometheus";
import { ClickhouseService } from "./clickhouse.service.js";

@Global()
@Module({
  providers: [
    makeHistogramProvider({
      name: "clickhouseFlushDurationSeconds",
      help: "Round-trip time of each ClickHouse flush call in seconds",
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    makeCounterProvider({
      name: "clickhouseFlushErrorsTotal",
      help: "Number of failed ClickHouse flush attempts; non-zero means rows were dropped",
    }),
    makeCounterProvider({
      name: "clickhouseDroppedRowsTotal",
      help: "Rows silently dropped due to flush failure or buffer overflow, by reason",
      labelNames: ["reason"] as const,
    }),
    makeGaugeProvider({
      name: "clickhouseBufferRows",
      help: "Current number of rows queued in the ClickHouse buffer",
    }),
    makeCounterProvider({
      name: "clickhouseRowsInsertedTotal",
      help: "Rows successfully written to ClickHouse, by table",
      labelNames: ["table"] as const,
    }),
    ClickhouseService,
  ],
  exports: [ClickhouseService],
})
export class ClickhouseModule {}
