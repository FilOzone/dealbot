import { describe, expect, it } from "vitest";
import { ACCEPTANCE_CRITERIA, getFaultRateStatus, getSamplesStatus, getSuccessRateStatus } from "./acceptance-criteria";

describe("getSuccessRateStatus", () => {
  it("should return 'insufficient' when samples are below MIN_STORAGE_SAMPLES", () => {
    expect(getSuccessRateStatus(99, ACCEPTANCE_CRITERIA.MIN_STORAGE_SAMPLES - 1)).toBe("insufficient");
    expect(getSuccessRateStatus(99, 0)).toBe("insufficient");
  });

  it("should return 'success' when rate >= MIN_SUCCESS_RATE and samples sufficient", () => {
    expect(getSuccessRateStatus(97.0, 200)).toBe("success");
    expect(getSuccessRateStatus(100, 500)).toBe("success");
  });

  it("should return 'warning' when rate < MIN_SUCCESS_RATE and samples sufficient", () => {
    expect(getSuccessRateStatus(96.9, 200)).toBe("warning");
    expect(getSuccessRateStatus(0, 200)).toBe("warning");
  });

  it("should handle boundary at exactly MIN_STORAGE_SAMPLES", () => {
    expect(getSuccessRateStatus(97, 200)).toBe("success");
  });

  it("should handle boundary at exactly MIN_SUCCESS_RATE", () => {
    expect(getSuccessRateStatus(97.0, 200)).toBe("success");
    expect(getSuccessRateStatus(96.99, 200)).toBe("warning");
  });
});

describe("getFaultRateStatus", () => {
  it("should return 'insufficient' when samples are below MIN_RETENTION_SAMPLES", () => {
    expect(getFaultRateStatus(0, ACCEPTANCE_CRITERIA.MIN_RETENTION_SAMPLES - 1)).toBe("insufficient");
    expect(getFaultRateStatus(0, 0)).toBe("insufficient");
  });

  it("should return 'success' when rate <= MAX_FAULT_RATE and samples sufficient", () => {
    expect(getFaultRateStatus(0.2, 500)).toBe("success");
    expect(getFaultRateStatus(0, 500)).toBe("success");
  });

  it("should return 'warning' when rate > MAX_FAULT_RATE and samples sufficient", () => {
    expect(getFaultRateStatus(0.21, 500)).toBe("warning");
    expect(getFaultRateStatus(5, 500)).toBe("warning");
  });

  it("should handle boundary at exactly MIN_RETENTION_SAMPLES", () => {
    expect(getFaultRateStatus(0.1, 500)).toBe("success");
  });

  it("should handle boundary at exactly MAX_FAULT_RATE", () => {
    expect(getFaultRateStatus(0.2, 500)).toBe("success");
    expect(getFaultRateStatus(0.200001, 500)).toBe("warning");
  });
});

describe("getSamplesStatus", () => {
  it("should return 'success' when samples >= minSamples", () => {
    expect(getSamplesStatus(200, 200)).toBe("success");
    expect(getSamplesStatus(1000, 200)).toBe("success");
  });

  it("should return 'insufficient' when samples < minSamples", () => {
    expect(getSamplesStatus(199, 200)).toBe("insufficient");
    expect(getSamplesStatus(0, 200)).toBe("insufficient");
  });

  it("should work with different threshold values", () => {
    expect(getSamplesStatus(500, 500)).toBe("success");
    expect(getSamplesStatus(499, 500)).toBe("insufficient");
  });
});

describe("ACCEPTANCE_CRITERIA", () => {
  it("should have expected constant values", () => {
    expect(ACCEPTANCE_CRITERIA.MIN_STORAGE_SAMPLES).toBe(200);
    expect(ACCEPTANCE_CRITERIA.MIN_RETRIEVAL_SAMPLES).toBe(200);
    expect(ACCEPTANCE_CRITERIA.MIN_RETENTION_SAMPLES).toBe(500);
    expect(ACCEPTANCE_CRITERIA.MIN_SUCCESS_RATE).toBe(97.0);
    expect(ACCEPTANCE_CRITERIA.MAX_FAULT_RATE).toBe(0.2);
  });
});
