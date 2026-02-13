import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRESET_OPTIONS, type PresetValue, type TimeWindow } from "@/lib/time-window";
import TimeWindowSelector from "./index";

const defaultTimeWindow: TimeWindow = {
  range: { from: new Date("2025-01-15"), to: undefined },
  preset: "7d",
};

describe("TimeWindowSelector", () => {
  const onDateRangeSelect = vi.fn();
  const onPresetSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderSelector(timeWindow: TimeWindow = defaultTimeWindow) {
    return render(
      <TimeWindowSelector
        timeWindow={timeWindow}
        onDateRangeSelect={onDateRangeSelect}
        onPresetSelect={onPresetSelect}
      />,
    );
  }

  describe("Rendering", () => {
    it("should render the trigger button with preset label", () => {
      renderSelector();
      expect(screen.getByText("Last 7 Days")).toBeInTheDocument();
    });

    it("should render the trigger button with date range label", () => {
      const tw: TimeWindow = {
        range: { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2025-01-31T00:00:00Z") },
        preset: undefined,
      };
      renderSelector(tw);
      expect(screen.getByText(/jan/i)).toBeInTheDocument();
    });

    it("should not show popover content initially", () => {
      renderSelector();
      expect(screen.queryByText("Last Hour")).not.toBeInTheDocument();
    });
  });

  describe("Popover Interaction", () => {
    it("should open popover when trigger is clicked", async () => {
      const user = userEvent.setup();
      renderSelector();

      await user.click(screen.getByRole("button", { name: /last 7 days/i }));

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Last Hour")).toBeInTheDocument();
      expect(screen.getByText("All Time")).toBeInTheDocument();
    });

    it("should render all preset buttons when open", async () => {
      const user = userEvent.setup();
      renderSelector();

      await user.click(screen.getByRole("button", { name: /last 7 days/i }));

      const dialog = screen.getByRole("dialog");
      const presetLabels = PRESET_OPTIONS.map((p) => p.label);

      for (const label of presetLabels) {
        expect(within(dialog).getByRole("button", { name: label })).toBeInTheDocument();
      }
    });

    it("should call onPresetSelect and close popover when a preset is clicked", async () => {
      const user = userEvent.setup();
      renderSelector();

      await user.click(screen.getByRole("button", { name: /last 7 days/i }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Last 30 Days" }));

      expect(onPresetSelect).toHaveBeenCalledWith("30d" as PresetValue);
      expect(onPresetSelect).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("Active Preset Highlighting", () => {
    it("should highlight the currently active preset", async () => {
      const user = userEvent.setup();
      renderSelector({ ...defaultTimeWindow, preset: "30d" });

      await user.click(screen.getByRole("button", { name: /last 30 days/i }));

      const dialog = screen.getByRole("dialog");
      const activeButton = within(dialog).getByRole("button", { name: "Last 30 Days" });
      const inactiveButton = within(dialog).getByRole("button", { name: "Last 7 Days" });

      expect(activeButton).toBeInTheDocument();
      expect(inactiveButton).toBeInTheDocument();
    });
  });
});
