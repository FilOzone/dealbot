import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NetworkSwitcher from "./NetworkSwitcher";

describe("NetworkSwitcher", () => {
  it("renders nothing when only one network is active", () => {
    const { container } = render(<NetworkSwitcher networks={["mainnet"]} selected="mainnet" onChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a tab for each network when multiple are active", () => {
    render(<NetworkSwitcher networks={["mainnet", "calibration"]} selected="mainnet" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: /mainnet/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /calibration/i })).toBeInTheDocument();
  });

  it("marks the selected network tab as aria-selected", () => {
    render(<NetworkSwitcher networks={["mainnet", "calibration"]} selected="calibration" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: /calibration/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /mainnet/i })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange with the clicked network", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NetworkSwitcher networks={["mainnet", "calibration"]} selected="mainnet" onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: /calibration/i }));
    expect(onChange).toHaveBeenCalledWith("calibration");
  });

  it("shows emerald dot for mainnet tab", () => {
    const { container } = render(
      <NetworkSwitcher networks={["mainnet", "calibration"]} selected="mainnet" onChange={vi.fn()} />,
    );
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });

  it("shows amber dot for calibration tab", () => {
    const { container } = render(
      <NetworkSwitcher networks={["mainnet", "calibration"]} selected="mainnet" onChange={vi.fn()} />,
    );
    expect(container.querySelector(".bg-amber-500")).toBeInTheDocument();
  });

  it("has role=tablist on the container", () => {
    render(<NetworkSwitcher networks={["mainnet", "calibration"]} selected="mainnet" onChange={vi.fn()} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});
