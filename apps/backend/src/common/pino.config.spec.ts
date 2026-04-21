import { describe, expect, it } from "vitest";
import { resolvePinoLevel } from "./pino.config.js";

describe("resolvePinoLevel", () => {
  it("defaults to info when level is undefined", () => {
    expect(resolvePinoLevel(undefined)).toBe("info");
  });

  it("defaults to info when level is empty string", () => {
    expect(resolvePinoLevel("")).toBe("info");
  });

  it("maps NestJS log alias to pino info", () => {
    expect(resolvePinoLevel("log")).toBe("info");
  });

  it("maps NestJS verbose alias to pino trace", () => {
    expect(resolvePinoLevel("verbose")).toBe("trace");
  });

  it("maps info to info", () => {
    expect(resolvePinoLevel("info")).toBe("info");
  });

  it("maps debug to debug", () => {
    expect(resolvePinoLevel("debug")).toBe("debug");
  });

  it("maps warn to warn", () => {
    expect(resolvePinoLevel("warn")).toBe("warn");
  });

  it("maps error to error", () => {
    expect(resolvePinoLevel("error")).toBe("error");
  });

  it("maps fatal to fatal", () => {
    expect(resolvePinoLevel("fatal")).toBe("fatal");
  });

  it("is case-insensitive", () => {
    expect(resolvePinoLevel("INFO")).toBe("info");
    expect(resolvePinoLevel("DEBUG")).toBe("debug");
    expect(resolvePinoLevel("LOG")).toBe("info");
  });

  it("trims surrounding whitespace", () => {
    expect(resolvePinoLevel("  info  ")).toBe("info");
  });

  it("defaults to info for unknown values", () => {
    expect(resolvePinoLevel("unknown")).toBe("info");
  });
});
