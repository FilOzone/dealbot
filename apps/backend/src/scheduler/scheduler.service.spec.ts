import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import type { DealService } from "../deal/deal.service.js";
import type { RetrievalService } from "../retrieval/retrieval.service.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { SchedulerService } from "./scheduler.service.js";

describe("SchedulerService scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createService = () =>
    new SchedulerService(
      {} as DealService,
      {} as RetrievalService,
      { get: vi.fn() } as unknown as ConfigService<IConfig, true>,
      {} as WalletSdkService,
    );

  it("uses the startup offset when no rows exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const service = createService();
    await (service as unknown as { scheduleInitialRun: (args: unknown) => Promise<void> }).scheduleInitialRun({
      jobName: "dealCreation",
      intervalSeconds: 600,
      startOffsetSeconds: 120,
      getLastCreated: async () => null,
      run: async () => {},
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delayMs = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delayMs).toBe(120 * 1000);
  });

  it("uses last created time when rows exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const service = createService();
    await (service as unknown as { scheduleInitialRun: (args: unknown) => Promise<void> }).scheduleInitialRun({
      jobName: "dealCreation",
      intervalSeconds: 600,
      startOffsetSeconds: 120,
      getLastCreated: async () => new Date("2024-01-01T00:10:00Z"),
      run: async () => {},
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delayMs = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delayMs).toBe(15 * 60 * 1000);
  });

  it("re-schedules based on newly created rows during execution", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const service = createService();
    const run = vi.fn().mockResolvedValue(undefined);
    const getLastCreated = vi.fn().mockResolvedValue(new Date("2024-01-01T00:05:00Z"));

    await (service as unknown as { executeScheduledJob: (args: unknown) => Promise<void> }).executeScheduledJob({
      jobName: "dealCreation",
      intervalSeconds: 600,
      getLastCreated,
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delayMs = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delayMs).toBe(15 * 60 * 1000);
  });

  it("falls back to run completion time when no new rows were created", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const service = createService();
    const run = vi.fn().mockResolvedValue(undefined);
    const getLastCreated = vi.fn().mockResolvedValue(null);

    await (service as unknown as { executeScheduledJob: (args: unknown) => Promise<void> }).executeScheduledJob({
      jobName: "dealCreation",
      intervalSeconds: 600,
      getLastCreated,
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delayMs = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delayMs).toBe(10 * 60 * 1000);
  });
});
