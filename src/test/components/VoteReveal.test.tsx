import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VoteReveal } from "@/components/room/VoteReveal";
import type { RevealPayload } from "@/lib/session/realtime";

const participants = [
  { user_id: "u1", display_name: "Alice" },
  { user_id: "u2", display_name: "Bob" },
  { user_id: "u3", display_name: "Carol" },
];

function makeReveal(votes: { user_id: string; value: number }[]): RevealPayload {
  const tally: Record<number, number> = {};
  let sum = 0;
  for (const v of votes) {
    tally[v.value] = (tally[v.value] || 0) + 1;
    sum += v.value;
  }
  const sorted = votes.map((v) => v.value).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
  return { tally, average: votes.length ? sum / votes.length : 0, median, votes };
}

describe("VoteReveal", () => {
  it("displays the average", () => {
    const reveal = makeReveal([
      { user_id: "u1", value: 3 },
      { user_id: "u2", value: 5 },
    ]);
    render(<VoteReveal reveal={reveal} participants={participants} />);
    expect(screen.getByText("4.0")).toBeInTheDocument();
    expect(screen.getByText("average")).toBeInTheDocument();
  });

  it("shows each participant name with their vote", () => {
    const reveal = makeReveal([
      { user_id: "u1", value: 3 },
      { user_id: "u2", value: 5 },
    ]);
    render(<VoteReveal reveal={reveal} participants={participants} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("falls back to Unknown for unrecognised user_id", () => {
    const reveal = makeReveal([{ user_id: "unknown-user", value: 2 }]);
    render(<VoteReveal reveal={reveal} participants={participants} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders tally bars for each distinct vote value", () => {
    const reveal = makeReveal([
      { user_id: "u1", value: 1 },
      { user_id: "u2", value: 3 },
      { user_id: "u3", value: 3 },
    ]);
    render(<VoteReveal reveal={reveal} participants={participants} />);
    // Tally bar axis labels show vote values (w-5 span on the left of each row)
    const valueLabels = screen.getAllByText(/^[1-9]$/, { selector: "span.font-mono.text-muted-foreground" });
    const tallyValues = valueLabels.map((el) => Number(el.textContent));
    expect(tallyValues).toContain(1);
    expect(tallyValues).toContain(3);
  });

  it("shows 0.0 average when there are no votes", () => {
    const reveal = makeReveal([]);
    render(<VoteReveal reveal={reveal} participants={participants} />);
    expect(screen.getByText("0.0")).toBeInTheDocument();
  });

  it("displays correct vote count in tally for majority vote", () => {
    const reveal = makeReveal([
      { user_id: "u1", value: 5 },
      { user_id: "u2", value: 5 },
      { user_id: "u3", value: 3 },
    ]);
    render(<VoteReveal reveal={reveal} participants={participants} />);
    // The count "2" should appear somewhere for 5-point votes
    const counts = screen.getAllByText("2");
    expect(counts.length).toBeGreaterThan(0);
  });
});
