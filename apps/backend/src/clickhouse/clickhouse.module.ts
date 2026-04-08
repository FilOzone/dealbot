import { Global, Module } from "@nestjs/common";
import { makeCounterProvider, makeGaugeProvider, makeHistogramProvider } from "@willsoto/nestjs-prometheus";
import { ClickhouseService } from "./clickhouse.service.js";

@Global()
@Module({
  providers: [
    makeHistogramProvider({
      name: "clickhouseFlushDurationMs",
      help: "Round-trip time of each ClickHouse flush call in milliseconds",
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    }),
    makeCounterProvider({
      name: "clickhouseFlushErrorsTotal",
      help: "Number of failed ClickHouse flush attempts; non-zero means rows were dropped",
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
