import type { ClickHouseClient } from "@clickhouse/client";
import type { ConfigService } from "@nestjs/config";
import type { Counter, Gauge, Histogram } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Network } from "../common/types.js";
import type { IConfig } from "../config/index.js";
import { ClickhouseService } from "./clickhouse.service.js";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@clickhouse/client", () => ({
  createClient: createClientMock,
}));

interface ClientMock {
  command: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface ServiceOptions {
  activeNetworks?: Network[];
  urls?: Partial<Record<Network, string>>;
  insertFailures?: Partial<Record<Network, Error>>;
  batchSize?: number;
  maxBufferSize?: number;
}

const DEFAULT_URLS: Record<Network, string> = {
  calibration: "http://default:password@clickhouse.internal:8123/dealbot_calibration",
  mainnet: "http://default:password@clickhouse.internal:8123/dealbot_mainnet",
};

function createService(options: ServiceOptions = {}) {
  const activeNetworks = options.activeNetworks ?? ["calibration", "mainnet"];
  const urls = options.urls ?? DEFAULT_URLS;
  const clients = new Map<Network, ClientMock>();
  const clientsByUrl = new Map<string, ClientMock[]>();

  for (const network of activeNetworks) {
    const url = urls[network];
    if (!url) continue;

    const client: ClientMock = {
      command: vi.fn().mockResolvedValue(undefined),
      insert: options.insertFailures?.[network]
        ? vi.fn().mockRejectedValue(options.insertFailures[network])
        : vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    clients.set(network, client);
    const urlClients = clientsByUrl.get(url) ?? [];
    urlClients.push(client);
    clientsByUrl.set(url, urlClients);
  }

  createClientMock.mockImplementation(({ url }: { url: string }) => {
    const client = clientsByUrl.get(url)?.shift();
    if (!client) throw new Error(`Unexpected ClickHouse URL: ${url}`);
    return client as unknown as ClickHouseClient;
  });

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
          batchSize: options.batchSize ?? 500,
          flushIntervalMs: 5000,
          maxBufferSize: options.maxBufferSize ?? 5000,
        };
      }
      if (key === "networks") {
        return {
          calibration: { clickhouseUrl: urls.calibration },
          mainnet: { clickhouseUrl: urls.mainnet },
        };
      }
      if (key === "activeNetworks") return activeNetworks;
      if (key === "app") return { probeLocation: "test" };
      return undefined;
    }),
  } as unknown as ConfigService<IConfig, true>;

  return {
    bufferRows,
    clients,
    droppedRows,
    flushDuration,
    flushErrors,
    rowsInserted,
    service: new ClickhouseService(flushDuration, flushErrors, bufferRows, rowsInserted, droppedRows, configService),
  };
}

describe("ClickhouseService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createClientMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes each row to its network-specific ClickHouse destination", async () => {
    const { bufferRows, clients, flushDuration, rowsInserted, service } = createService();
    await service.onModuleInit();

    service.insert("calibration", "data_storage_checks", { timestamp: 1 });
    service.insert("mainnet", "data_storage_checks", { timestamp: 2 });
    await service.onApplicationShutdown();

    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(clients.get("calibration")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [{ timestamp: 1 }],
      format: "JSONEachRow",
    });
    expect(clients.get("mainnet")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [{ timestamp: 2 }],
      format: "JSONEachRow",
    });
    expect(rowsInserted.inc).toHaveBeenCalledWith({ table: "data_storage_checks", network: "calibration" }, 1);
    expect(rowsInserted.inc).toHaveBeenCalledWith({ table: "data_storage_checks", network: "mainnet" }, 1);
    expect(bufferRows.set).toHaveBeenCalledWith({ network: "calibration" }, 0);
    expect(bufferRows.set).toHaveBeenCalledWith({ network: "mainnet" }, 0);
    expect(flushDuration.startTimer).toHaveBeenCalledWith({ network: "calibration" });
    expect(flushDuration.startTimer).toHaveBeenCalledWith({ network: "mainnet" });
  });

  it("rejects two networks targeting the same ClickHouse database", async () => {
    const { service } = createService({
      urls: {
        calibration: "http://calibration:password@clickhouse.internal:8123/dealbot_shared",
        mainnet: "http://mainnet:password@clickhouse.internal:8123/dealbot_shared",
      },
    });

    await expect(service.onModuleInit()).rejects.toThrow(
      "CALIBRATION_CLICKHOUSE_URL and MAINNET_CLICKHOUSE_URL must use different ClickHouse databases",
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("applies the shared batch size independently to each network buffer", async () => {
    const { clients, service } = createService({ batchSize: 2 });
    await service.onModuleInit();

    service.insert("calibration", "data_storage_checks", { timestamp: 1 });
    service.insert("mainnet", "data_storage_checks", { timestamp: 2 });

    expect(clients.get("calibration")?.insert).not.toHaveBeenCalled();
    expect(clients.get("mainnet")?.insert).not.toHaveBeenCalled();

    service.insert("calibration", "data_storage_checks", { timestamp: 3 });

    expect(clients.get("calibration")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [{ timestamp: 1 }, { timestamp: 3 }],
      format: "JSONEachRow",
    });
    expect(clients.get("mainnet")?.insert).not.toHaveBeenCalled();

    await service.onApplicationShutdown();
  });

  it("keeps a failed network flush isolated from other networks", async () => {
    const { bufferRows, clients, flushErrors, rowsInserted, service } = createService({
      insertFailures: { calibration: new Error("calibration unavailable") },
    });
    await service.onModuleInit();

    service.insert("calibration", "data_storage_checks", { timestamp: 1 });
    service.insert("mainnet", "data_storage_checks", { timestamp: 2 });
    await service.onApplicationShutdown();

    expect(clients.get("calibration")?.insert).toHaveBeenCalledOnce();
    expect(clients.get("mainnet")?.insert).toHaveBeenCalledOnce();
    expect(flushErrors.inc).toHaveBeenCalledWith({ network: "calibration" });
    expect(rowsInserted.inc).toHaveBeenCalledWith({ table: "data_storage_checks", network: "mainnet" }, 1);
    expect(bufferRows.set).toHaveBeenCalledWith({ network: "mainnet" }, 0);
    expect(bufferRows.set).not.toHaveBeenCalledWith({ network: "calibration" }, 0);
  });

  it("drains rows queued while the same network is flushing", async () => {
    const { clients, service } = createService({
      activeNetworks: ["calibration"],
      batchSize: 1,
      maxBufferSize: 2,
    });
    const client = clients.get("calibration")!;
    let finishFirstInsert!: () => void;
    const firstInsert = new Promise<void>((resolve) => {
      finishFirstInsert = resolve;
    });
    client.insert.mockImplementationOnce(() => firstInsert).mockResolvedValue(undefined);

    await service.onModuleInit();
    service.insert("calibration", "data_storage_checks", { timestamp: 1 });
    service.insert("calibration", "data_storage_checks", { timestamp: 2 });

    const shutdown = service.onApplicationShutdown();
    finishFirstInsert();
    await shutdown;

    expect(client.insert).toHaveBeenCalledTimes(2);
    expect(client.insert).toHaveBeenNthCalledWith(1, {
      table: "data_storage_checks",
      values: [{ timestamp: 1 }],
      format: "JSONEachRow",
    });
    expect(client.insert).toHaveBeenNthCalledWith(2, {
      table: "data_storage_checks",
      values: [{ timestamp: 2 }],
      format: "JSONEachRow",
    });
  });

  it("applies the shared maximum independently and drops from only the full network buffer", async () => {
    const { clients, droppedRows, service } = createService({ batchSize: 500, maxBufferSize: 2 });
    await service.onModuleInit();

    service.insert("calibration", "data_storage_checks", { timestamp: 1 });
    service.insert("calibration", "data_storage_checks", { timestamp: 2 });
    service.insert("calibration", "data_storage_checks", { timestamp: 3 });
    service.insert("mainnet", "data_storage_checks", { timestamp: 4 });
    await service.onApplicationShutdown();

    expect(droppedRows.inc).toHaveBeenCalledOnce();
    expect(droppedRows.inc).toHaveBeenCalledWith({ reason: "buffer_full", network: "calibration" });
    expect(clients.get("calibration")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [{ timestamp: 2 }, { timestamp: 3 }],
      format: "JSONEachRow",
    });
    expect(clients.get("mainnet")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [{ timestamp: 4 }],
      format: "JSONEachRow",
    });
  });

  it("disables writes only for networks without a ClickHouse URL", async () => {
    const { clients, service } = createService({
      urls: { calibration: DEFAULT_URLS.calibration },
    });
    await service.onModuleInit();

    service.insert("calibration", "data_storage_checks", { timestamp: 1 });
    service.insert("mainnet", "data_storage_checks", { timestamp: 2 });
    await service.onApplicationShutdown();

    expect(createClientMock).toHaveBeenCalledOnce();
    expect(clients.get("calibration")?.insert).toHaveBeenCalledOnce();
  });
});
