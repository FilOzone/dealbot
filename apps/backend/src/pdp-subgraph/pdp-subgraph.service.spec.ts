import type { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import { PDPSubgraphService } from "./pdp-subgraph.service.js";

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SUBGRAPH_ENDPOINT = "https://api.thegraph.com/subgraphs/filecoin/pdp";

const makeSubgraphResponse = (providers: Record<string, unknown>[] = []) => ({
  data: { providers },
});

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

describe("PDPSubgraphService", () => {
  let service: PDPSubgraphService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const configService = {
      get: vi.fn((key: keyof IConfig) => {
        if (key === "blockchain") {
          return { pdpSubgraphEndpoint: SUBGRAPH_ENDPOINT };
        }
        return undefined;
      }),
    } as unknown as ConfigService<IConfig, true>;

    service = new PDPSubgraphService(configService);

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and returns validated providers with bigint fields", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSubgraphResponse([makeValidProvider()]),
    });

    const providers = await service.fetchProvidersWithDatasets(5000);

    expect(fetchMock).toHaveBeenCalledWith(SUBGRAPH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringContaining('"blockNumber":"5000"'),
    });

    expect(providers).toHaveLength(1);
    expect(providers[0].address).toBe(VALID_ADDRESS);
    expect(providers[0].totalFaultedPeriods).toBe(10n);
    expect(providers[0].totalProvingPeriods).toBe(100n);
    expect(providers[0].proofSets[0].maxProvingPeriod).toBe(100n);
  });

  it("returns empty array when no providers exist", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSubgraphResponse([]),
    });

    const providers = await service.fetchProvidersWithDatasets(5000);
    expect(providers).toEqual([]);
  });

  it("throws on HTTP error response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(service.fetchProvidersWithDatasets(5000)).rejects.toThrow("Failed to fetch provider data");
  });

  it("throws on GraphQL errors in response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: null,
        errors: [{ message: "Query failed" }],
      }),
    });

    await expect(service.fetchProvidersWithDatasets(5000)).rejects.toThrow("Failed to fetch provider data");
  });

  it("throws on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    await expect(service.fetchProvidersWithDatasets(5000)).rejects.toThrow("Failed to fetch provider data");
  });

  it("throws when response data fails validation", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { providers: [{ address: "invalid" }] },
      }),
    });

    await expect(service.fetchProvidersWithDatasets(5000)).rejects.toThrow("Failed to fetch provider data");
  });

  it("sends blockNumber as string in the GraphQL variables", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSubgraphResponse([makeValidProvider()]),
    });

    await service.fetchProvidersWithDatasets(12345);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables.blockNumber).toBe("12345");
  });
});
