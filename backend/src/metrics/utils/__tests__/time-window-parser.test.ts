import {
  COMMON_PRESETS,
  calculateTimeWindow,
  parseCustomDateRange,
  parseDuration,
  sanitizePreset,
  validateDateRange,
} from "../time-window-parser.js";

describe("TimeWindowParser", () => {
  describe("parseDuration", () => {
    it("should parse valid hour durations", () => {
      expect(parseDuration("1h")).toEqual({ value: 1, unit: "h", hours: 1 });
      expect(parseDuration("1.5h")).toEqual({ value: 1.5, unit: "h", hours: 1.5 });
      expect(parseDuration("12h")).toEqual({ value: 12, unit: "h", hours: 12 });
      expect(parseDuration("24h")).toEqual({ value: 24, unit: "h", hours: 24 });
    });

    it("should parse valid day durations", () => {
      expect(parseDuration("1d")).toEqual({ value: 1, unit: "d", hours: 24 });
      expect(parseDuration("2.5d")).toEqual({ value: 2.5, unit: "d", hours: 60 });
      expect(parseDuration("7d")).toEqual({ value: 7, unit: "d", hours: 168 });
      expect(parseDuration("30d")).toEqual({ value: 30, unit: "d", hours: 720 });
      expect(parseDuration("90d")).toEqual({ value: 90, unit: "d", hours: 2160 });
    });

    it("should handle case-insensitive input", () => {
      expect(parseDuration("1H")).toEqual({ value: 1, unit: "h", hours: 1 });
      expect(parseDuration("1D")).toEqual({ value: 1, unit: "d", hours: 24 });
    });

    it("should handle whitespace", () => {
      expect(parseDuration(" 1h ")).toEqual({ value: 1, unit: "h", hours: 1 });
      expect(parseDuration("  2d  ")).toEqual({ value: 2, unit: "d", hours: 48 });
    });

    it("should reject invalid formats", () => {
      expect(() => parseDuration("")).toThrow("Invalid time window format");
      expect(() => parseDuration("1")).toThrow("Invalid time window format");
      expect(() => parseDuration("h")).toThrow("Invalid time window format");
      expect(() => parseDuration("1x")).toThrow("Invalid time window format");
      expect(() => parseDuration("abc")).toThrow("Invalid time window format");
      expect(() => parseDuration("1.2.3d")).toThrow("Invalid time window format");
    });

    it("should reject negative values", () => {
      expect(() => parseDuration("-1h")).toThrow("Invalid time window format");
      expect(() => parseDuration("-5d")).toThrow("Invalid time window format");
    });

    it("should reject zero values", () => {
      expect(() => parseDuration("0h")).toThrow("Invalid duration value");
      expect(() => parseDuration("0d")).toThrow("Invalid duration value");
    });

    it("should reject durations below minimum (1 hour)", () => {
      expect(() => parseDuration("0.5h")).toThrow("Duration too short");
      expect(() => parseDuration("0.01d")).toThrow("Duration too short");
    });

    it("should reject durations above maximum (90 days)", () => {
      expect(() => parseDuration("2161h")).toThrow("Duration too long"); // > 90 days
      expect(() => parseDuration("91d")).toThrow("Duration too long");
      expect(() => parseDuration("100d")).toThrow("Duration too long");
    });

    it("should reject 'all' preset", () => {
      expect(() => parseDuration("all")).toThrow('Use isAllTime flag for "all" preset');
    });
  });

  describe("calculateTimeWindow", () => {
    const referenceDate = new Date("2024-11-02T12:00:00Z");

    it("should calculate time window for hours", () => {
      const window = calculateTimeWindow("1h", referenceDate);
      expect(window.endDate).toEqual(referenceDate);
      expect(window.startDate).toEqual(new Date("2024-11-02T11:00:00Z"));
      expect(window.days).toBe(0);
      expect(window.preset).toBe("1h");
      expect(window.isAllTime).toBe(false);
    });

    it("should calculate time window for days", () => {
      const window = calculateTimeWindow("7d", referenceDate);
      expect(window.endDate).toEqual(referenceDate);
      expect(window.startDate).toEqual(new Date("2024-10-26T12:00:00Z"));
      expect(window.days).toBe(7);
      expect(window.preset).toBe("7d");
      expect(window.isAllTime).toBe(false);
    });

    it("should calculate time window for fractional days", () => {
      const window = calculateTimeWindow("2.5d", referenceDate);
      expect(window.endDate).toEqual(referenceDate);
      expect(window.startDate).toEqual(new Date("2024-10-31T00:00:00Z"));
      expect(window.days).toBe(2.5);
      expect(window.preset).toBe("2.5d");
      expect(window.isAllTime).toBe(false);
    });

    it("should handle 'all' preset", () => {
      const window = calculateTimeWindow("all", referenceDate);
      expect(window.endDate).toEqual(referenceDate);
      expect(window.startDate).toEqual(new Date(0)); // Unix epoch
      expect(window.days).toBe(-1);
      expect(window.preset).toBe("all");
      expect(window.isAllTime).toBe(true);
    });

    it("should use current date if no reference provided", () => {
      const before = new Date();
      const window = calculateTimeWindow("1h");
      const after = new Date();

      expect(window.endDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(window.endDate.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("validateDateRange", () => {
    it("should accept valid date ranges", () => {
      const start = new Date("2024-10-01");
      const end = new Date("2024-10-31");
      expect(() => validateDateRange(start, end)).not.toThrow();
    });

    it("should reject invalid start date", () => {
      const start = new Date("invalid");
      const end = new Date("2024-10-31");
      expect(() => validateDateRange(start, end)).toThrow("Invalid start date");
    });

    it("should reject invalid end date", () => {
      const start = new Date("2024-10-01");
      const end = new Date("invalid");
      expect(() => validateDateRange(start, end)).toThrow("Invalid end date");
    });

    it("should reject start date after end date", () => {
      const start = new Date("2024-10-31");
      const end = new Date("2024-10-01");
      expect(() => validateDateRange(start, end)).toThrow("Start date must be before end date");
    });

    it("should reject start date equal to end date", () => {
      const start = new Date("2024-10-01");
      const end = new Date("2024-10-01");
      expect(() => validateDateRange(start, end)).toThrow("Start date must be before end date");
    });

    it("should reject future end date", () => {
      const start = new Date();
      const end = new Date(Date.now() + 86400000); // Tomorrow
      expect(() => validateDateRange(start, end)).toThrow("End date cannot be in the future");
    });

    it("should reject ranges exceeding 90 days", () => {
      const start = new Date("2024-01-01");
      const end = new Date("2024-04-15"); // > 90 days
      expect(() => validateDateRange(start, end)).toThrow("Date range too large");
    });

    it("should reject ranges less than 1 hour", () => {
      const start = new Date("2024-10-01T12:00:00Z");
      const end = new Date("2024-10-01T12:30:00Z"); // 30 minutes
      expect(() => validateDateRange(start, end)).toThrow("Date range too small");
    });

    it("should accept exactly 90 days", () => {
      const start = new Date("2024-08-01");
      const end = new Date("2024-10-30");
      expect(() => validateDateRange(start, end)).not.toThrow();
    });

    it("should accept exactly 1 hour", () => {
      const start = new Date("2024-10-01T12:00:00Z");
      const end = new Date("2024-10-01T13:00:00Z");
      expect(() => validateDateRange(start, end)).not.toThrow();
    });
  });

  describe("parseCustomDateRange", () => {
    it("should parse valid date range", () => {
      const window = parseCustomDateRange("2024-10-01", "2024-10-31");
      expect(window.startDate).toEqual(new Date("2024-10-01T00:00:00Z"));
      expect(window.endDate.getDate()).toBe(31);
      expect(window.endDate.getHours()).toBe(23);
      expect(window.endDate.getMinutes()).toBe(59);
      expect(window.days).toBeGreaterThanOrEqual(30); // End date is 23:59:59, so ~30.8 days
      expect(window.days).toBeLessThan(31);
      expect(window.preset).toBe("2024-10-01_2024-10-31");
      expect(window.isAllTime).toBe(false);
    });

    it("should set end date to end of day", () => {
      const window = parseCustomDateRange("2024-10-01", "2024-10-02");
      expect(window.endDate.getHours()).toBe(23);
      expect(window.endDate.getMinutes()).toBe(59);
      expect(window.endDate.getSeconds()).toBe(59);
    });

    it("should reject invalid date strings", () => {
      expect(() => parseCustomDateRange("invalid", "2024-10-31")).toThrow("Invalid start date");
      expect(() => parseCustomDateRange("2024-10-01", "invalid")).toThrow("Invalid end date");
    });

    it("should reject invalid ranges", () => {
      expect(() => parseCustomDateRange("2024-10-31", "2024-10-01")).toThrow("Start date must be before end date");
    });
  });

  describe("sanitizePreset", () => {
    it("should allow valid preset characters", () => {
      expect(sanitizePreset("1h")).toBe("1h");
      expect(sanitizePreset("2.5d")).toBe("2.5d");
      expect(sanitizePreset("30d")).toBe("30d");
      expect(sanitizePreset("all")).toBe("all");
    });

    it("should remove special characters", () => {
      expect(sanitizePreset("1h; DROP TABLE users;")).toBe("1hDROPTABLEusers");
      expect(sanitizePreset("1h' OR '1'='1")).toBe("1hOR11");
      expect(sanitizePreset("1h<script>alert('xss')</script>")).toBe("1hscriptalertxssscript");
    });

    it("should preserve hyphens and dots", () => {
      expect(sanitizePreset("2.5d")).toBe("2.5d");
      expect(sanitizePreset("2024-10-01")).toBe("2024-10-01");
    });

    it("should handle empty string", () => {
      expect(sanitizePreset("")).toBe("");
    });
  });

  describe("COMMON_PRESETS", () => {
    it("should have valid preset values", () => {
      for (const preset of COMMON_PRESETS) {
        if (preset.value === "all") {
          expect(() => calculateTimeWindow(preset.value)).not.toThrow();
        } else {
          expect(() => parseDuration(preset.value)).not.toThrow();
        }
      }
    });

    it("should have unique values", () => {
      const values = COMMON_PRESETS.map((p) => p.value);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it("should have non-empty labels", () => {
      for (const preset of COMMON_PRESETS) {
        expect(preset.label.length).toBeGreaterThan(0);
      }
    });
  });
});
