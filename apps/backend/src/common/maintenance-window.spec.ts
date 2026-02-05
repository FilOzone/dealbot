import { describe, expect, it } from "vitest";
import { getMaintenanceWindowStatus, parseMaintenanceWindowTimes } from "./maintenance-window.js";

describe("parseMaintenanceWindowTimes", () => {
  it("parses valid HH:MM UTC windows", () => {
    const parsed = parseMaintenanceWindowTimes(["07:00", "22:00"]);
    expect(parsed).toEqual([
      { startMinutes: 420, label: "07:00" },
      { startMinutes: 1320, label: "22:00" },
    ]);
  });

  it("throws on invalid time strings", () => {
    expect(() => parseMaintenanceWindowTimes(["7:00"])).toThrow(/Invalid maintenance window/);
    expect(() => parseMaintenanceWindowTimes(["24:00"])).toThrow(/Invalid maintenance window/);
    expect(() => parseMaintenanceWindowTimes(["07:60"])).toThrow(/Invalid maintenance window/);
  });

  it("ignores empty strings while parsing valid times", () => {
    const parsed = parseMaintenanceWindowTimes(["", "  ", "07:00", "22:10"]);
    expect(parsed).toEqual([
      { startMinutes: 420, label: "07:00" },
      { startMinutes: 1330, label: "22:10" },
    ]);
  });

  it("throws when any entry is invalid even with valid times", () => {
    expect(() => parseMaintenanceWindowTimes(["07:00", "", "bad"])).toThrow(/Invalid maintenance window/);
  });
});

describe("getMaintenanceWindowStatus", () => {
  it("returns active when inside window", () => {
    const now = new Date(Date.UTC(2026, 0, 1, 7, 5, 0));
    const status = getMaintenanceWindowStatus(now, ["07:00"], 20);
    expect(status.active).toBe(true);
    expect(status.window?.label).toBe("07:00");
  });

  it("returns inactive when outside window", () => {
    const now = new Date(Date.UTC(2026, 0, 1, 7, 30, 0));
    const status = getMaintenanceWindowStatus(now, ["07:00"], 20);
    expect(status.active).toBe(false);
  });

  it("handles windows that wrap midnight", () => {
    const now = new Date(Date.UTC(2026, 0, 1, 0, 5, 0));
    const status = getMaintenanceWindowStatus(now, ["23:50"], 20);
    expect(status.active).toBe(true);
  });

  it("returns inactive at the exact window end boundary", () => {
    const now = new Date(Date.UTC(2026, 0, 1, 7, 20, 0));
    const status = getMaintenanceWindowStatus(now, ["07:00"], 20);
    expect(status.active).toBe(false);
  });

  it("returns the first matching window when windows overlap", () => {
    const now = new Date(Date.UTC(2026, 0, 1, 7, 5, 0));
    const status = getMaintenanceWindowStatus(now, ["07:00", "07:02"], 20);
    expect(status.active).toBe(true);
    expect(status.window?.label).toBe("07:00");
  });

  it("handles windows starting at 23:59 with wrap-around duration", () => {
    const now = new Date(Date.UTC(2026, 0, 2, 0, 5, 0));
    const status = getMaintenanceWindowStatus(now, ["23:59"], 10);
    expect(status.active).toBe(true);
    expect(status.window?.label).toBe("23:59");

    const after = new Date(Date.UTC(2026, 0, 2, 0, 10, 0));
    const afterStatus = getMaintenanceWindowStatus(after, ["23:59"], 10);
    expect(afterStatus.active).toBe(false);
  });

  it("treats a full-day window as always active", () => {
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    const status = getMaintenanceWindowStatus(now, ["00:00"], 24 * 60);
    expect(status.active).toBe(true);
  });
});
