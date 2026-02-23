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

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("fetchProvidersWithDatasets", () => {
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
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const promise = service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow("Failed to fetch provider data after 3 attempts");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("throws on GraphQL errors in response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: null,
          errors: [{ message: "Query failed" }],
        }),
      });

      const promise = service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      });

      await vi.runAllTimersAsync();

      // Now await the final promise to catch the expected error
      await expect(promise).rejects.toThrow("Failed to fetch provider data after 3 attempts");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("throws on network failure", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      const promise = service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      });

      await vi.runAllTimersAsync();

      // Now await the final promise to catch the expected error
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

      const promise = service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      });

      await vi.runAllTimersAsync();

      // Now await the final promise to catch the expected error
      await expect(promise).rejects.toThrow("Data validation failed");

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
      // Fail on first attempt, succeed on second attempt (1 retry)
      fetchMock.mockRejectedValueOnce(new Error("Network timeout")).mockResolvedValueOnce({
        ok: true,
        json: async () => makeSubgraphResponse([makeValidProvider()]),
      });

      const promise = service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses: [VALID_ADDRESS],
      });

      await vi.runAllTimersAsync();

      // Now await the final promise to resolve
      const providers = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2); // Initial attempt + 1 retry
      expect(providers).toHaveLength(1);
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

      const fetchPromise = service.fetchProvidersWithDatasets({
        blockNumber: 5000,
        addresses,
      });

      await vi.runAllTimersAsync();

      await fetchPromise;

      // Should respect MAX_CONCURRENT_REQUESTS (50)
      expect(maxConcurrentCalls).toBeLessThanOrEqual(50);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("fetchSubgraphMeta", () => {
    it("fetches and returns subgraph metadata with block number", async () => {
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

      const promise = service.fetchSubgraphMeta();

      await vi.runAllTimersAsync();

      // Now await the final promise to catch the expected error
      await expect(promise).rejects.toThrow("Failed to fetch subgraph metadata after 3 attempts");
    });

    it("throws on GraphQL errors in response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ message: "Query timeout" }],
        }),
      });

      const promise = service.fetchSubgraphMeta();

      await vi.runAllTimersAsync();

      // Now await the final promise to catch the expected error
      await expect(promise).rejects.toThrow("Failed to fetch subgraph metadata after 3 attempts");
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
      fetchMock.mockRejectedValueOnce(new Error("Network timeout")).mockResolvedValueOnce({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      const promise = service.fetchSubgraphMeta();

      await vi.runAllTimersAsync();

      // Now await the second promise to resolve
      const meta = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2); // Initial + 1 retry
      expect(meta._meta.block.number).toBe(12345);
    });

    it("throws after MAX_RETRIES attempts on persistent network errors", async () => {
      fetchMock.mockRejectedValue(new Error("Network timeout"));

      const promise = service.fetchSubgraphMeta();

      await vi.runAllTimersAsync();

      // Now await the final promise to catch the expected error
      await expect(promise).rejects.toThrow("Failed to fetch subgraph metadata after 3 attempts");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("enforceRateLimit (sliding window)", () => {
    it("allows requests when under the rate limit", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      const startTime = Date.now();

      // Make 5 requests - should all go through immediately
      const promises = Array.from({ length: 5 }, () => service.fetchSubgraphMeta());

      await Promise.all(promises);

      const endTime = Date.now();
      const elapsed = endTime - startTime;

      // Should complete quickly (no waiting)
      expect(elapsed).toBeLessThan(100);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it("enforces rate limit when exceeding MAX_CONCURRENT_REQUESTS", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      // Fill up the rate limit window with 50 requests
      const initialPromises = Array.from({ length: 50 }, () => service.fetchSubgraphMeta());
      await Promise.all(initialPromises);

      fetchMock.mockClear();

      // Try to make one more request - should wait for oldest to expire
      const promise = service.fetchSubgraphMeta();

      // Advance past the 10 second window + buffer
      await vi.advanceTimersByTimeAsync(10010);
      await promise;

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws error when requestCount exceeds MAX_CONCURRENT_REQUESTS", async () => {
      // Access private method via type assertion for testing
      const enforceRateLimit = (service as any).enforceRateLimit.bind(service);

      await expect(enforceRateLimit(51)).rejects.toThrow("Cannot request 51 items; exceeds rate limit window of 50");
    });

    it("correctly calculates wait time for multiple required slots", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      // Fill 48 slots
      const initialPromises = Array.from({ length: 48 }, () => service.fetchSubgraphMeta());
      await vi.runAllTimersAsync();
      await Promise.all(initialPromises);

      fetchMock.mockClear();

      // Request 5 more slots (need 3 to free up: 5 - 2 available = 3)
      // Should wait for the 3rd oldest timestamp to expire
      const enforceRateLimit = (service as any).enforceRateLimit.bind(service);
      const promise = enforceRateLimit(5);

      // The 3rd request should expire at ~10 seconds
      await vi.advanceTimersByTimeAsync(10010);
      await promise;

      // Verify slots were reserved
      // After 10s, the first 48 expired, so we should only have the 5 new ones
      const timestamps = (service as any).requestTimestamps;
      expect(timestamps.length).toBe(5); // Only the 5 new slots remain
    });

    it("handles sliding window correctly as old requests expire", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      // Make 30 requests at t=0
      const batch1 = Array.from({ length: 30 }, () => service.fetchSubgraphMeta());
      await vi.runAllTimersAsync();
      await Promise.all(batch1);

      // Advance 5 seconds
      await vi.advanceTimersByTimeAsync(5000);

      // Make 20 more requests at t=5000
      const batch2 = Array.from({ length: 20 }, () => service.fetchSubgraphMeta());
      await vi.runAllTimersAsync();
      await Promise.all(batch2);

      // Now at t=5000, we have 50 requests in the window
      // Advance to t=10100 - first 30 should expire
      await vi.advanceTimersByTimeAsync(5100);

      fetchMock.mockClear();

      // Should be able to make 30 more requests immediately
      const batch3 = Array.from({ length: 30 }, () => service.fetchSubgraphMeta());
      await vi.runAllTimersAsync();
      await Promise.all(batch3);

      expect(fetchMock).toHaveBeenCalledTimes(30);
    });

    it("adds 10ms buffer to prevent timing edge cases", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      // Fill the window
      const initialPromises = Array.from({ length: 50 }, () => service.fetchSubgraphMeta());
      await vi.runAllTimersAsync();
      await Promise.all(initialPromises);

      fetchMock.mockClear();

      const promise = service.fetchSubgraphMeta();

      // Advance past the window + buffer
      await vi.advanceTimersByTimeAsync(10010);
      await promise;

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("recursively waits when multiple batches need to expire", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      // Fill window with 50 requests
      const batch1 = Array.from({ length: 50 }, () => service.fetchSubgraphMeta());
      await vi.runAllTimersAsync();
      await Promise.all(batch1);

      // Advance 5 seconds
      await vi.advanceTimersByTimeAsync(5000);

      fetchMock.mockClear();

      // Try to request 30 slots (need to wait for 30 to expire)
      const enforceRateLimit = (service as any).enforceRateLimit.bind(service);
      const promise = enforceRateLimit(30);

      // First recursion: wait for 30th oldest to expire (~10s from start)
      await vi.advanceTimersByTimeAsync(5010);

      // Should recursively check and complete
      await promise;

      const timestamps = (service as any).requestTimestamps;
      // After 10s from start, all 50 initial requests expired, only 30 new ones remain
      expect(timestamps.length).toBe(30); // Only the 30 new slots
    });

    it("reserves slots immediately to prevent race conditions", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      // Fill 47 slots
      const initial = Array.from({ length: 47 }, () => service.fetchSubgraphMeta());
      await vi.runAllTimersAsync();
      await Promise.all(initial);

      // Now we have 3 available slots
      const enforceRateLimit = (service as any).enforceRateLimit.bind(service);

      // Request 3 slots - should succeed immediately
      await enforceRateLimit(3);

      const timestamps = (service as any).requestTimestamps;
      expect(timestamps.length).toBe(50); // 47 + 3 = 50 (full)

      // Try to request 1 more - should need to wait
      const promise = enforceRateLimit(1);

      // Advance time to free up a slot
      await vi.advanceTimersByTimeAsync(10010);
      await promise;

      // After waiting, the old slots expired and new one was added
      const finalTimestamps = (service as any).requestTimestamps;
      expect(finalTimestamps.length).toBe(1); // Only the new request remains
    });

    it("filters out expired timestamps from the sliding window", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => makeSubgraphMetaResponse(12345),
      });

      // Make 20 requests
      const batch1 = Array.from({ length: 20 }, () => service.fetchSubgraphMeta());
      await vi.runAllTimersAsync();
      await Promise.all(batch1);

      // Advance past the window
      await vi.advanceTimersByTimeAsync(11000);

      fetchMock.mockClear();

      // Make another request - should have full window available
      await service.fetchSubgraphMeta();

      const timestamps = (service as any).requestTimestamps;
      // Should only have 1 timestamp (the new one), old ones filtered out
      expect(timestamps.length).toBe(1);
    });
  });
});
