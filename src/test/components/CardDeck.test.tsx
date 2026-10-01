import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CardDeck } from "@/components/room/CardDeck";

describe("CardDeck", () => {
  it("renders all four card values", () => {
    render(<CardDeck selectedValue={null} onVote={vi.fn()} disabled={false} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("calls onVote with the clicked value", () => {
    const onVote = vi.fn();
    render(<CardDeck selectedValue={null} onVote={onVote} disabled={false} />);
    fireEvent.click(screen.getByText("3"));
    expect(onVote).toHaveBeenCalledWith(3);
  });

  it("disables all cards when disabled=true", () => {
    render(<CardDeck selectedValue={null} onVote={vi.fn()} disabled={true} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it("does not call onVote when disabled", () => {
    const onVote = vi.fn();
    render(<CardDeck selectedValue={null} onVote={onVote} disabled={true} />);
    fireEvent.click(screen.getByText("5"));
    expect(onVote).not.toHaveBeenCalled();
  });

  it("applies selected style to the selected card", () => {
    render(<CardDeck selectedValue={5} onVote={vi.fn()} disabled={false} />);
    const fiveBtn = screen.getByText("5").closest("button");
    // Selected card has border-primary class
    expect(fiveBtn?.className).toContain("border-primary");
  });

  it("all cards are enabled when disabled=false", () => {
    render(<CardDeck selectedValue={null} onVote={vi.fn()} disabled={false} />);
    screen.getAllByRole("button").forEach((btn) => expect(btn).not.toBeDisabled());
  });
});
