import { describe, expect, it } from "vitest";
import { providerWindowMetricsResponseSchema, providerWindowMetricsSchema } from "./providersWindowMetrics";

const validProvider = {
  providerId: "f01234",
  manuallyApproved: true,
  storageSuccessRate: 99.5,
  storageSamples: 672,
  dataRetentionFaultRate: 0.0,
  dataRetentionSamples: 672,
  retrievalSuccessRate: 98.5,
  retrievalSamples: 672,
};

describe("providerWindowMetricsSchema", () => {
  it("should parse a valid provider object", () => {
    const result = providerWindowMetricsSchema.parse(validProvider);
    expect(result).toEqual(validProvider);
  });

  it("should reject missing required fields", () => {
    const { providerId, ...missing } = validProvider;
    expect(() => providerWindowMetricsSchema.parse(missing)).toThrow();
  });

  it("should reject non-string providerId", () => {
    expect(() => providerWindowMetricsSchema.parse({ ...validProvider, providerId: 123 })).toThrow();
  });

  it("should reject non-boolean manuallyApproved", () => {
    expect(() => providerWindowMetricsSchema.parse({ ...validProvider, manuallyApproved: "yes" })).toThrow();
  });

  it("should reject non-number rates", () => {
    expect(() => providerWindowMetricsSchema.parse({ ...validProvider, storageSuccessRate: "high" })).toThrow();
  });

  it("should reject negative sample counts", () => {
    expect(() => providerWindowMetricsSchema.parse({ ...validProvider, storageSamples: -1 })).toThrow();
  });

  it("should reject non-integer sample counts", () => {
    expect(() => providerWindowMetricsSchema.parse({ ...validProvider, storageSamples: 1.5 })).toThrow();
  });

  it("should accept zero for sample counts", () => {
    const result = providerWindowMetricsSchema.parse({ ...validProvider, storageSamples: 0 });
    expect(result.storageSamples).toBe(0);
  });

  it("should accept decimal rates", () => {
    const result = providerWindowMetricsSchema.parse({ ...validProvider, storageSuccessRate: 99.999 });
    expect(result.storageSuccessRate).toBe(99.999);
  });
});

describe("providerWindowMetricsResponseSchema", () => {
  const validResponse = {
    data: [validProvider],
    meta: { startDate: "2025-01-01T00:00:00Z", endDate: "2025-01-31T00:00:00Z", count: 1 },
  };

  it("should parse a valid response", () => {
    const result = providerWindowMetricsResponseSchema.parse(validResponse);
    expect(result.data).toHaveLength(1);
    expect(result.meta.count).toBe(1);
  });

  it("should parse a response with empty data array", () => {
    const result = providerWindowMetricsResponseSchema.parse({
      data: [],
      meta: { startDate: null, endDate: null, count: 0 },
    });
    expect(result.data).toHaveLength(0);
  });

  it("should accept null startDate and endDate", () => {
    const result = providerWindowMetricsResponseSchema.parse({
      data: [],
      meta: { startDate: null, endDate: null, count: 0 },
    });
    expect(result.meta.startDate).toBeNull();
    expect(result.meta.endDate).toBeNull();
  });

  it("should reject missing meta", () => {
    expect(() => providerWindowMetricsResponseSchema.parse({ data: [] })).toThrow();
  });

  it("should reject missing data", () => {
    expect(() =>
      providerWindowMetricsResponseSchema.parse({
        meta: { startDate: null, endDate: null, count: 0 },
      }),
    ).toThrow();
  });

  it("should reject negative count", () => {
    expect(() =>
      providerWindowMetricsResponseSchema.parse({
        data: [],
        meta: { startDate: null, endDate: null, count: -1 },
      }),
    ).toThrow();
  });

  it("should reject invalid provider in data array", () => {
    expect(() =>
      providerWindowMetricsResponseSchema.parse({
        data: [{ providerId: 123 }],
        meta: { startDate: null, endDate: null, count: 1 },
      }),
    ).toThrow();
  });
});
