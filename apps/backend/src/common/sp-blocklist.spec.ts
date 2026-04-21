import { describe, expect, it } from "vitest";
import { type ISpBlocklistConfig } from "../config/app.config.js";
import { isSpBlocked } from "./sp-blocklist.js";

const cfg = (overrides: Partial<ISpBlocklistConfig> = {}): ISpBlocklistConfig => ({
  ids: new Set(),
  addresses: new Set(),
  ...overrides,
});

describe("isSpBlocked", () => {
  it("returns false when blocklist is empty", () => {
    expect(isSpBlocked(cfg(), "0xaaa")).toBe(false);
    expect(isSpBlocked(cfg(), "0xaaa", 1n)).toBe(false);
  });

  it("blocks by address", () => {
    expect(isSpBlocked(cfg({ addresses: new Set(["0xaaa"]) }), "0xaaa")).toBe(true);
  });

  it("address matching is case-insensitive", () => {
    const c = cfg({ addresses: new Set(["0xaaa"]) });
    expect(isSpBlocked(c, "0xAAA")).toBe(true);
    expect(isSpBlocked(c, "0XAAA")).toBe(true);
  });

  it("blocks by numeric ID", () => {
    expect(isSpBlocked(cfg({ ids: new Set(["42"]) }), "0xaaa", 42n)).toBe(true);
  });

  it("skips ID check when id is undefined", () => {
    expect(isSpBlocked(cfg({ ids: new Set(["42"]) }), "0xaaa", undefined)).toBe(false);
  });

  it("does not block unrelated provider", () => {
    const c = cfg({ ids: new Set(["5"]), addresses: new Set(["0xaaa"]) });
    expect(isSpBlocked(c, "0xbbb", 6n)).toBe(false);
  });
});
