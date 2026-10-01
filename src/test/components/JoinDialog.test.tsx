import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JoinDialog } from "@/components/room/JoinDialog";

describe("JoinDialog", () => {
  beforeEach(() => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  });

  it("renders the dialog when open=true", () => {
    render(<JoinDialog open={true} onJoin={vi.fn()} loading={false} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("submit button is disabled when name input is empty", () => {
    render(<JoinDialog open={true} onJoin={vi.fn()} loading={false} />);
    expect(screen.getByRole("button", { name: /join/i })).toBeDisabled();
  });

  it("calls onJoin with the trimmed name on submit", () => {
    const onJoin = vi.fn();
    render(<JoinDialog open={true} onJoin={onJoin} loading={false} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Alice  " } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(onJoin).toHaveBeenCalledWith("Alice", null);
  });

  it("saves trimmed name to localStorage on submit", () => {
    render(<JoinDialog open={true} onJoin={vi.fn()} loading={false} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(localStorage.setItem).toHaveBeenCalledWith("pp_display_name", "Alice");
  });

  it("pre-fills the name input from localStorage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue("Bob");
    render(<JoinDialog open={true} onJoin={vi.fn()} loading={false} />);
    expect(screen.getByRole("textbox")).toHaveValue("Bob");
  });

  it("shows Joining... text when loading=true", () => {
    render(<JoinDialog open={true} onJoin={vi.fn()} loading={true} />);
    expect(screen.getByRole("button", { name: /joining/i })).toBeInTheDocument();
  });

  it("does not call onJoin when name is only whitespace", () => {
    const onJoin = vi.fn();
    render(<JoinDialog open={true} onJoin={onJoin} loading={false} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    // Button should remain disabled for whitespace-only input
    expect(screen.getByRole("button", { name: /join/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(onJoin).not.toHaveBeenCalled();
  });

  it("selects an avatar and includes it in onJoin, then deselects it on second click", () => {
    const onJoin = vi.fn();
    render(<JoinDialog open={true} onJoin={onJoin} loading={false} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Alice" } });
    const avatarButton = screen.getAllByRole("button", { name: /select avatar/i })[0];
    fireEvent.click(avatarButton);
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    expect(onJoin).toHaveBeenCalledWith("Alice", avatarButton.textContent);

    fireEvent.click(avatarButton);
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    expect(onJoin).toHaveBeenLastCalledWith("Alice", null);
  });
});
