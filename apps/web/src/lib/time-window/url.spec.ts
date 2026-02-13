import { describe, expect, it } from "vitest";
import {
  formatCustomDateRange,
  getPresetLabel,
  getTimeWindowLabel,
  parseTimeWindowFromURL,
  serializeTimeWindowToURL,
} from "./url";
import { PRESET_OPTIONS } from "./constants";

describe("parseTimeWindowFromURL", () => {
  it("should parse a valid preset param", () => {
    const params = new URLSearchParams({ preset: "7d" });
    const result = parseTimeWindowFromURL(params);
    expect(result.preset).toBe("7d");
    expect(result.range.to).toBeUndefined();
  });

  it("should parse all valid preset values", () => {
    const presets = PRESET_OPTIONS.map((p) => p.value);
    for (const preset of presets) {
      const result = parseTimeWindowFromURL(new URLSearchParams({ preset }));
      expect(result.preset).toBe(preset);
    }
  });

  it("should reject invalid preset and fall back to default", () => {
    const params = new URLSearchParams({ preset: "invalid" });
    const result = parseTimeWindowFromURL(params);
    expect(result.preset).toBe("7d");
  });

  it("should parse a valid date range", () => {
    const from = "2025-01-01T00:00:00.000Z";
    const to = "2025-01-31T00:00:00.000Z";
    const params = new URLSearchParams({ from, to });
    const result = parseTimeWindowFromURL(params);
    expect(result.preset).toBeUndefined();
    expect(result.range.from?.toISOString()).toBe(from);
    expect(result.range.to?.toISOString()).toBe(to);
  });

  it("should reject date range where from > to", () => {
    const params = new URLSearchParams({
      from: "2025-02-01T00:00:00.000Z",
      to: "2025-01-01T00:00:00.000Z",
    });
    const result = parseTimeWindowFromURL(params);
    expect(result.preset).toBe("7d");
  });

  it("should reject invalid date strings", () => {
    const params = new URLSearchParams({ from: "not-a-date", to: "also-not-a-date" });
    const result = parseTimeWindowFromURL(params);
    expect(result.preset).toBe("7d");
  });

  it("should fall back to default when no params provided", () => {
    const result = parseTimeWindowFromURL(new URLSearchParams());
    expect(result.preset).toBe("7d");
    expect(result.range.to).toBeUndefined();
  });

  it("should prefer preset over date range when both present", () => {
    const params = new URLSearchParams({
      preset: "30d",
      from: "2025-01-01T00:00:00.000Z",
      to: "2025-01-31T00:00:00.000Z",
    });
    const result = parseTimeWindowFromURL(params);
    expect(result.preset).toBe("30d");
  });
});

describe("serializeTimeWindowToURL", () => {
  it("should serialize a preset time window", () => {
    const params = serializeTimeWindowToURL({
      range: { from: new Date(), to: undefined },
      preset: "7d",
    });
    expect(params.get("preset")).toBe("7d");
    expect(params.has("from")).toBe(false);
    expect(params.has("to")).toBe(false);
  });

  it("should serialize a date range time window", () => {
    const from = new Date("2025-01-01T00:00:00.000Z");
    const to = new Date("2025-01-31T00:00:00.000Z");
    const params = serializeTimeWindowToURL({ range: { from, to }, preset: undefined });
    expect(params.get("from")).toBe(from.toISOString());
    expect(params.get("to")).toBe(to.toISOString());
    expect(params.has("preset")).toBe(false);
  });

  it("should return empty params when no preset and incomplete range", () => {
    const params = serializeTimeWindowToURL({
      range: { from: new Date(), to: undefined },
      preset: undefined,
    });
    expect(params.toString()).toBe("");
  });

  it("should prefer preset over date range", () => {
    const params = serializeTimeWindowToURL({
      range: { from: new Date("2025-01-01"), to: new Date("2025-01-31") },
      preset: "7d",
    });
    expect(params.get("preset")).toBe("7d");
    expect(params.has("from")).toBe(false);
  });
});

describe("getPresetLabel", () => {
  it("should return correct labels for all presets", () => {
    expect(getPresetLabel("1h")).toBe("Last Hour");
    expect(getPresetLabel("7d")).toBe("Last 7 Days");
    expect(getPresetLabel("30d")).toBe("Last 30 Days");
    expect(getPresetLabel("all")).toBe("All Time");
  });
});

describe("formatCustomDateRange", () => {
  it("should format a date range", () => {
    const from = new Date("2025-01-01T00:00:00.000Z");
    const to = new Date("2025-01-31T00:00:00.000Z");
    const result = formatCustomDateRange(from, to);
    expect(result).toMatch(/Jan\s+1,\s+2025/);
    expect(result).toMatch(/Jan\s+31,\s+2025/);
    expect(result).toContain(" - ");
  });

  it("should return empty string when from is undefined", () => {
    expect(formatCustomDateRange(undefined, new Date())).toBe("");
  });

  it("should return empty string when to is undefined", () => {
    expect(formatCustomDateRange(new Date(), undefined)).toBe("");
  });

  it("should return empty string when both are undefined", () => {
    expect(formatCustomDateRange(undefined, undefined)).toBe("");
  });
});

describe("getTimeWindowLabel", () => {
  it("should return preset label when preset is set", () => {
    const result = getTimeWindowLabel({
      range: { from: new Date(), to: undefined },
      preset: "7d",
    });
    expect(result).toBe("Last 7 Days");
  });

  it("should return formatted date range when no preset", () => {
    const from = new Date("2025-01-01T00:00:00.000Z");
    const to = new Date("2025-01-31T00:00:00.000Z");
    const result = getTimeWindowLabel({ range: { from, to }, preset: undefined });
    expect(result).toContain(" - ");
  });

  it("should return empty string when no preset and incomplete range", () => {
    const result = getTimeWindowLabel({
      range: { from: new Date(), to: undefined },
      preset: undefined,
    });
    expect(result).toBe("");
  });
});
