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
  query: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface ServiceOptions {
  activeNetworks?: Network[];
  urls?: Partial<Record<Network, string>>;
  missingNetworkTables?: Partial<Record<Network, string[]>>;
  appliedMigrationVersions?: Partial<Record<Network, number[]>>;
  databaseEngines?: Partial<Record<Network, string>>;
  commandFailures?: Partial<Record<Network, { match: string; error: Error }>>;
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
  const appliedVersionsByUrl = new Map<string, Set<number>>();

  for (const network of activeNetworks) {
    const url = urls[network];
    if (!url) continue;
    const appliedVersions = appliedVersionsByUrl.get(url) ?? new Set(options.appliedMigrationVersions?.[network] ?? []);
    appliedVersionsByUrl.set(url, appliedVersions);

    const client: ClientMock = {
      query: vi.fn().mockImplementation(({ query }: { query: string }) => {
        let rows: Array<Record<string, string | number>>;
        if (query.includes("system.columns")) {
          rows = (options.missingNetworkTables?.[network] ?? []).map((name) => ({ name }));
        } else if (query.includes("system.databases")) {
          rows = [{ engine: options.databaseEngines?.[network] ?? "Atomic" }];
        } else {
          rows = Array.from(appliedVersions, (version) => ({ version }));
        }
        return Promise.resolve({
          json: vi.fn().mockResolvedValue(rows),
        });
      }),
      command: vi.fn().mockImplementation(({ query, query_params }: { query: string; query_params?: unknown }) => {
        const failure = options.commandFailures?.[network];
        if (failure && query.includes(failure.match)) return Promise.reject(failure.error);
        if (query.includes(".schema_migrations (version, name)")) {
          appliedVersions.add((query_params as { version: number }).version);
        }
        return Promise.resolve(undefined);
      }),
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

    service.insert("data_storage_checks", { timestamp: 1, network: "calibration" });
    service.insert("data_storage_checks", { timestamp: 2, network: "mainnet" });
    await service.onApplicationShutdown();

    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(clients.get("calibration")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [{ timestamp: 1, network: "calibration" }],
      format: "JSONEachRow",
    });
    expect(clients.get("mainnet")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [{ timestamp: 2, network: "mainnet" }],
      format: "JSONEachRow",
    });
    expect(rowsInserted.inc).toHaveBeenCalledWith({ table: "data_storage_checks", network: "calibration" }, 1);
    expect(rowsInserted.inc).toHaveBeenCalledWith({ table: "data_storage_checks", network: "mainnet" }, 1);
    expect(bufferRows.set).toHaveBeenCalledWith({ network: "calibration" }, 0);
    expect(bufferRows.set).toHaveBeenCalledWith({ network: "mainnet" }, 0);
    expect(flushDuration.startTimer).toHaveBeenCalledWith({ network: "calibration" });
    expect(flushDuration.startTimer).toHaveBeenCalledWith({ network: "mainnet" });
  });

  it("uses each URL's network as the migration backfill value", async () => {
    const { clients, service } = createService({
      missingNetworkTables: {
        calibration: ["data_storage_checks"],
        mainnet: ["retrieval_checks"],
      },
    });

    await service.onModuleInit();
    await service.onApplicationShutdown();

    expect(clients.get("calibration")?.command).toHaveBeenCalledWith({
      query: expect.stringContaining(
        "ADD COLUMN IF NOT EXISTS network LowCardinality(String) DEFAULT 'calibration' AFTER timestamp",
      ),
    });
    expect(clients.get("mainnet")?.command).toHaveBeenCalledWith({
      query: expect.stringContaining(
        "ADD COLUMN IF NOT EXISTS network LowCardinality(String) DEFAULT 'mainnet' AFTER timestamp",
      ),
    });
  });

  it("skips versioned migrations that are already applied", async () => {
    const { clients, service } = createService({
      activeNetworks: ["calibration"],
      appliedMigrationVersions: { calibration: [1] },
    });

    await service.onModuleInit();
    await service.onApplicationShutdown();

    expect(clients.get("calibration")?.command).not.toHaveBeenCalledWith({
      query: expect.stringContaining("EXCHANGE TABLES"),
    });
  });

  it("applies a shared database migration only once", async () => {
    const sharedUrl = "http://default:password@clickhouse.internal:8123/dealbot_shared";
    const { clients, service } = createService({
      urls: { calibration: sharedUrl, mainnet: sharedUrl },
    });

    await service.onModuleInit();
    await service.onApplicationShutdown();

    expect(clients.get("calibration")?.command).toHaveBeenCalledWith({
      query: expect.stringContaining("EXCHANGE TABLES"),
    });
    expect(clients.get("mainnet")?.command).not.toHaveBeenCalledWith({
      query: expect.stringContaining("EXCHANGE TABLES"),
    });
  });

  it("closes every client when a later network migration fails", async () => {
    const { clients, service } = createService({
      commandFailures: {
        mainnet: {
          match: "schema_migrations",
          error: new Error("mainnet migration failed"),
        },
      },
    });

    await expect(service.onModuleInit()).rejects.toThrow("mainnet migration failed");

    expect(clients.get("calibration")?.close).toHaveBeenCalledOnce();
    expect(clients.get("mainnet")?.close).toHaveBeenCalledOnce();
  });

  it("releases the migration lock when a table rebuild fails", async () => {
    const { clients, service } = createService({
      activeNetworks: ["calibration"],
      commandFailures: {
        calibration: {
          match: "EXCHANGE TABLES",
          error: new Error("table exchange failed"),
        },
      },
    });

    await expect(service.onModuleInit()).rejects.toThrow("table exchange failed");

    expect(clients.get("calibration")?.command).toHaveBeenCalledWith({
      query: "DROP TABLE IF EXISTS dealbot_calibration.schema_migration_lock SYNC",
    });
  });

  it("rejects table rebuilds on database engines without atomic exchange support", async () => {
    const { clients, service } = createService({
      activeNetworks: ["calibration"],
      databaseEngines: { calibration: "Ordinary" },
    });

    await expect(service.onModuleInit()).rejects.toThrow(
      "ClickHouse database dealbot_calibration must use the Atomic or Shared engine",
    );

    expect(clients.get("calibration")?.command).not.toHaveBeenCalledWith({
      query: expect.stringContaining("INSERT INTO dealbot_calibration.__dealbot_migration"),
    });
    expect(clients.get("calibration")?.command).toHaveBeenCalledWith({
      query: "DROP TABLE IF EXISTS dealbot_calibration.schema_migration_lock SYNC",
    });
  });

  it("applies the shared batch size independently to each network buffer", async () => {
    const { clients, service } = createService({ batchSize: 2 });
    await service.onModuleInit();

    service.insert("data_storage_checks", { timestamp: 1, network: "calibration" });
    service.insert("data_storage_checks", { timestamp: 2, network: "mainnet" });

    expect(clients.get("calibration")?.insert).not.toHaveBeenCalled();
    expect(clients.get("mainnet")?.insert).not.toHaveBeenCalled();

    service.insert("data_storage_checks", { timestamp: 3, network: "calibration" });

    expect(clients.get("calibration")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [
        { timestamp: 1, network: "calibration" },
        { timestamp: 3, network: "calibration" },
      ],
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

    service.insert("data_storage_checks", { timestamp: 1, network: "calibration" });
    service.insert("data_storage_checks", { timestamp: 2, network: "mainnet" });
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
    service.insert("data_storage_checks", { timestamp: 1, network: "calibration" });
    service.insert("data_storage_checks", { timestamp: 2, network: "calibration" });

    const shutdown = service.onApplicationShutdown();
    finishFirstInsert();
    await shutdown;

    expect(client.insert).toHaveBeenCalledTimes(2);
    expect(client.insert).toHaveBeenNthCalledWith(1, {
      table: "data_storage_checks",
      values: [{ timestamp: 1, network: "calibration" }],
      format: "JSONEachRow",
    });
    expect(client.insert).toHaveBeenNthCalledWith(2, {
      table: "data_storage_checks",
      values: [{ timestamp: 2, network: "calibration" }],
      format: "JSONEachRow",
    });
  });

  it("applies the shared maximum independently and drops from only the full network buffer", async () => {
    const { clients, droppedRows, service } = createService({ batchSize: 500, maxBufferSize: 2 });
    await service.onModuleInit();

    service.insert("data_storage_checks", { timestamp: 1, network: "calibration" });
    service.insert("data_storage_checks", { timestamp: 2, network: "calibration" });
    service.insert("data_storage_checks", { timestamp: 3, network: "calibration" });
    service.insert("data_storage_checks", { timestamp: 4, network: "mainnet" });
    await service.onApplicationShutdown();

    expect(droppedRows.inc).toHaveBeenCalledOnce();
    expect(droppedRows.inc).toHaveBeenCalledWith({ reason: "buffer_full", network: "calibration" });
    expect(clients.get("calibration")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [
        { timestamp: 2, network: "calibration" },
        { timestamp: 3, network: "calibration" },
      ],
      format: "JSONEachRow",
    });
    expect(clients.get("mainnet")?.insert).toHaveBeenCalledWith({
      table: "data_storage_checks",
      values: [{ timestamp: 4, network: "mainnet" }],
      format: "JSONEachRow",
    });
  });

  it("disables writes only for networks without a ClickHouse URL", async () => {
    const { clients, service } = createService({
      urls: { calibration: DEFAULT_URLS.calibration },
    });
    await service.onModuleInit();

    service.insert("data_storage_checks", { timestamp: 1, network: "calibration" });
    service.insert("data_storage_checks", { timestamp: 2, network: "mainnet" });
    await service.onApplicationShutdown();

    expect(createClientMock).toHaveBeenCalledOnce();
    expect(clients.get("calibration")?.insert).toHaveBeenCalledOnce();
  });
});
