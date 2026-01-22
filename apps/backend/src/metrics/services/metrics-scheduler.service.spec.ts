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
});
