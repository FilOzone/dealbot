import type { ConfigService } from "@nestjs/config";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../../config/app.config.js";
import { MetricsSchedulerService } from "./metrics-scheduler.service.js";

describe("MetricsSchedulerService scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("applies metrics start offsets on fresh DBs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const dataSource = {
      query: vi.fn().mockResolvedValue([{ last_created: null, last_refreshed: null }]),
    } as unknown as DataSource;
    const configService = {
      get: vi.fn(() => ({ metricsStartOffsetSeconds: 120 })),
    } as unknown as ConfigService<IConfig, true>;

    const service = new MetricsSchedulerService(dataSource, configService);
    await (service as unknown as { setupMetricsSchedules: () => Promise<void> }).setupMetricsSchedules();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toEqual([120000, 420000, 720000]);
  });

  it("anchors the next run to the last DB timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const dataSource = {} as DataSource;
    const configService = {
      get: vi.fn(),
    } as unknown as ConfigService<IConfig, true>;
    const service = new MetricsSchedulerService(dataSource, configService);

    await (service as unknown as { scheduleInitialRun: (args: unknown) => Promise<void> }).scheduleInitialRun({
      jobName: "aggregate-daily-metrics",
      intervalSeconds: 1800,
      startOffsetSeconds: 120,
      getLastRunAt: async () => new Date("2024-01-01T00:10:00Z"),
      run: async () => {},
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delayMs = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delayMs).toBe(35 * 60 * 1000);
  });

  it("returns null when no daily metrics rows exist", async () => {
    const dataSource = {
      query: vi.fn().mockResolvedValue([{ last_created: null }]),
    } as unknown as DataSource;
    const configService = { get: vi.fn() } as unknown as ConfigService<IConfig, true>;
    const service = new MetricsSchedulerService(dataSource, configService);

    const result = await (service as unknown as { getLastDailyCreatedTime: () => Promise<Date | null> }).getLastDailyCreatedTime();

    expect(result).toBeNull();
  });

  it("returns the most recent daily metrics timestamp", async () => {
    const lastCreated = "2024-01-01T00:00:00.000Z";
    const dataSource = {
      query: vi.fn().mockResolvedValue([{ last_created: lastCreated }]),
    } as unknown as DataSource;
    const configService = { get: vi.fn() } as unknown as ConfigService<IConfig, true>;
    const service = new MetricsSchedulerService(dataSource, configService);

    const result = await (service as unknown as { getLastDailyCreatedTime: () => Promise<Date | null> }).getLastDailyCreatedTime();

    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe(lastCreated);
  });

  it("returns the most recent refresh timestamp for weekly and all-time views", async () => {
    const lastWeek = new Date("2024-01-01T00:00:00.000Z");
    const allTime = "2024-01-02T00:00:00.000Z";
    const dataSource = {
      query: vi
        .fn()
        .mockResolvedValueOnce([{ last_refreshed: lastWeek }])
        .mockResolvedValueOnce([{ last_refreshed: allTime }]),
    } as unknown as DataSource;
    const configService = { get: vi.fn() } as unknown as ConfigService<IConfig, true>;
    const service = new MetricsSchedulerService(dataSource, configService);

    const weekly = await (service as unknown as { getLastWeekRefreshTime: () => Promise<Date | null> }).getLastWeekRefreshTime();
    const allTimeResult = await (
      service as unknown as { getLastAllTimeRefreshTime: () => Promise<Date | null> }
    ).getLastAllTimeRefreshTime();

    expect(weekly).toBeInstanceOf(Date);
    expect(weekly?.getTime()).toBe(lastWeek.getTime());
    expect(allTimeResult).toBeInstanceOf(Date);
    expect(allTimeResult?.toISOString()).toBe(allTime);
  });

  it("parses timestamps from Date, string, and null", () => {
    const dataSource = {} as DataSource;
    const configService = { get: vi.fn() } as unknown as ConfigService<IConfig, true>;
    const service = new MetricsSchedulerService(dataSource, configService);

    const parseTimestamp = (service as unknown as { parseTimestamp: (value: unknown) => Date | null }).parseTimestamp;
    const dateValue = new Date("2024-01-01T00:00:00.000Z");

    expect(parseTimestamp(dateValue)?.getTime()).toBe(dateValue.getTime());
    expect(parseTimestamp("2024-01-01T00:00:00.000Z")?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(parseTimestamp(null)).toBeNull();
  });

  it("propagates database errors for metrics timestamps", async () => {
    const dataSource = {
      query: vi.fn().mockRejectedValue(new Error("DB failure")),
    } as unknown as DataSource;
    const configService = { get: vi.fn() } as unknown as ConfigService<IConfig, true>;
    const service = new MetricsSchedulerService(dataSource, configService);

    await expect(
      (service as unknown as { getLastDailyCreatedTime: () => Promise<Date | null> }).getLastDailyCreatedTime(),
    ).rejects.toThrow("DB failure");
  });
});
