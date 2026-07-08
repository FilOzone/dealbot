import { server } from "@test/mocks/server";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";
import EnvironmentSwitcher from "./EnvironmentSwitcher";

const configUrl = "/api/config";

function makeConfig(network: "mainnet" | "calibration") {
  return {
    networks: [
      {
        network,
        dealsPerSpPerHour: 4,
        retrievalsPerSpPerHour: 4,
        dataSetCreationsPerSpPerHour: 0,
        pullChecksPerSpPerHour: 0,
        dataRetentionPollIntervalSeconds: 3600,
        providersRefreshIntervalSeconds: 3600,
      },
    ],
  };
}

// Each render gets a fresh SWR cache so cases setting different /api/config
// responses don't reuse a value cached by a previous case.
function renderSwitcher() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>
        <EnvironmentSwitcher />
      </MemoryRouter>
    </SWRConfig>,
  );
}

describe("EnvironmentSwitcher", () => {
  it("links to Staging when current deployment monitors mainnet (Production)", async () => {
    server.use(http.get(configUrl, () => HttpResponse.json(makeConfig("mainnet"))));

    renderSwitcher();

    const link = await screen.findByRole("link", { name: /Switch to Staging/i });
    expect(link).toHaveAttribute("href", "https://staging.dealbot.filoz.org");
  });

  it("links to Production when current deployment monitors calibration (Staging)", async () => {
    server.use(http.get(configUrl, () => HttpResponse.json(makeConfig("calibration"))));

    renderSwitcher();

    const link = await screen.findByRole("link", { name: /Switch to Production/i });
    expect(link).toHaveAttribute("href", "https://dealbot.filoz.org");
  });

  it("shows loading skeleton initially", () => {
    server.use(http.get(configUrl, () => new Promise(() => {})));

    const { container } = renderSwitcher();

    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("hides component when config fails to load", async () => {
    server.use(http.get(configUrl, () => new HttpResponse(null, { status: 500 })));

    const { container } = renderSwitcher();

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("opens link with rel=noreferrer", async () => {
    server.use(http.get(configUrl, () => HttpResponse.json(makeConfig("mainnet"))));

    renderSwitcher();

    const link = await screen.findByRole("link", { name: /Switch to Staging/i });
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("shows amber dot when linking to Staging (calibration)", async () => {
    server.use(http.get(configUrl, () => HttpResponse.json(makeConfig("mainnet"))));

    const { container } = renderSwitcher();

    await screen.findByRole("link", { name: /Switch to Staging/i });
    expect(container.querySelector(".bg-amber-500")).toBeInTheDocument();
  });

  it("shows emerald dot when linking to Production (mainnet)", async () => {
    server.use(http.get(configUrl, () => HttpResponse.json(makeConfig("calibration"))));

    const { container } = renderSwitcher();

    await screen.findByRole("link", { name: /Switch to Production/i });
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });
});
