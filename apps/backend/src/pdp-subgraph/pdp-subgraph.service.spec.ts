import type { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import { PDPSubgraphService } from "./pdp-subgraph.service.js";

const VALID_ADDRESS = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" as const;
const SUBGRAPH_ENDPOINT = "https://api.thegraph.com/subgraphs/filecoin/pdp" as const;

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

const makeSubgraphMetaResponse = (blockNumber = 12345) => ({
  data: {
    _meta: {
      block: {
        number: blockNumber,
      },
    },
  },
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

    const providers = await service.fetchProvidersWithDatasets({
      blockNumber: 5000,
      addresses: [VALID_ADDRESS],
    });

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

    const providers = await service.fetchProvidersWithDatasets({
      blockNumber: 5000,
      addresses: [VALID_ADDRESS],
    });
    expect(providers).toEqual([]);
  });

  it("returns empty array when addresses array is empty", async () => {
    const providers = await service.fetchProvidersWithDatasets({
      blockNumber: 5000,
      addresses: [],
    });

    expect(providers).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on HTTP error response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(
      service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      }),
    ).rejects.toThrow("Failed to fetch provider data after 3 attempts");
  });

  it("throws on GraphQL errors in response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: null,
        errors: [{ message: "Query failed" }],
      }),
    });

    await expect(
      service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      }),
    ).rejects.toThrow("Failed to fetch provider data after 3 attempts");
  });

  it("throws on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const promise = service.fetchProvidersWithDatasets({
      blockNumber: 5000,
      addresses: [VALID_ADDRESS],
    });

    await expect(promise).rejects.toThrow("Failed to fetch provider data after 3 attempts");
    expect(fetchMock).toHaveBeenCalledTimes(3); // Initial + 2 retries = 3 total
  });

  it("throws immediately on validation error without retrying", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { providers: [{ address: "invalid" }] },
      }),
    });

    await expect(
      service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      }),
    ).rejects.toThrow("Data validation failed");

    // Should only be called once - no retries for validation errors
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws immediately when response data is missing required fields", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { providers: [{ address: VALID_ADDRESS }] }, // Missing required fields
      }),
    });

    await expect(
      service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      }),
    ).rejects.toThrow("Data validation failed");

    // Should only be called once - no retries for validation errors
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends blockNumber as string in the GraphQL variables", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSubgraphResponse([makeValidProvider()]),
    });

    await service.fetchProvidersWithDatasets({
      blockNumber: 12345,
      addresses: [VALID_ADDRESS],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables.blockNumber).toBe("12345");
  });

  it("retries network errors but not validation errors", async () => {
    // First attempt: network error (should retry)
    fetchMock.mockRejectedValueOnce(new Error("Network timeout"));

    // Second attempt: succeeds but validation fails (should not retry)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { providers: [{ address: "invalid" }] },
      }),
    });

    await expect(
      service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      }),
    ).rejects.toThrow("Data validation failed");

    // Should be called twice: initial network error + 1 retry that fails validation
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends addresses array in the GraphQL variables", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSubgraphResponse([makeValidProvider()]),
    });

    const addresses = [VALID_ADDRESS, "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B"];
    await service.fetchProvidersWithDatasets({
      blockNumber: 5000,
      addresses,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables.addresses).toEqual(addresses);
  });

  it("batches large address lists into chunks of MAX_PROVIDERS_PER_QUERY", async () => {
    // Create 150 addresses (should be split into 2 batches: 100 + 50)
    const addresses = Array.from({ length: 150 }, (_, i) => `0x${i.toString().padStart(40, "0")}`);

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => makeSubgraphResponse([]),
    });

    await service.fetchProvidersWithDatasets({
      blockNumber: 5000,
      addresses,
    });

    // Should make 2 requests
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries failed requests with exponential backoff", async () => {
    vi.useFakeTimers();

    // Fail on first attempt, succeed on second attempt (1 retry)
    fetchMock.mockRejectedValueOnce(new Error("Network timeout")).mockResolvedValueOnce({
      ok: true,
      json: async () => makeSubgraphResponse([makeValidProvider()]),
    });

    const promise = service.fetchProvidersWithDatasets({
      blockNumber: 5000,
      addresses: [VALID_ADDRESS],
    });

    // Fast-forward through retry delays
    await vi.runAllTimersAsync();
    const providers = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2); // Initial attempt + 1 retry
    expect(providers).toHaveLength(1);

    vi.useRealTimers();
  });

  it("processes batches with concurrency control", async () => {
    // Create 120 addresses (should be 2 batches of 100 each, but processed with concurrency limit)
    const addresses = Array.from({ length: 120 }, (_, i) => `0x${i.toString().padStart(40, "0")}`);

    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;

    fetchMock.mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrentCalls--;
      return {
        ok: true,
        json: async () => makeSubgraphResponse([]),
      };
    });

    await service.fetchProvidersWithDatasets({
      blockNumber: 5000,
      addresses,
    });

    // Should respect MAX_CONCURRENT_REQUESTS (50)
    expect(maxConcurrentCalls).toBeLessThanOrEqual(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe("fetchSubgraphMeta", () => {
    it("fetches and returns subgraph metadata with block number and timestamp", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      const meta = await service.fetchSubgraphMeta();

      expect(fetchMock).toHaveBeenCalledWith(SUBGRAPH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining("GetSubgraphMeta"),
      });

      expect(meta).toEqual({
        _meta: {
          block: {
            number: 12345,
          },
        },
      });
    });

    it("throws when PDP subgraph endpoint is not configured", async () => {
      const configService = {
        get: vi.fn(() => ({ pdpSubgraphEndpoint: "" })),
      } as unknown as ConfigService<IConfig, true>;

      const serviceWithoutEndpoint = new PDPSubgraphService(configService);

      await expect(serviceWithoutEndpoint.fetchSubgraphMeta()).rejects.toThrow("No PDP subgraph endpoint configured");
    });

    it("throws on HTTP error response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(service.fetchSubgraphMeta()).rejects.toThrow("Failed to fetch subgraph metadata after 3 attempts");
    });

    it("throws on GraphQL errors in response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ message: "Query timeout" }],
        }),
      });

      await expect(service.fetchSubgraphMeta()).rejects.toThrow("Failed to fetch subgraph metadata after 3 attempts");
    });

    it("throws on validation failure without retry", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            _meta: {
              block: {
                number: "not-a-number", // Invalid - should be number
              },
            },
          },
        }),
      });

      await expect(service.fetchSubgraphMeta()).rejects.toThrow("Data validation failed");
      expect(fetchMock).toHaveBeenCalledTimes(1); // Should not retry validation errors
    });

    it("throws on missing required fields", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            _meta: {
              block: {
                number: undefined, // missing required field
              },
            },
          },
        }),
      });

      await expect(service.fetchSubgraphMeta()).rejects.toThrow("Data validation failed");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries on network failures with exponential backoff", async () => {
      vi.useFakeTimers();

      fetchMock.mockRejectedValueOnce(new Error("Network timeout")).mockResolvedValueOnce({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      const promise = service.fetchSubgraphMeta();

      await vi.runAllTimersAsync();
      const meta = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2); // Initial + 1 retry
      expect(meta._meta.block.number).toBe(12345);

      vi.useRealTimers();
    });

    it("throws after MAX_RETRIES attempts on persistent network errors", async () => {
      vi.useFakeTimers();

      fetchMock.mockRejectedValue(new Error("Network timeout"));

      const promise = service.fetchSubgraphMeta();

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow("Failed to fetch subgraph metadata after 3 attempts");
      expect(fetchMock).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });
});
