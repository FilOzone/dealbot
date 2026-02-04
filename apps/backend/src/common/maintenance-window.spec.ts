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
});
