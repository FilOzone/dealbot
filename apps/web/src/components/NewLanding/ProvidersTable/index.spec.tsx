import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProviderWindowMetrics } from "@/schamas/providersWindowMetrics";
import ProvidersTable from "./index";

const mockData: ProviderWindowMetrics[] = [
  {
    providerId: "f01234",
    manuallyApproved: true,
    storageSuccessRate: 99.5,
    storageSamples: 672,
    dataRetentionFaultRate: 0.0,
    dataRetentionSamples: 672,
    retrievalSuccessRate: 98.5,
    retrievalSamples: 672,
  },
  {
    providerId: "f05678",
    manuallyApproved: false,
    storageSuccessRate: 94.5,
    storageSamples: 100,
    dataRetentionFaultRate: 0.6,
    dataRetentionSamples: 300,
    retrievalSuccessRate: 85.5,
    retrievalSamples: 100,
  },
];

describe("ProvidersTable", () => {
  describe("Rendering", () => {
    it("should render without crashing with default props", () => {
      render(<ProvidersTable />);
      expect(screen.getByText(/no results/i)).toBeInTheDocument();
    });

    it("should render column headers", () => {
      render(<ProvidersTable data={mockData} />);
      expect(screen.getByText("Provider")).toBeInTheDocument();
    });

    it("should render provider IDs", () => {
      render(<ProvidersTable data={mockData} />);
      expect(screen.getByText("f01234")).toBeInTheDocument();
      expect(screen.getByText("f05678")).toBeInTheDocument();
    });

    it("should render approval badge for manually approved provider", () => {
      render(<ProvidersTable data={mockData} />);
      expect(screen.getByText("Approved")).toBeInTheDocument();
    });
  });

  describe("Loading State", () => {
    it("should show loading message when isLoading is true", () => {
      render(<ProvidersTable isLoading={true} />);
      expect(screen.getByText(/loading providers/i)).toBeInTheDocument();
    });

    it("should not show data rows when loading", () => {
      render(<ProvidersTable data={mockData} isLoading={true} />);
      expect(screen.queryByText("f01234")).not.toBeInTheDocument();
    });
  });

  describe("Error State", () => {
    it("should show error message when error is provided", () => {
      const error = new Error("Network failure");
      render(<ProvidersTable error={error} />);
      expect(screen.getByText(/error: network failure/i)).toBeInTheDocument();
    });

    it("should not show data rows when error", () => {
      const error = new Error("fail");
      render(<ProvidersTable data={mockData} error={error} />);
      expect(screen.queryByText("f01234")).not.toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("should show 'No results.' when data is empty", () => {
      render(<ProvidersTable data={[]} />);
      expect(screen.getByText(/no results/i)).toBeInTheDocument();
    });
  });

  describe("Data Display", () => {
    it("should render success rates with correct formatting", () => {
      render(<ProvidersTable data={mockData} />);
      expect(screen.getByText("99.5%")).toBeInTheDocument();
      expect(screen.getByText("98.5%")).toBeInTheDocument();
    });

    it("should render fault rates with two decimal places", () => {
      render(<ProvidersTable data={mockData} />);
      expect(screen.getByText("0.00%")).toBeInTheDocument();
      expect(screen.getByText("0.60%")).toBeInTheDocument();
    });

    it("should render sample counts", () => {
      render(<ProvidersTable data={mockData} />);
      expect(screen.getAllByText("672").length).toBeGreaterThan(0);
    });

    it("should render min sample thresholds in headers", () => {
      render(<ProvidersTable data={mockData} />);
      expect(screen.getAllByText(/min 200/i)).toHaveLength(2);
      expect(screen.getByText(/min 500/i)).toBeInTheDocument();
    });
  });
});
