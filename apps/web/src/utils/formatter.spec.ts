import { describe, expect, it } from "vitest";
import { formatFileSize, formatMilliseconds, formatThroughput } from "./formatter.js";

describe("formatFileSize", () => {
  it("formats bytes correctly", () => {
    expect(formatFileSize(0)).toBe("0.0 B");
    expect(formatFileSize(500)).toBe("500.0 B");
    expect(formatFileSize(1023)).toBe("1023.0 B");
  });

  it("formats kilobytes correctly", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5120)).toBe("5.0 KB");
  });

  it("formats megabytes correctly", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("formats gigabytes correctly", () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  it("handles decimal places", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB"); // 1.5 KB
    expect(formatFileSize(1024 * 1024 + 512 * 1024)).toBe("1.5 MB"); // 1.5 MB
  });
});

describe("formatThroughput", () => {
  it("formats throughput with /s suffix", () => {
    expect(formatThroughput(1024)).toBe("1.0 KB/s");
    expect(formatThroughput(5 * 1024 * 1024)).toBe("5.0 MB/s");
  });

  it("handles zero throughput", () => {
    expect(formatThroughput(0)).toBe("0.0 B/s");
  });
});

describe("formatMilliseconds", () => {
  it("formats milliseconds correctly", () => {
    expect(formatMilliseconds(100)).toBe("100 ms");
    expect(formatMilliseconds(999)).toBe("999 ms");
    expect(formatMilliseconds(500.7)).toBe("501 ms"); // rounds
  });

  it("formats seconds correctly", () => {
    expect(formatMilliseconds(1000)).toBe("1 sec");
    expect(formatMilliseconds(2500)).toBe("2.5 secs");
    expect(formatMilliseconds(30000)).toBe("30 secs");
  });

  it("formats minutes correctly", () => {
    expect(formatMilliseconds(60 * 1000)).toBe("1 min");
    expect(formatMilliseconds(90 * 1000)).toBe("1.5 mins");
    expect(formatMilliseconds(5 * 60 * 1000)).toBe("5 mins");
  });

  it("formats hours correctly", () => {
    expect(formatMilliseconds(60 * 60 * 1000)).toBe("1 hr");
    expect(formatMilliseconds(2.5 * 60 * 60 * 1000)).toBe("2.5 hrs");
  });

  it("formats days correctly", () => {
    expect(formatMilliseconds(24 * 60 * 60 * 1000)).toBe("1 day");
    expect(formatMilliseconds(2 * 24 * 60 * 60 * 1000)).toBe("2 days");
  });

  it("respects custom decimal places", () => {
    expect(formatMilliseconds(2500, 0)).toBe("3 secs"); // 2.5 rounds to 3
    expect(formatMilliseconds(2200, 0)).toBe("2 secs"); // 2.2 rounds to 2
    expect(formatMilliseconds(2500, 1)).toBe("2.5 secs");
    expect(formatMilliseconds(2567, 2)).toBe("2.57 secs");
    expect(formatMilliseconds(2567, 3)).toBe("2.567 secs");
  });

  it("handles edge cases", () => {
    expect(formatMilliseconds(0)).toBe("0 ms");
    expect(formatMilliseconds(1)).toBe("1 ms");
  });
});
