import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShareLink } from "@/components/room/ShareLink";

describe("ShareLink", () => {
  it("renders the session code", () => {
    render(<ShareLink code="ABC123" />);
    expect(screen.getByText("ABC123")).toBeInTheDocument();
  });
});
