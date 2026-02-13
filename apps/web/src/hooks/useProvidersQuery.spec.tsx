import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockProviderData } from "@test/mocks/data/providers";
import { server } from "@test/mocks/server";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useProvidersQuery } from "./useProvidersQuery";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const fastProvidersHandler = http.get("*/api/providers", ({ request }) => {
  const url = new URL(request.url);
  return HttpResponse.json({
    data: mockProviderData,
    meta: {
      startDate: url.searchParams.get("startDate"),
      endDate: url.searchParams.get("endDate"),
      count: mockProviderData.length,
    },
  });
});

describe("useProvidersQuery", () => {
  beforeEach(() => {
    server.use(fastProvidersHandler);
  });

  it("should fetch providers with default options", async () => {
    const { result } = renderHook(() => useProvidersQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.data).toHaveLength(mockProviderData.length);
    expect(result.current.data?.meta.count).toBe(mockProviderData.length);
  });

  it("should fetch with preset option", async () => {
    const { result } = renderHook(() => useProvidersQuery({ preset: "7d" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(mockProviderData.length);
  });

  it("should fetch with date range options", async () => {
    const { result } = renderHook(
      () =>
        useProvidersQuery({
          startDate: "2025-01-01T00:00:00Z",
          endDate: "2025-01-31T00:00:00Z",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(mockProviderData.length);
  });

  it("should be in loading state initially", () => {
    const { result } = renderHook(() => useProvidersQuery(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it("should handle API errors", async () => {
    server.use(
      http.get("*/api/providers", () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const { result } = renderHook(() => useProvidersQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to fetch providers");
  });

  it("should handle Zod validation errors for malformed data", async () => {
    server.use(
      http.get("*/api/providers", () => {
        return HttpResponse.json({
          data: [{ providerId: 123 }],
          meta: { startDate: null, endDate: null, count: 1 },
        });
      }),
    );

    const { result } = renderHook(() => useProvidersQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("should validate provider data structure", async () => {
    const { result } = renderHook(() => useProvidersQuery({ preset: "30d" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const provider = result.current.data?.data[0];
    expect(provider).toBeDefined();
    expect(typeof provider?.providerId).toBe("string");
    expect(typeof provider?.manuallyApproved).toBe("boolean");
    expect(typeof provider?.storageSuccessRate).toBe("number");
    expect(typeof provider?.storageSamples).toBe("number");
  });
});
