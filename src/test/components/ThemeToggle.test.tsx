import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";

const setTheme = vi.fn();
let resolvedTheme = "dark";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme, setTheme }),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    setTheme.mockClear();
    resolvedTheme = "dark";
  });

  it("renders a button once mounted", async () => {
    render(<ThemeToggle />);
    const button = await screen.findByRole("button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-label", "Switch to light mode");
  });

  it("switches to light when currently dark", async () => {
    render(<ThemeToggle />);
    const button = await screen.findByRole("button", { name: "Switch to light mode" });
    fireEvent.click(button);
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("switches to dark when currently light", async () => {
    resolvedTheme = "light";
    render(<ThemeToggle />);
    const button = await screen.findByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(button);
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
