import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FaultRateCell, SamplesCell, SuccessRateCell } from "./TableCells";

describe("SuccessRateCell", () => {
  it("should render the rate with one decimal and percent sign", () => {
    render(<SuccessRateCell rate={99.5} status="success" />);
    expect(screen.getByText("99.5%")).toBeInTheDocument();
  });

  it("should render integer rates with one decimal place", () => {
    render(<SuccessRateCell rate={100} status="success" />);
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });

  it("should apply success styling", () => {
    const { container } = render(<SuccessRateCell rate={99} status="success" />);
    expect(container.firstChild).toHaveClass("text-right");
  });

  it("should render with warning status", () => {
    render(<SuccessRateCell rate={90} status="warning" />);
    expect(screen.getByText("90.0%")).toBeInTheDocument();
  });

  it("should render with insufficient status", () => {
    render(<SuccessRateCell rate={50} status="insufficient" />);
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });
});

describe("FaultRateCell", () => {
  it("should render the rate with two decimals and percent sign", () => {
    render(<FaultRateCell rate={0.15} status="success" />);
    expect(screen.getByText("0.15%")).toBeInTheDocument();
  });

  it("should render zero fault rate", () => {
    render(<FaultRateCell rate={0} status="success" />);
    expect(screen.getByText("0.00%")).toBeInTheDocument();
  });

  it("should render with warning status", () => {
    render(<FaultRateCell rate={1.5} status="warning" />);
    expect(screen.getByText("1.50%")).toBeInTheDocument();
  });
});

describe("SamplesCell", () => {
  it("should render the sample count with locale formatting", () => {
    render(<SamplesCell samples={1000} status="success" />);
    expect(screen.getByText("1,000")).toBeInTheDocument();
  });

  it("should render zero samples", () => {
    render(<SamplesCell samples={0} status="insufficient" />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("should render large numbers with locale formatting", () => {
    render(<SamplesCell samples={1234567} status="success" />);
    expect(screen.getByText((1234567).toLocaleString())).toBeInTheDocument();
  });

  it("should render small numbers without commas", () => {
    render(<SamplesCell samples={672} status="success" />);
    expect(screen.getByText("672")).toBeInTheDocument();
  });
});
