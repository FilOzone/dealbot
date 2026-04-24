import { server } from "@test/mocks/server";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import NetworkSwitcher from "./NetworkSwitcher";

const configUrl = "/api/config";

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

    render(
      <MemoryRouter>
        <NetworkSwitcher />
      </MemoryRouter>,
    );

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

    render(
      <MemoryRouter>
        <NetworkSwitcher />
      </MemoryRouter>,
    );

    const switchLink = await screen.findByRole("link", { name: /Switch to Mainnet/i });
    expect(switchLink).toHaveAttribute("href", "https://dealbot.filoz.org");
  });

  it("shows loading state initially", () => {
    server.use(http.get(configUrl, () => new Promise(() => {})));

    const { container } = render(
      <MemoryRouter>
        <NetworkSwitcher />
      </MemoryRouter>,
    );

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

    const { container } = render(
      <MemoryRouter>
        <NetworkSwitcher />
      </MemoryRouter>,
    );

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

    render(
      <MemoryRouter>
        <NetworkSwitcher />
      </MemoryRouter>,
    );

    const switchLink = await screen.findByRole("link", { name: /Switch to Calibration/i });
    expect(switchLink).toHaveAttribute("target", "_blank");
    expect(switchLink).toHaveAttribute("rel", "noopener noreferrer");
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

    const { container } = render(
      <MemoryRouter>
        <NetworkSwitcher />
      </MemoryRouter>,
    );

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

    const { container } = render(
      <MemoryRouter>
        <NetworkSwitcher />
      </MemoryRouter>,
    );

    await screen.findByRole("link", { name: /Switch to Calibration/i });

    const networkDot = container.querySelector(".bg-amber-500");
    expect(networkDot).toBeInTheDocument();
  });
});
