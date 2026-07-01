import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@/hooks/useActiveNetworks", () => ({
  useActiveNetworks: () => ({ activeNetworks: ["mainnet"], loading: false, error: null }),
}));

vi.mock("@/hooks/useSelectedNetwork", () => ({
  useSelectedNetwork: () => ["mainnet", vi.fn()],
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
    network: "mainnet",
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

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe("Landing", () => {
  afterEach(() => {
    window.__DEALBOT_CONFIG__ = undefined;
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

  it("scopes per-SP metrics and logs links with vs[network]", () => {
    window.__DEALBOT_CONFIG__ = {
      DASHBOARD_URL: "https://telemetry.betterstack.com/dashboards/metrics",
      LOGS_URL: "https://telemetry.betterstack.com/dashboards/logs",
    };
    setupMock([makeProvider({ providerId: "42" })]);
    renderLanding();
    const metrics = screen.getByRole("link", { name: /Metrics/ });
    const logs = screen.getByRole("link", { name: /Logs/ });
    expect(metrics.getAttribute("href")).toContain("vs%5Bnetwork%5D=mainnet");
    expect(logs.getAttribute("href")).toContain("vs%5Bnetwork%5D=mainnet");
  });

  it("prefers the combined approved-SP dashboard and scopes it with vs[network]", () => {
    window.__DEALBOT_CONFIG__ = {
      APPROVED_SP_DASHBOARD_URL: "https://telemetry.betterstack.com/dashboards/combined",
      APPROVED_SP_DASHBOARD_URL_MAINNET: "https://telemetry.betterstack.com/dashboards/legacy-mainnet",
    };
    setupMock();
    renderLanding();
    const href = screen.getByRole("link", { name: /View dashboard/ }).getAttribute("href") ?? "";
    expect(href).toContain("/dashboards/combined");
    expect(href).toContain("vs%5Bnetwork%5D=mainnet");
  });

  it("falls back to the legacy per-network approved-SP dashboard when the combined var is unset", () => {
    window.__DEALBOT_CONFIG__ = {
      APPROVED_SP_DASHBOARD_URL_MAINNET: "https://telemetry.betterstack.com/dashboards/legacy-mainnet",
    };
    setupMock();
    renderLanding();
    const href = screen.getByRole("link", { name: /View dashboard/ }).getAttribute("href") ?? "";
    expect(href).toContain("/dashboards/legacy-mainnet");
    expect(href).not.toContain("vs%5Bnetwork%5D");
  });
});
