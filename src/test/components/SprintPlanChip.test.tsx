import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SprintPlanChip, capacityStatus } from "@/components/room/SprintPlanChip";

describe("capacityStatus", () => {
  it("returns none when no capacity is set", () => {
    expect(capacityStatus(10, null)).toBe("none");
  });

  it("returns none when capacity is zero or negative", () => {
    expect(capacityStatus(10, 0)).toBe("none");
    expect(capacityStatus(10, -5)).toBe("none");
  });

  it("returns under when below capacity", () => {
    expect(capacityStatus(10, 40)).toBe("under");
  });

  it("returns at when exactly at capacity", () => {
    expect(capacityStatus(40, 40)).toBe("at");
  });

  it("returns over when above capacity", () => {
    expect(capacityStatus(41, 40)).toBe("over");
  });
});

describe("SprintPlanChip", () => {
  const base = {
    count: 3,
    totalPoints: 13,
    capacityPoints: 40,
    unpointedCount: 0,
  };

  it("shows the ticket count and points against capacity", () => {
    render(<SprintPlanChip {...base} />);
    expect(screen.getByTestId("sprint-plan-chip")).toHaveTextContent("Plan: 3 · 13/40 pts");
  });

  it("omits the capacity when none is set", () => {
    render(<SprintPlanChip {...base} capacityPoints={null} />);
    expect(screen.getByTestId("sprint-plan-chip")).toHaveTextContent("Plan: 3 · 13 pts");
  });

  it("renders as a static element when no handler is given", () => {
    render(<SprintPlanChip {...base} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders as a button and fires onClick when a handler is given", () => {
    const onClick = vi.fn();
    render(<SprintPlanChip {...base} onClick={onClick} />);

    const chip = screen.getByRole("button", { name: "Open sprint plan" });
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("warns when the plan contains unpointed tickets", () => {
    render(<SprintPlanChip {...base} unpointedCount={2} />);
    const chip = screen.getByTestId("sprint-plan-chip");
    expect(chip).toHaveTextContent("⚠");
    expect(chip).toHaveAttribute("title", "2 tickets have no points in Jira");
  });

  it("uses singular wording for a single unpointed ticket", () => {
    render(<SprintPlanChip {...base} unpointedCount={1} />);
    expect(screen.getByTestId("sprint-plan-chip")).toHaveAttribute(
      "title",
      "1 ticket has no points in Jira"
    );
  });

  it("applies the over-capacity styling when the total exceeds capacity", () => {
    render(<SprintPlanChip {...base} totalPoints={50} />);
    expect(screen.getByTestId("sprint-plan-chip").className).toContain("red");
  });

  it("applies the at-capacity styling when the total equals capacity", () => {
    render(<SprintPlanChip {...base} totalPoints={40} />);
    expect(screen.getByTestId("sprint-plan-chip").className).toContain("emerald");
  });
});
