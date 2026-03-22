import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProvidersListResponseWithoutMetrics } from "@/types/providers";

const mockUseProvidersList =
  vi.fn<
    (...args: unknown[]) => {
      providers: ProvidersListResponseWithoutMetrics;
      loading: boolean;
      error: string | null;
    }
  >();

vi.mock("@/hooks/useProvidersList", () => ({
  useProvidersList: (...args: unknown[]) => mockUseProvidersList(...args),
}));

import Landing from "./Landing";

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    address: "0xabc123",
    providerId: "1",
    name: "Test Provider",
    description: "desc",
    payee: "0xabc",
    serviceUrl: "https://example.com",
    isActive: true,
    isApproved: true,
    region: "US",
    metadata: {},
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function setupMock(providers: ReturnType<typeof makeProvider>[] = [makeProvider()]) {
  mockUseProvidersList.mockReturnValue({
    providers: {
      providers,
      total: providers.length,
      offset: 0,
      count: providers.length,
      limit: 20,
    },
    loading: false,
    error: null,
  });
}

describe("Landing", () => {
  it("renders string providerId in the table", () => {
    setupMock([makeProvider({ providerId: "42" })]);
    render(<Landing />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders dash when providerId is null", () => {
    setupMock([makeProvider({ providerId: null })]);
    render(<Landing />);
    const row = screen.getByText("Test Provider").closest("tr")!;
    const cells = row.querySelectorAll("td");
    expect(cells[1].textContent).toBe("—");
  });
});
