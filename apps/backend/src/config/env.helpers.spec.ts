import { describe, expect, it } from "vitest";
import { coerceBoolean, coerceFloat, coerceNumber } from "./env.helpers.js";

describe("coerceBoolean", () => {
  it("returns the fallback when the value is absent", () => {
    expect(coerceBoolean(undefined, true)).toBe(true);
    expect(coerceBoolean(undefined, false)).toBe(false);
  });

  it("parses case-insensitive true/false", () => {
    expect(coerceBoolean("true", false)).toBe(true);
    expect(coerceBoolean("TRUE", false)).toBe(true);
    expect(coerceBoolean("False", true)).toBe(false);
    expect(coerceBoolean(" false ", true)).toBe(false);
  });

  it("does NOT treat 0/no/off as true (the old footgun)", () => {
    // Old behaviour returned `value !== "false"`, so these were all true.
    expect(coerceBoolean("0", true)).toBe(true); // unrecognised -> fallback, not forced true
    expect(coerceBoolean("0", false)).toBe(false);
    expect(coerceBoolean("no", false)).toBe(false);
  });
});

describe("coerceNumber / coerceFloat", () => {
  it("parses numeric strings and floats", () => {
    expect(coerceNumber("42", 0)).toBe(42);
    expect(coerceFloat("0.25", 0)).toBe(0.25);
  });

  it("returns the fallback for empty/absent values", () => {
    expect(coerceNumber(undefined, 7)).toBe(7);
    expect(coerceNumber("", 7)).toBe(7);
    expect(coerceFloat(undefined, 1.5)).toBe(1.5);
  });
});
