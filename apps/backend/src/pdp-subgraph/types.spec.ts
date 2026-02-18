import { describe, expect, it } from "vitest";
import { validateProviderDataSetResponse } from "./types.js";

// Subgraph stores addresses in lowercase
const VALID_ADDRESS = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" as const;

const makeValidProvider = (overrides: Record<string, unknown> = {}) => ({
  address: VALID_ADDRESS,
  totalFaultedPeriods: "10",
  totalProvingPeriods: "100",
  proofSets: [
    {
      totalFaultedPeriods: "2",
      currentDeadlineCount: "5",
      nextDeadline: "1000",
      maxProvingPeriod: "100",
    },
  ],
  ...overrides,
});

const makeValidResponse = (providers = [makeValidProvider()]) => ({
  providers,
});

describe("validateProviderDataSetResponse", () => {
  it("validates and transforms a well-formed response", () => {
    const result = validateProviderDataSetResponse(makeValidResponse());

    expect(result.providers).toHaveLength(1);
    const provider = result.providers[0];
    expect(provider.address).toBe(VALID_ADDRESS);
    expect(provider.totalFaultedPeriods).toBe(10n);
    expect(provider.totalProvingPeriods).toBe(100n);

    const proofSet = provider.proofSets[0];
    expect(proofSet.totalFaultedPeriods).toBe(2n);
    expect(proofSet.currentDeadlineCount).toBe(5n);
    expect(proofSet.nextDeadline).toBe(1000n);
    expect(proofSet.maxProvingPeriod).toBe(100n);
  });

  it("converts string numbers to bigint", () => {
    const result = validateProviderDataSetResponse(
      makeValidResponse([
        makeValidProvider({
          totalFaultedPeriods: "999999999999999999",
          totalProvingPeriods: "1000000000000000000",
        }),
      ]),
    );

    expect(typeof result.providers[0].totalFaultedPeriods).toBe("bigint");
    expect(result.providers[0].totalFaultedPeriods).toBe(999999999999999999n);
    expect(result.providers[0].totalProvingPeriods).toBe(1000000000000000000n);
  });

  it("accepts an empty providers array", () => {
    const result = validateProviderDataSetResponse({ providers: [] });
    expect(result.providers).toEqual([]);
  });

  it("accepts a provider with empty proofSets", () => {
    const result = validateProviderDataSetResponse(makeValidResponse([makeValidProvider({ proofSets: [] })]));
    expect(result.providers[0].proofSets).toEqual([]);
  });

  it("preserves unknown fields (schema uses .unknown(true))", () => {
    const result = validateProviderDataSetResponse(makeValidResponse([makeValidProvider({ extraField: "hello" })]));
    expect((result.providers[0] as Record<string, unknown>).extraField).toBe("hello");
  });

  it("throws on missing providers field", () => {
    expect(() => validateProviderDataSetResponse({})).toThrow("Invalid provider dataset response format");
  });

  it("throws on null input", () => {
    expect(() => validateProviderDataSetResponse(null)).toThrow("Invalid provider dataset response format");
  });

  it("throws on missing required provider fields", () => {
    expect(() =>
      validateProviderDataSetResponse({
        providers: [{ address: VALID_ADDRESS }],
      }),
    ).toThrow("Invalid provider dataset response format");
  });

  it("throws on invalid Ethereum address", () => {
    expect(() =>
      validateProviderDataSetResponse(makeValidResponse([makeValidProvider({ address: "not-an-address" })])),
    ).toThrow("Invalid provider dataset response format");
  });

  it("throws on non-numeric string for bigint fields", () => {
    expect(() =>
      validateProviderDataSetResponse(makeValidResponse([makeValidProvider({ totalFaultedPeriods: "abc" })])),
    ).toThrow("Invalid provider dataset response format");
  });

  it("throws on negative number string for bigint fields", () => {
    expect(() =>
      validateProviderDataSetResponse(makeValidResponse([makeValidProvider({ totalFaultedPeriods: "-1" })])),
    ).toThrow("Invalid provider dataset response format");
  });

  it("throws on missing proofSet fields", () => {
    expect(() =>
      validateProviderDataSetResponse(
        makeValidResponse([
          makeValidProvider({
            proofSets: [{ totalFaultedPeriods: "1" }],
          }),
        ]),
      ),
    ).toThrow("Invalid provider dataset response format");
  });

  it("validates multiple providers in a single response", () => {
    const provider1 = makeValidProvider({ address: VALID_ADDRESS, totalFaultedPeriods: "5" });
    const provider2 = makeValidProvider({
      address: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
      totalFaultedPeriods: "15",
    });

    const result = validateProviderDataSetResponse(makeValidResponse([provider1, provider2]));

    expect(result.providers).toHaveLength(2);
    expect(result.providers[0].totalFaultedPeriods).toBe(5n);
    expect(result.providers[1].totalFaultedPeriods).toBe(15n);
  });

  it("handles zero values correctly", () => {
    const result = validateProviderDataSetResponse(
      makeValidResponse([
        makeValidProvider({
          totalFaultedPeriods: "0",
          totalProvingPeriods: "0",
          proofSets: [
            {
              totalFaultedPeriods: "0",
              currentDeadlineCount: "0",
              nextDeadline: "0",
              maxProvingPeriod: "0",
            },
          ],
        }),
      ]),
    );

    expect(result.providers[0].totalFaultedPeriods).toBe(0n);
    expect(result.providers[0].proofSets[0].maxProvingPeriod).toBe(0n);
  });
});
