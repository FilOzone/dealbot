import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UIVersionToggle from "./index";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("UIVersionToggle", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  describe("Rendering", () => {
    it("should render the toggle with label", () => {
      render(
        <MemoryRouter initialEntries={["/"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      expect(screen.getByText("New UI")).toBeInTheDocument();
      expect(screen.getByRole("switch")).toBeInTheDocument();
    });

    it("should have correct id/class attribute", () => {
      render(
        <MemoryRouter initialEntries={["/"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("id", "ui-toggle");
      expect(toggle).toHaveClass("cursor-pointer");
    });
  });

  describe("Toggle State", () => {
    it("should be unchecked when on old UI route (/)", () => {
      render(
        <MemoryRouter initialEntries={["/"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("data-state", "unchecked");
    });

    it("should be checked when on new UI route (/new)", () => {
      render(
        <MemoryRouter initialEntries={["/new"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("data-state", "checked");
    });

    it("should be checked when on nested new UI route (/new/provider/123)", () => {
      render(
        <MemoryRouter initialEntries={["/new/provider/f01234"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("data-state", "checked");
    });

    it("should be unchecked for routes that don't start with /new", () => {
      render(
        <MemoryRouter initialEntries={["/settings"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("data-state", "unchecked");
    });
  });

  describe("Toggle Interaction", () => {
    it("should navigate to /new when toggled on from old UI", async () => {
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={["/"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      await user.click(toggle);

      expect(mockNavigate).toHaveBeenCalledWith("/new");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("should navigate to / when toggled off from new UI", async () => {
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={["/new"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      await user.click(toggle);

      expect(mockNavigate).toHaveBeenCalledWith("/");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("should navigate to / when toggled off from nested new UI route", async () => {
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={["/new/provider/f01234"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      await user.click(toggle);

      expect(mockNavigate).toHaveBeenCalledWith("/");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("should be keyboard accessible", async () => {
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={["/"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");

      // Verify the switch can receive focus
      await user.tab();
      expect(toggle).toHaveFocus();
    });

    it("should handle keyboard interaction (Space key)", async () => {
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={["/"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      toggle.focus();
      await user.keyboard(" ");

      expect(mockNavigate).toHaveBeenCalledWith("/new");
    });

    it("should handle keyboard interaction (Enter key)", async () => {
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={["/"]}>
          <UIVersionToggle />
        </MemoryRouter>,
      );

      const toggle = screen.getByRole("switch");
      toggle.focus();
      await user.keyboard("{Enter}");

      expect(mockNavigate).toHaveBeenCalledWith("/new");
    });
  });
});
