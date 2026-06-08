import { server } from "@test/mocks/server";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";
import NetworkSwitcher from "./NetworkSwitcher";

const configUrl = "/api/config";

// Each render gets a fresh SWR cache so cases setting different /api/config
// responses don't reuse a value cached by a previous case.
function renderSwitcher() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>
        <NetworkSwitcher />
      </MemoryRouter>
    </SWRConfig>,
  );
}

describe("NetworkSwitcher", () => {
  it("shows current network and a link to switch to the other deployment (mainnet → calibration)", async () => {
    server.use(
      http.get(configUrl, () =>
        HttpResponse.json({
          network: "mainnet",
          jobs: {},
        }),
      ),
    );

    renderSwitcher();

    const switchLink = await screen.findByRole("link", { name: /Switch to Calibration/i });
    expect(switchLink).toHaveAttribute("href", "https://staging.dealbot.filoz.org");
  });

  it("offers switching to mainnet when current instance monitors calibration", async () => {
    server.use(
      http.get(configUrl, () =>
        HttpResponse.json({
          network: "calibration",
          jobs: {},
        }),
      ),
    );

    renderSwitcher();

    const switchLink = await screen.findByRole("link", { name: /Switch to Mainnet/i });
    expect(switchLink).toHaveAttribute("href", "https://dealbot.filoz.org");
  });

  it("shows loading state initially", () => {
    server.use(http.get(configUrl, () => new Promise(() => {})));

    const { container } = renderSwitcher();

    const loadingElement = container.querySelector(".animate-pulse");
    expect(loadingElement).toBeInTheDocument();
    expect(loadingElement).toHaveClass("bg-muted");
  });

  it("hides component when network config fails to load", async () => {
    server.use(
      http.get(configUrl, () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const { container } = renderSwitcher();

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("opens link in new tab with proper security attributes", async () => {
    server.use(
      http.get(configUrl, () =>
        HttpResponse.json({
          network: "mainnet",
          jobs: {},
        }),
      ),
    );

    renderSwitcher();

    const switchLink = await screen.findByRole("link", { name: /Switch to Calibration/i });
    expect(switchLink).toHaveAttribute("rel", "noreferrer");
  });

  it("displays correct network indicator color for calibration", async () => {
    server.use(
      http.get(configUrl, () =>
        HttpResponse.json({
          network: "calibration",
          jobs: {},
        }),
      ),
    );

    const { container } = renderSwitcher();

    await screen.findByRole("link", { name: /Switch to Mainnet/i });

    const networkDot = container.querySelector(".bg-emerald-500");
    expect(networkDot).toBeInTheDocument();
  });

  it("displays correct network indicator color for mainnet", async () => {
    server.use(
      http.get(configUrl, () =>
        HttpResponse.json({
          network: "mainnet",
          jobs: {},
        }),
      ),
    );

    const { container } = renderSwitcher();

    await screen.findByRole("link", { name: /Switch to Calibration/i });

    const networkDot = container.querySelector(".bg-amber-500");
    expect(networkDot).toBeInTheDocument();
  });
});
