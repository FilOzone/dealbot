import type { ConfigService } from "@nestjs/config";
import type { Gauge } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { WalletBalanceCollector } from "./wallet-balance.collector.js";

describe("WalletBalanceCollector", () => {
  let collector: WalletBalanceCollector;
  let gaugeMock: { set: ReturnType<typeof vi.fn>; collect?: () => Promise<void> };
  let walletSdkMock: { getWalletBalances: ReturnType<typeof vi.fn> };
  let configMock: { get: ReturnType<typeof vi.fn> };
  let collectFn: () => Promise<void>;

  beforeEach(() => {
    gaugeMock = { set: vi.fn() };
    walletSdkMock = {
      getWalletBalances: vi.fn(async () => ({ usdfc: 50_000_000n, fil: 1_000_000_000n })),
    };
    configMock = {
      get: vi.fn(() => ({ walletAddress: "0xABCDEF1234567890" })),
    };

    collector = new WalletBalanceCollector(
      configMock as unknown as ConfigService<IConfig, true>,
      walletSdkMock as unknown as WalletSdkService,
      gaugeMock as unknown as Gauge,
    );
    collector.onModuleInit();
    collectFn = gaugeMock.collect as () => Promise<void>;
    delete process.env.DEALBOT_DISABLE_CHAIN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DEALBOT_DISABLE_CHAIN;
  });

  it("registers a collect callback on the gauge during module init", () => {
    expect(collectFn).toBeTypeOf("function");
  });

  it("fetches balances and sets gauge values on first scrape", async () => {
    await collectFn();

    expect(walletSdkMock.getWalletBalances).toHaveBeenCalledOnce();
    expect(gaugeMock.set).toHaveBeenCalledWith({ currency: "USDFC", wallet: "0xABCDEF" }, 50_000_000);
    expect(gaugeMock.set).toHaveBeenCalledWith({ currency: "FIL", wallet: "0xABCDEF" }, 1_000_000_000);
  });

  it("returns cached values without fetching again within the TTL window", async () => {
    await collectFn();
    expect(walletSdkMock.getWalletBalances).toHaveBeenCalledOnce();

    // Second call within 1hr should not fetch again
    await collectFn();
    expect(walletSdkMock.getWalletBalances).toHaveBeenCalledOnce();
  });

  it("fetches fresh balances after the 1hr TTL expires", async () => {
    await collectFn();
    expect(walletSdkMock.getWalletBalances).toHaveBeenCalledOnce();

    // Advance past the 1hr TTL
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60 * 60 * 1000 + 1);
    await collectFn();
    expect(walletSdkMock.getWalletBalances).toHaveBeenCalledTimes(2);
  });

  it("skips chain call when DEALBOT_DISABLE_CHAIN is true", async () => {
    process.env.DEALBOT_DISABLE_CHAIN = "true";
    await collectFn();
    expect(walletSdkMock.getWalletBalances).not.toHaveBeenCalled();
    expect(gaugeMock.set).not.toHaveBeenCalled();
  });

  it("prevents concurrent fetches when multiple scrapes happen simultaneously", async () => {
    walletSdkMock.getWalletBalances.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { usdfc: 50_000_000n, fil: 1_000_000_000n };
    });

    // Fire two scrapes concurrently
    await Promise.all([collectFn(), collectFn()]);

    // Should only have fetched once due to the in-flight promise lock
    expect(walletSdkMock.getWalletBalances).toHaveBeenCalledOnce();
  });

  it("prevents endless retries by applying a 1-minute error cooldown on fetch failures", async () => {
    walletSdkMock.getWalletBalances.mockRejectedValueOnce(new Error("rpc timeout"));
    await expect(collectFn()).resolves.toBeUndefined();
    expect(gaugeMock.set).not.toHaveBeenCalled();

    walletSdkMock.getWalletBalances.mockResolvedValueOnce({ usdfc: 10n, fil: 20n });

    // Calling immediately should be blocked by cooldown
    await collectFn();
    expect(walletSdkMock.getWalletBalances).toHaveBeenCalledTimes(1);

    // Advance 61 seconds
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);

    await collectFn();
    expect(walletSdkMock.getWalletBalances).toHaveBeenCalledTimes(2);
    expect(gaugeMock.set).toHaveBeenCalledTimes(2);
  });
});
