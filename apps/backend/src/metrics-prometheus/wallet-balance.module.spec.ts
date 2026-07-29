import { describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { WorkerModule } from "../worker.module.js";
import { MetricsPrometheusModule } from "./metrics-prometheus.module.js";
import { WalletBalanceCollector } from "./wallet-balance.collector.js";
import { WalletBalanceModule } from "./wallet-balance.module.js";

function moduleMetadata(module: object, key: string): unknown[] {
  return Reflect.getMetadata(key, module) ?? [];
}

describe("WalletBalanceModule", () => {
  it("owns the wallet balance collector outside the shared metrics module", () => {
    expect(moduleMetadata(WalletBalanceModule, "providers")).toContain(WalletBalanceCollector);
    expect(moduleMetadata(MetricsPrometheusModule, "providers")).not.toContain(WalletBalanceCollector);
  });

  it("is registered by the API module but not the worker module", () => {
    expect(moduleMetadata(AppModule, "imports")).toContain(WalletBalanceModule);
    expect(moduleMetadata(WorkerModule, "imports")).not.toContain(WalletBalanceModule);
  });
});
