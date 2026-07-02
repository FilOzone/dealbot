import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Network } from "@/types/config";
import type { Provider, ProvidersListResponseWithoutMetrics } from "@/types/providers";

const mockUseProvidersList =
  vi.fn<
    (...args: unknown[]) => {
      providers: ProvidersListResponseWithoutMetrics;
      loading: boolean;
      error: string | null;
    }
  >();
const mockUseActiveNetworks =
  vi.fn<
    () => {
      activeNetworks: Network[];
      loading: boolean;
      error: string | null;
    }
  >();
const mockUseSelectedNetwork = vi.fn<() => [Network | null, (network: Network) => void]>();

vi.mock("@/hooks/useProvidersList", () => ({
  useProvidersList: (...args: unknown[]) => mockUseProvidersList(...args),
}));

vi.mock("@/hooks/useActiveNetworks", () => ({
  useActiveNetworks: () => mockUseActiveNetworks(),
}));

vi.mock("@/hooks/useSelectedNetwork", () => ({
  useSelectedNetwork: () => mockUseSelectedNetwork(),
}));

import Landing from "./Landing";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
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
    network: "mainnet",
    metadata: {},
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function setupMock(providers: Provider[] = [makeProvider()]) {
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

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe("Landing", () => {
  beforeEach(() => {
    mockUseActiveNetworks.mockReturnValue({ activeNetworks: ["mainnet"], loading: false, error: null });
    mockUseSelectedNetwork.mockReturnValue(["mainnet", vi.fn()]);
    setupMock();
  });

  it("renders string providerId in the table", () => {
    setupMock([makeProvider({ providerId: "42" })]);
    renderLanding();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders dash when providerId is null", () => {
    setupMock([makeProvider({ providerId: null })]);
    renderLanding();
    const row = screen.getByText("Test Provider").closest("tr")!;
    const cells = row.querySelectorAll("td");
    expect(cells[1].textContent).toBe("—");
  });

  it("shows config errors instead of leaving providers loading", () => {
    mockUseActiveNetworks.mockReturnValue({
      activeNetworks: [],
      loading: false,
      error: "Request failed: /api/config (HTTP 500)",
    });
    mockUseSelectedNetwork.mockReturnValue([null, vi.fn()]);
    setupMock([]);

    renderLanding();

    expect(screen.getByText("Request failed: /api/config (HTTP 500)")).toBeInTheDocument();
    expect(screen.queryByText("Loading providers…")).not.toBeInTheDocument();
  });
});
