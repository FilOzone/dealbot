import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApprovalBadge } from "./ApprovalBadge";

describe("ApprovalBadge", () => {
  it("should render 'Approved' badge when approved is true", () => {
    render(<ApprovalBadge approved={true} />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("should render nothing when approved is false", () => {
    const { container } = render(<ApprovalBadge approved={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
