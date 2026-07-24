import type { ClickHouseClient } from "@clickhouse/client";
import type { ConfigService } from "@nestjs/config";
import type { Counter, Gauge, Histogram } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/index.js";
import { ClickhouseService } from "./clickhouse.service.js";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@clickhouse/client", () => ({
  createClient: createClientMock,
}));

interface ClientMock {
  query: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const originalBackfillNetwork = process.env.DEALBOT_LEGACY_NETWORK_BACKFILL;
const originalNetwork = process.env.NETWORK;

function createService(missingNetworkTables: string[] = []) {
  const client: ClientMock = {
    query: vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(missingNetworkTables.map((name) => ({ name }))),
    }),
    command: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  createClientMock.mockReturnValue(client as unknown as ClickHouseClient);

  const flushEnd = vi.fn();
  const flushDuration = {
    startTimer: vi.fn().mockReturnValue(flushEnd),
  } as unknown as Histogram;
  const flushErrors = { inc: vi.fn() } as unknown as Counter;
  const bufferRows = { set: vi.fn() } as unknown as Gauge;
  const rowsInserted = { inc: vi.fn() } as unknown as Counter;
  const droppedRows = { inc: vi.fn() } as unknown as Counter;
  const configService = {
    get: vi.fn((key: keyof IConfig) => {
      if (key === "clickhouse") {
        return {
          url: "http://default:password@clickhouse.internal:8123/dealbot",
          batchSize: 500,
          flushIntervalMs: 5000,
          maxBufferSize: 5000,
        };
      }
      if (key === "app") return { probeLocation: "test" };
      return undefined;
    }),
  } as unknown as ConfigService<IConfig, true>;

  return {
    client,
    rowsInserted,
    service: new ClickhouseService(flushDuration, flushErrors, bufferRows, rowsInserted, droppedRows, configService),
  };
}

describe("ClickhouseService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createClientMock.mockReset();
    delete process.env.DEALBOT_LEGACY_NETWORK_BACKFILL;
    delete process.env.NETWORK;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalBackfillNetwork === undefined) delete process.env.DEALBOT_LEGACY_NETWORK_BACKFILL;
    else process.env.DEALBOT_LEGACY_NETWORK_BACKFILL = originalBackfillNetwork;
    if (originalNetwork === undefined) delete process.env.NETWORK;
    else process.env.NETWORK = originalNetwork;
  });

  it("uses one client for rows from every active network", async () => {
    const { client, rowsInserted, service } = createService();
    await service.onModuleInit();

    service.insert("data_storage_checks", { timestamp: 1, network: "calibration" });
    service.insert("data_storage_checks", { timestamp: 2, network: "mainnet" });
    await service.onApplicationShutdown();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(client.insert).toHaveBeenCalledOnce();
    expect(client.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [
        { timestamp: 1, network: "calibration" },
        { timestamp: 2, network: "mainnet" },
      ],
      format: "JSONEachRow",
    });
    expect(rowsInserted.inc).toHaveBeenCalledWith({ table: "data_storage_checks", network: "calibration" }, 1);
    expect(rowsInserted.inc).toHaveBeenCalledWith({ table: "data_storage_checks", network: "mainnet" }, 1);
  });

  it("backfills legacy tables with the operator-declared network", async () => {
    process.env.DEALBOT_LEGACY_NETWORK_BACKFILL = "mainnet";
    const { client, service } = createService(["data_storage_checks"]);

    await service.onModuleInit();
    await service.onApplicationShutdown();

    expect(client.command).toHaveBeenCalledWith({
      query: expect.stringContaining(
        "ADD COLUMN IF NOT EXISTS network LowCardinality(String) DEFAULT 'mainnet' AFTER timestamp",
      ),
    });
  });

  it("normalizes a case-variant legacy NETWORK before backfilling", async () => {
    process.env.NETWORK = "MAINNET";
    const { client, service } = createService(["data_storage_checks"]);

    await service.onModuleInit();
    await service.onApplicationShutdown();

    expect(client.command).toHaveBeenCalledWith({
      query: expect.stringContaining(
        "ADD COLUMN IF NOT EXISTS network LowCardinality(String) DEFAULT 'mainnet' AFTER timestamp",
      ),
    });
  });

  it("fails fast when legacy tables need a network and none is declared", async () => {
    const { client, service } = createService(["retrieval_checks"]);

    await expect(service.onModuleInit()).rejects.toThrow(
      /ClickHouse network migration requires DEALBOT_LEGACY_NETWORK_BACKFILL/,
    );
    expect(client.command).not.toHaveBeenCalled();
    await service.onApplicationShutdown();
  });
});
