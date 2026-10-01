import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { toast } from "sonner";
import { SprintPlanSheet } from "@/components/room/SprintPlanSheet";
import type { SprintPlanPayload } from "@/lib/session/realtime";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * Base UI Dialog/Select rely on pointer events and portals that jsdom can't
 * drive. Replace them with plain elements so the component's own logic is
 * exercised directly (same approach as IssueList.test.tsx).
 */
vi.mock("@/components/ui/sheet", () => {
  return {
    Sheet: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) =>
      open ? (
        <div data-testid="sheet">
          {/* Stands in for the backdrop/Esc dismissal Base UI would wire up. */}
          <button data-testid="dismiss" onClick={() => onOpenChange?.(false)}>
            dismiss
          </button>
          {children}
        </div>
      ) : null,
    SheetContent: ({
      children,
      showCloseButton = true,
    }: {
      children: React.ReactNode;
      showCloseButton?: boolean;
    }) => <div data-close-button={String(showCloseButton)}>{children}</div>,
    SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
    SheetTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SheetClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/components/ui/select", () => {
  function Select({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) {
    // The aria-label lives on SelectTrigger in the real component; hoist it
    // onto the native select so tests can target each dropdown by name.
    // Also render SelectValue's formatter so the trigger label is asserted
    // (Base UI shows the raw value unless a formatter is supplied).
    let label: string | undefined;
    let valueLabel: React.ReactNode = null;
    React.Children.forEach(
      children as React.ReactElement<Record<string, unknown>> | React.ReactElement<Record<string, unknown>>[],
      (child: React.ReactElement<Record<string, unknown>>) => {
        const childLabel = child?.props?.["aria-label"];
        if (typeof childLabel === "string") label = childLabel;

        React.Children.forEach(
          child?.props?.children as
            | React.ReactElement<Record<string, unknown>>
            | React.ReactElement<Record<string, unknown>>[],
          (grandchild: React.ReactElement<Record<string, unknown>>) => {
            const render = grandchild?.props?.children;
            if (typeof render === "function") valueLabel = render(value ?? "");
          }
        );
      }
    );
    return (
      <>
        <span data-testid="select-value">{valueLabel}</span>
        <select
          aria-label={label}
          data-testid="select"
          value={value ?? ""}
          onChange={(e) => onValueChange?.(e.target.value)}
        >
          <option value="" />
          {children}
        </select>
      </>
    );
  }
  function SelectTrigger() {
    return null;
  }
  function SelectValue() {
    return null;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  function SelectItem({ children, value }: { children: React.ReactNode; value: string }) {
    const text = React.Children.toArray(children)
      .map((c: React.ReactNode) =>
        typeof c === "string" || typeof c === "number" ? String(c) : ""
      )
      .join("");
    return <option value={value}>{text}</option>;
  }
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

const itemBase = { assignee_account_id: null, origin: "added" as const, removed: false };
const NO_DESTINATION = { board_id: null, sprint_id: null, sprint_name: null };

const plan: SprintPlanPayload = {
  items: [
    { issue_key: "PROJ-1", summary: "First ticket", points: 3, position: 0, ...itemBase },
    { issue_key: "PROJ-2", summary: "Second ticket", points: null, position: 1, ...itemBase },
  ],
  teammates: [],
  capacity_points: 40,
  total_points: 3,
  unpointed_count: 1,
  destination: NO_DESTINATION,
  pending_removals: [],
};

const emptyPlan: SprintPlanPayload = {
  items: [],
  teammates: [],
  capacity_points: null,
  total_points: 0,
  unpointed_count: 0,
  destination: NO_DESTINATION,
  pending_removals: [],
};

function makeProps(overrides: Partial<React.ComponentProps<typeof SprintPlanSheet>> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    sessionCode: "ABC123",
    plan,
    onPlanChange: vi.fn(),
    ...overrides,
  };
}

/** fetch mock that answers the board list and then anything else with `rest`. */
function mockFetch(rest: unknown = plan, ok = true) {
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url === "/api/jira/sprints") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ boards: [{ id: 1, name: "Team Board", type: "scrum" }] }),
      });
    }
    if (typeof url === "string" && url.startsWith("/api/jira/sprints?boardId=")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ sprints: [{ id: 10, name: "Sprint 10", state: "future" }] }),
      });
    }
    return Promise.resolve({ ok, json: async () => rest });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = mockFetch();
});

/**
 * Render and flush the board-list fetch the sheet kicks off on open, so the
 * resulting state update doesn't land outside act().
 */
async function renderSheet(props: React.ComponentProps<typeof SprintPlanSheet>) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<SprintPlanSheet {...props} />);
  });
  return result;
}

/**
 * The sheet splits config and content across tabs, and Base UI only mounts the
 * active panel — so a test must first switch to the tab holding what it asserts
 * on. Landing tab is Setup until a destination sprint is chosen, then Plan.
 */
function showTab(name: "Plan" | "Setup") {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));
}

const showPlan = () => showTab("Plan");
const showSetup = () => showTab("Setup");

describe("SprintPlanSheet", () => {
  it("renders nothing when closed", async () => {
    await renderSheet(makeProps({ open: false }));
    expect(screen.queryByTestId("sheet")).not.toBeInTheDocument();
  });

  it("lists the plan items with their points", async () => {
    await renderSheet(makeProps());
    showPlan();
    expect(screen.getByText("PROJ-1")).toBeInTheDocument();
    expect(screen.getByText("First ticket")).toBeInTheDocument();
    expect(screen.getByText("3pt")).toBeInTheDocument();
  });

  it("flags unpointed tickets and warns on the total", async () => {
    await renderSheet(makeProps());
    showPlan();
    expect(screen.getByText("unpointed")).toBeInTheDocument();
    expect(
      screen.getByText(/1 unpointed ticket counted as 0/)
    ).toBeInTheDocument();
  });

  it("shows the running total against capacity and the remaining points", async () => {
    await renderSheet(makeProps());
    expect(screen.getByText("3/40 pts")).toBeInTheDocument();
    expect(screen.getByText("37 pts remaining")).toBeInTheDocument();
  });

  it("shows an over-capacity warning when the total exceeds capacity", async () => {
    await renderSheet(
      makeProps({ plan: { ...plan, total_points: 45, capacity_points: 40 } })
    );
    expect(screen.getByText("5 pts over capacity")).toBeInTheDocument();
  });

  it("hides the progress bar when no capacity is set", async () => {
    await renderSheet(makeProps({ plan: emptyPlan }));
    expect(screen.queryByTestId("capacity-bar")).not.toBeInTheDocument();
    expect(screen.getByText("0 pts")).toBeInTheDocument();
  });

  it("shows an empty-state message with no items", async () => {
    await renderSheet(makeProps({ plan: emptyPlan }));
    showPlan();
    expect(screen.getByText(/No tickets in the plan yet/)).toBeInTheDocument();
  });

  it("saves the capacity target and reports the new plan", async () => {
    const onPlanChange = vi.fn();
    const updated = { ...plan, capacity_points: 25 };
    global.fetch = mockFetch(updated);

    await renderSheet(makeProps({ onPlanChange }));

    fireEvent.change(screen.getByLabelText("Capacity in points"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onPlanChange).toHaveBeenCalledWith(updated));
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => u === "/api/sessions/ABC123/plan"
    );
    expect(JSON.parse(call![1].body)).toEqual({ capacity_points: 25 });
    expect(toast.success).toHaveBeenCalledWith("Capacity updated");
  });

  it("sends null when the capacity field is cleared", async () => {
    await renderSheet(makeProps());

    fireEvent.change(screen.getByLabelText("Capacity in points"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([u]) => u === "/api/sessions/ABC123/plan"
      );
      expect(JSON.parse(call![1].body)).toEqual({ capacity_points: null });
    });
  });

  it("rejects a negative capacity without calling the API", async () => {
    await renderSheet(makeProps());

    fireEvent.change(screen.getByLabelText("Capacity in points"), {
      target: { value: "-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(toast.error).toHaveBeenCalledWith("Capacity must be a non-negative number");
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => u === "/api/sessions/ABC123/plan"
    );
    expect(call).toBeUndefined();
  });

  it("surfaces an error when saving capacity fails", async () => {
    global.fetch = mockFetch({ error: "denied" }, false);
    await renderSheet(makeProps());

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("denied"));
  });

  it("refreshes totals from Jira", async () => {
    const onPlanChange = vi.fn();
    await renderSheet(makeProps({ onPlanChange }));

    fireEvent.click(screen.getByRole("button", { name: "Refresh totals" }));

    await waitFor(() => expect(onPlanChange).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => u === "/api/sessions/ABC123/plan"
    );
    expect(JSON.parse(call![1].body)).toEqual({ refresh: true });
  });

  it("disables Refresh totals when the plan is empty", async () => {
    await renderSheet(makeProps({ plan: emptyPlan }));
    expect(screen.getByRole("button", { name: "Refresh totals" })).toBeDisabled();
  });

  it("removes a ticket from the plan", async () => {
    const onPlanChange = vi.fn();
    await renderSheet(makeProps({ onPlanChange }));
    showPlan();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove PROJ-1 from sprint plan" })
    );

    await waitFor(() => expect(onPlanChange).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("/plan/PROJ-1")
    );
    expect(call![1].method).toBe("DELETE");
  });

  it("surfaces an error when removal fails", async () => {
    global.fetch = mockFetch({ error: "nope" }, false);
    await renderSheet(makeProps());
    showPlan();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove PROJ-1 from sprint plan" })
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope"));
  });

  it("disables commit until a destination is chosen", async () => {
    await renderSheet(makeProps());
    expect(screen.getByRole("button", { name: "Move tickets to sprint" })).toBeDisabled();
  });

  it("commits the plan into an existing sprint after confirmation", async () => {
    const onPlanChange = vi.fn();
    global.fetch = mockFetch({
      sprint_id: 10,
      sprint_name: "Sprint 10",
      moved: ["PROJ-1", "PROJ-2"],
      failed: [],
      plan: emptyPlan,
    });

    await renderSheet(makeProps({ onPlanChange }));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Team Board" })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "1" } });

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Sprint 10/ })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Target sprint"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "Move tickets to sprint" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm — move 2/ }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("2 tickets moved to Sprint 10")
    );

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("/plan/commit")
    );
    expect(JSON.parse(call![1].body)).toEqual({ sprint_id: 10 });
    expect(onPlanChange).toHaveBeenCalledWith(emptyPlan);
    expect(screen.getByText("2 tickets moved to Sprint 10")).toBeInTheDocument();
  });

  it("creates a new sprint when that destination is selected", async () => {
    global.fetch = mockFetch({
      sprint_id: 11,
      sprint_name: "Sprint 11",
      moved: ["PROJ-1"],
      failed: [],
      plan: emptyPlan,
    });

    await renderSheet(makeProps());

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Team Board" })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Destination type"), {
      target: { value: "new" },
    });
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("New sprint name"), {
      target: { value: "Sprint 11" },
    });
    fireEvent.change(screen.getByLabelText("Sprint start date"), {
      target: { value: "2026-01-01" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Move tickets to sprint" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm — move 2/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("/plan/commit")
    );
    const body = JSON.parse(call![1].body);
    expect(body.board_id).toBe(1);
    expect(body.name).toBe("Sprint 11");
    expect(body.start_date).toContain("2026-01-01");
  });

  it("reports partial failures and keeps the failed tickets", async () => {
    global.fetch = mockFetch({
      sprint_id: 10,
      sprint_name: "Sprint 10",
      moved: ["PROJ-1"],
      failed: ["PROJ-2"],
      plan: { ...plan, items: [plan.items[1]], total_points: 0 },
    });

    await renderSheet(makeProps());

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Team Board" })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "1" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Sprint 10/ })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Target sprint"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "Move tickets to sprint" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "1 moved, 1 failed — failed tickets kept in the plan"
      )
    );
  });

  it("can cancel out of the confirmation step", async () => {
    await renderSheet(makeProps());

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Team Board" })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "1" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Sprint 10/ })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Target sprint"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "Move tickets to sprint" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Move tickets to sprint" })).toBeInTheDocument();
  });

  it("surfaces an error when the commit fails", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/jira/sprints") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ boards: [{ id: 1, name: "Team Board", type: "scrum" }] }),
        });
      }
      if (url.startsWith("/api/jira/sprints?boardId=")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ sprints: [{ id: 10, name: "Sprint 10", state: "future" }] }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: "Jira API 403" }) });
    });

    await renderSheet(makeProps());

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Team Board" })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "1" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Sprint 10/ })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Target sprint"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "Move tickets to sprint" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Jira API 403"));
  });

  it("surfaces an error when the board list fails to load", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: "no boards" }) });

    await renderSheet(makeProps());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("no boards"));
  });

  it("keeps the commit button available (rather than swapping it out) after a commit", async () => {
    global.fetch = mockFetch({
      sprint_id: 10,
      sprint_name: "Sprint 10",
      moved: ["PROJ-1"],
      failed: [],
      plan: emptyPlan,
    });

    await renderSheet(makeProps());

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Team Board" })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "1" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Sprint 10/ })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Target sprint"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "Move tickets to sprint" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    await waitFor(() =>
      expect(screen.getByText(/moved to Sprint 10/)).toBeInTheDocument()
    );
    // The commit button stays put (rather than turning into "Plan another
    // sprint") so it's clear the host can keep making changes.
    expect(screen.getByRole("button", { name: "Move tickets to sprint" })).toBeInTheDocument();
  });

  describe("read-only (guest) mode", () => {
    it("shows the ticket list and the capacity progress bar", async () => {
      await renderSheet(makeProps({ readOnly: true }));
    showPlan();

      expect(screen.getByText("PROJ-1")).toBeInTheDocument();
      expect(screen.getByText("First ticket")).toBeInTheDocument();
      expect(screen.getByText("3/40 pts")).toBeInTheDocument();
      expect(screen.getByTestId("capacity-bar")).toBeInTheDocument();
    });

    it("hides every host-only control", async () => {
      await renderSheet(makeProps({ readOnly: true }));

      expect(screen.queryByLabelText("Capacity in points")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Refresh totals" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Remove PROJ-1/ })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Move tickets to sprint" })
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Board")).not.toBeInTheDocument();
    });

    it("does not fetch the board list", async () => {
      await renderSheet(makeProps({ readOnly: true }));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("shows a guest-specific empty state", async () => {
      await renderSheet(makeProps({ readOnly: true, plan: emptyPlan }));
    showPlan();
      expect(
        screen.getByText(/The host hasn't added any tickets to the plan yet/)
      ).toBeInTheDocument();
    });

    it("hides the close button and ignores dismissal attempts", async () => {
      const onOpenChange = vi.fn();
      const { container } = await renderSheet(makeProps({ readOnly: true, onOpenChange }));

      expect(container.querySelector("[data-close-button='false']")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("dismiss"));

      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByTestId("sheet")).toBeInTheDocument();
    });

    it("still lets the host dismiss their own sheet", async () => {
      const onOpenChange = vi.fn();
      const { container } = await renderSheet(makeProps({ onOpenChange }));

      expect(container.querySelector("[data-close-button='true']")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("dismiss"));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

const roster: SprintPlanPayload["teammates"] = [
  {
    account_id: "acc-1",
    display_name: "Alice",
    email: "alice@example.com",
    avatar_url: null,
    capacity_points: 5,
    position: 0,
  },
  {
    account_id: "acc-2",
    display_name: "Bob",
    email: null,
    avatar_url: null,
    capacity_points: null,
    position: 1,
  },
];

const plannedWithRoster: SprintPlanPayload = {
  ...plan,
  teammates: roster,
  items: [
    { ...plan.items[0], assignee_account_id: "acc-1" },
    { ...plan.items[1], assignee_account_id: null },
  ],
};

describe("SprintPlanSheet — collapsible assignee groups", () => {
  const grouped: SprintPlanPayload = {
    ...plannedWithRoster,
    destination: { board_id: 1, sprint_id: 10, sprint_name: "Sprint 10" },
    teammates: roster,
    items: [
      { ...plan.items[0], assignee_account_id: "acc-1" },
      { ...plan.items[1], assignee_account_id: null },
    ],
  };

  it("shows a group's tickets by default", async () => {
    await renderSheet(makeProps({ plan: grouped }));
    showPlan();

    expect(screen.getByText("PROJ-1")).toBeInTheDocument();
    expect(screen.getByTestId("group-toggle-acc-1")).toHaveAttribute("aria-expanded", "true");
  });

  it("hides a group's tickets when the header is clicked", async () => {
    await renderSheet(makeProps({ plan: grouped }));
    showPlan();

    fireEvent.click(screen.getByTestId("group-toggle-acc-1"));

    expect(screen.queryByText("PROJ-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("group-toggle-acc-1")).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the capacity readout visible while collapsed", async () => {
    await renderSheet(makeProps({ plan: grouped }));
    showPlan();

    fireEvent.click(screen.getByTestId("group-toggle-acc-1"));

    // The whole point of collapsing is to keep the summary and lose the detail.
    expect(screen.getByTestId("group-capacity-acc-1")).toHaveTextContent("3/5 pts");
    expect(screen.getByTestId("group-remaining-acc-1")).toHaveTextContent("2 pts free");
  });

  it("expands the group again on a second click", async () => {
    await renderSheet(makeProps({ plan: grouped }));
    showPlan();

    const toggle = screen.getByTestId("group-toggle-acc-1");
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.getByText("PROJ-1")).toBeInTheDocument();
  });

  it("collapses only the group that was clicked", async () => {
    await renderSheet(makeProps({ plan: grouped }));
    showPlan();

    fireEvent.click(screen.getByTestId("group-toggle-acc-1"));

    // PROJ-2 lives in the unassigned group and must be unaffected.
    expect(screen.getByText("PROJ-2")).toBeInTheDocument();
  });

  it("hides the empty-group placeholder when collapsed", async () => {
    await renderSheet(
      makeProps({
        plan: { ...grouped, teammates: [roster[0], { ...roster[1], capacity_points: 8 }] },
      })
    );
    showPlan();

    fireEvent.click(screen.getByTestId("group-toggle-acc-2"));

    expect(screen.queryByText("No tickets assigned yet.")).not.toBeInTheDocument();
  });

  it("lets guests collapse groups too", async () => {
    await renderSheet(makeProps({ plan: grouped, readOnly: true }));
    showPlan();

    fireEvent.click(screen.getByTestId("group-toggle-acc-1"));

    expect(screen.queryByText("PROJ-1")).not.toBeInTheDocument();
  });
});

describe("SprintPlanSheet — per-teammate capacity on the plan tab", () => {
  const overloaded: SprintPlanPayload = {
    ...plannedWithRoster,
    items: [
      { ...plan.items[0], assignee_account_id: "acc-1", points: 8 },
      { ...plan.items[1], assignee_account_id: null },
    ],
  };

  it("shows each teammate's total against their own capacity", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster }));
    showPlan();

    expect(screen.getByTestId("group-capacity-acc-1")).toHaveTextContent("3/5 pts");
  });

  it("shows how much room a teammate still has", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster }));
    showPlan();

    expect(screen.getByTestId("group-remaining-acc-1")).toHaveTextContent("2 pts free");
  });

  it("flags a teammate who is over their capacity", async () => {
    await renderSheet(makeProps({ plan: overloaded }));
    showPlan();

    const remaining = screen.getByTestId("group-remaining-acc-1");
    expect(remaining).toHaveTextContent("3 pts over capacity");
    expect(remaining.className).toContain("text-red-600");
    expect(screen.getByTestId("group-bar-acc-1").className).toContain("bg-red-500");
  });

  it("marks a teammate who is exactly at capacity", async () => {
    await renderSheet(
      makeProps({
        plan: {
          ...plannedWithRoster,
          items: [
            { ...plan.items[0], assignee_account_id: "acc-1", points: 5 },
            { ...plan.items[1], assignee_account_id: null },
          ],
        },
      })
    );
    showPlan();

    expect(screen.getByTestId("group-remaining-acc-1")).toHaveTextContent("At capacity");
    expect(screen.getByTestId("group-bar-acc-1").className).toContain("bg-emerald-500");
  });

  it("caps the per-teammate bar at 100%", async () => {
    await renderSheet(makeProps({ plan: overloaded }));
    showPlan();

    expect(screen.getByTestId("group-bar-acc-1")).toHaveStyle({ width: "100%" });
  });

  it("omits the capacity bar for a teammate with no per-person target", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster }));
    showPlan();

    // Bob has no target, and neither does the unassigned bucket.
    expect(screen.queryByTestId("group-bar-acc-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-remaining-__unassigned__")).not.toBeInTheDocument();
    expect(screen.getByTestId("group-capacity-__unassigned__")).toHaveTextContent("0 pts");
  });

  it("keeps a teammate with capacity but no tickets visible", async () => {
    await renderSheet(
      makeProps({
        plan: {
          ...plannedWithRoster,
          teammates: [roster[0], { ...roster[1], capacity_points: 8 }],
        },
      })
    );
    showPlan();

    const group = screen.getByTestId("plan-group-acc-2");
    expect(group).toBeInTheDocument();
    expect(within(group).getByText("No tickets assigned yet.")).toBeInTheDocument();
  });

  it("shows the empty-plan message instead of empty groups when nothing is planned", async () => {
    await renderSheet(makeProps({ plan: emptyPlan }));
    showPlan();

    expect(screen.getByText(/No tickets in the plan yet/)).toBeInTheDocument();
  });

  it("prefers the empty-plan message over a roster of empty groups", async () => {
    await renderSheet(
      makeProps({ plan: { ...emptyPlan, teammates: roster } })
    );
    showPlan();

    // Nothing to plan yet — guidance beats a column of zeroes.
    expect(screen.getByText(/No tickets in the plan yet/)).toBeInTheDocument();
    expect(screen.queryByTestId("plan-group-acc-1")).not.toBeInTheDocument();
  });

  it("shows the per-teammate readout to guests as well", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster, readOnly: true }));
    showPlan();

    expect(screen.getByTestId("group-capacity-acc-1")).toHaveTextContent("3/5 pts");
  });
});

describe("SprintPlanSheet — teammates", () => {
  it("renders the roster with each teammate's assigned total against capacity", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster }));

    expect(screen.getByText("Teammates")).toBeInTheDocument();
    // "Alice" also appears as her ticket-group heading, so scope to the roster row.
    expect(within(screen.getByTestId("teammate-acc-1")).getByText("Alice")).toBeInTheDocument();
    // PROJ-1 (3 pts) is assigned to Alice, whose capacity is 5.
    expect(screen.getByText("3/5 pts")).toBeInTheDocument();
    // Bob has no capacity target, so only his total is shown.
    expect(screen.getByText("0 pts")).toBeInTheDocument();
  });

  it("flags a teammate who is over their individual capacity", async () => {
    const overloaded: SprintPlanPayload = {
      ...plannedWithRoster,
      teammates: [{ ...roster[0], capacity_points: 1 }, roster[1]],
    };
    await renderSheet(makeProps({ plan: overloaded }));

    const badge = screen.getByText("3/1 pts");
    expect(badge.className).toMatch(/red/);
  });

  it("prompts the host to build a roster when it is empty", async () => {
    await renderSheet(makeProps());
    expect(screen.getByText(/Search for people in Jira/i)).toBeInTheDocument();
  });

  it("searches Jira and adds the selected user to the roster", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onPlanChange = vi.fn();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/jira/users")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            users: [
              {
                accountId: "acc-9",
                displayName: "Carol",
                emailAddress: "carol@example.com",
                active: true,
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => plannedWithRoster });
    });

    await renderSheet(makeProps({ onPlanChange }));

    fireEvent.change(screen.getByLabelText("Search Jira users"), {
      target: { value: "carol" },
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    const result = await screen.findByText("Carol");
    await act(async () => {
      fireEvent.click(result);
    });

    const addCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => u === "/api/sessions/ABC123/plan/teammates"
    );
    expect(addCall).toBeTruthy();
    expect(JSON.parse(addCall![1].body)).toEqual({
      account_id: "acc-9",
      display_name: "Carol",
      email: "carol@example.com",
      avatar_url: null,
    });
    expect(onPlanChange).toHaveBeenCalledWith(plannedWithRoster);

    vi.useRealTimers();
  });

  it("surfaces a Jira user-search failure as a toast", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/jira/users")) {
        return Promise.resolve({ ok: false, json: async () => ({ error: "no permission" }) });
      }
      return Promise.resolve({ ok: true, json: async () => plan });
    });

    await renderSheet(makeProps());

    fireEvent.change(screen.getByLabelText("Search Jira users"), {
      target: { value: "carol" },
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("no permission"));
    vi.useRealTimers();
  });

  it("removes a teammate", async () => {
    const onPlanChange = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => emptyPlan });

    await renderSheet(makeProps({ plan: plannedWithRoster, onPlanChange }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove Alice from sprint roster"));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/sessions/ABC123/plan/teammates/acc-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(onPlanChange).toHaveBeenCalledWith(emptyPlan);
  });

  it("saves a teammate's individual capacity on blur", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => plannedWithRoster });

    await renderSheet(makeProps({ plan: plannedWithRoster }));

    const input = screen.getByLabelText("Capacity for Bob");
    fireEvent.change(input, { target: { value: "8" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    const patchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => init?.method === "PATCH"
    );
    expect(JSON.parse(patchCall![1].body)).toEqual({
      account_id: "acc-2",
      capacity_points: 8,
    });
  });

  it("keeps the typed capacity visible while the save is in flight", async () => {
    // The bug: clearing the draft before the round-trip made the input fall
    // back to the stale prop, so the number blanked out and then reappeared.
    let release!: (v: unknown) => void;
    const inFlight = new Promise((r) => {
      release = r;
    });
    global.fetch = vi.fn().mockImplementation((_url: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") {
        return inFlight.then(() => ({ ok: true, json: async () => plannedWithRoster }));
      }
      return Promise.resolve({ ok: true, json: async () => plannedWithRoster });
    });

    await renderSheet(makeProps({ plan: plannedWithRoster }));

    const input = screen.getByLabelText("Capacity for Bob") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.blur(input);

    // Mid-flight: still 8, never "" or the old value.
    expect(input.value).toBe("8");
    expect(
      within(screen.getByTestId("teammate-acc-2")).getByText(/\/8 pts$/)
    ).toBeInTheDocument();

    await act(async () => {
      release(null);
      await inFlight;
    });
  });

  it("rejects a negative teammate capacity without calling the API", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => plannedWithRoster });

    await renderSheet(makeProps({ plan: plannedWithRoster }));

    const input = screen.getByLabelText("Capacity for Bob");
    fireEvent.change(input, { target: { value: "-2" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(toast.error).toHaveBeenCalledWith("Capacity must be a non-negative number");
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        ([, init]) => init?.method === "PATCH"
      )
    ).toBe(false);
  });

  it("persists the roster to localStorage after a mutation", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => plannedWithRoster });

    await renderSheet(makeProps({ plan: plannedWithRoster }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove Alice from sprint roster"));
    });

    const stored = JSON.parse(localStorage.getItem("pp_sprint_teammates") ?? "[]");
    expect(stored.map((t: { account_id: string }) => t.account_id)).toEqual([
      "acc-1",
      "acc-2",
    ]);
  });
});

describe("SprintPlanSheet — assignment", () => {
  it("groups tickets by assignee with an unassigned bucket", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster }));
    showPlan();

    expect(screen.getByTestId("plan-group-acc-1")).toBeInTheDocument();
    expect(screen.getByTestId("plan-group-__unassigned__")).toBeInTheDocument();
    // Bob has no tickets, but every teammate stays on screen.
    expect(screen.getByTestId("plan-group-acc-2")).toBeInTheDocument();
  });

  it("hides the unassigned bucket when everything is assigned", async () => {
    await renderSheet(
      makeProps({
        plan: {
          ...plannedWithRoster,
          items: plannedWithRoster.items.map((i) => ({
            ...i,
            assignee_account_id: "acc-1",
          })),
        },
      })
    );
    showPlan();

    expect(screen.queryByTestId("plan-group-__unassigned__")).not.toBeInTheDocument();
  });

  it("keeps a teammate with no tickets and no capacity target visible", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster }));
    showPlan();

    const bob = screen.getByTestId("plan-group-acc-2");
    expect(within(bob).getByText("Bob")).toBeInTheDocument();
    expect(within(bob).getByText("No tickets assigned yet.")).toBeInTheDocument();
  });

  it("labels the assignee trigger with the display name, not the accountId", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster }));
    showPlan();

    const labels = screen.getAllByTestId("select-value").map((n) => n.textContent);
    expect(labels).toContain("Alice");
    expect(labels).toContain("Unassigned");
    expect(labels.join(" ")).not.toContain("acc-1");
  });

  it("assigns a ticket to a teammate", async () => {
    const onPlanChange = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => plannedWithRoster });

    await renderSheet(makeProps({ plan: plannedWithRoster, onPlanChange }));
    showPlan();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Assignee for PROJ-2"), {
        target: { value: "acc-2" },
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/sessions/ABC123/plan/PROJ-2",
      expect.objectContaining({ method: "PATCH" })
    );
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => u === "/api/sessions/ABC123/plan/PROJ-2"
    )!;
    expect(JSON.parse(init.body)).toEqual({ assignee_account_id: "acc-2" });
    expect(onPlanChange).toHaveBeenCalledWith(plannedWithRoster);
  });

  it("sends null when a ticket is unassigned", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => plannedWithRoster });

    await renderSheet(makeProps({ plan: plannedWithRoster }));
    showPlan();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Assignee for PROJ-1"), {
        target: { value: "__unassigned__" },
      });
    });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => u === "/api/sessions/ABC123/plan/PROJ-1"
    )!;
    expect(JSON.parse(init.body)).toEqual({ assignee_account_id: null });
  });

  it("toasts when assignment fails", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/plan/PROJ-2")) {
        return Promise.resolve({ ok: false, json: async () => ({ error: "not on roster" }) });
      }
      return Promise.resolve({ ok: true, json: async () => plannedWithRoster });
    });

    await renderSheet(makeProps({ plan: plannedWithRoster }));
    showPlan();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Assignee for PROJ-2"), {
        target: { value: "acc-2" },
      });
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("not on roster"));
  });

  it("hides the assignee control when the roster is empty", async () => {
    await renderSheet(makeProps());
    expect(screen.queryByLabelText("Assignee for PROJ-1")).not.toBeInTheDocument();
  });
});

describe("SprintPlanSheet — read-only teammates", () => {
  it("shows the roster and totals to guests", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster, readOnly: true }));
    expect(within(screen.getByTestId("teammate-acc-1")).getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("3/5 pts")).toBeInTheDocument();
  });

  it("never calls the Jira user-search endpoint for guests", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster, readOnly: true }));

    expect(screen.queryByLabelText("Search Jira users")).not.toBeInTheDocument();
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        ([u]) => typeof u === "string" && u.startsWith("/api/jira/users")
      )
    ).toBe(false);
  });

  it("offers guests no roster or assignment controls", async () => {
    await renderSheet(makeProps({ plan: plannedWithRoster, readOnly: true }));

    expect(
      screen.queryByLabelText("Remove Alice from sprint roster")
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Capacity for Bob")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assignee for PROJ-1")).not.toBeInTheDocument();
  });

  it("tells guests when the host has no teammates yet", async () => {
    await renderSheet(makeProps({ readOnly: true }));
    expect(screen.getByText(/hasn't added any teammates/i)).toBeInTheDocument();
  });
});

describe("SprintPlanSheet — refresh on open", () => {
  const withDestination: SprintPlanPayload = {
    ...plan,
    destination: { board_id: 1, sprint_id: 10, sprint_name: "Sprint 10" },
  };

  function destinationCalls() {
    return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([u]) => typeof u === "string" && u.includes("/plan/destination")
    );
  }

  it("re-pulls the destination sprint's contents when the sheet opens", async () => {
    const fresh = { ...withDestination, total_points: 21 };
    global.fetch = mockFetch(fresh);
    const onPlanChange = vi.fn();

    await renderSheet(makeProps({ plan: withDestination, onPlanChange }));

    await waitFor(() => expect(destinationCalls()).toHaveLength(1));
    const [, init] = destinationCalls()[0];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      board_id: 1,
      sprint_id: 10,
      sprint_name: "Sprint 10",
    });
    await waitFor(() => expect(onPlanChange).toHaveBeenCalledWith(fresh));
  });

  it("does not sync when no destination sprint is chosen", async () => {
    await renderSheet(makeProps({ plan }));

    expect(destinationCalls()).toHaveLength(0);
  });

  it("does not sync for guests", async () => {
    await renderSheet(makeProps({ plan: withDestination, readOnly: true }));

    // Guests have no Jira credentials, and the route is facilitator-only.
    expect(destinationCalls()).toHaveLength(0);
  });

  it("does not sync while the sheet is closed", async () => {
    await renderSheet(makeProps({ plan: withDestination, open: false }));

    expect(destinationCalls()).toHaveLength(0);
  });

  it("shows a syncing hint while the refresh is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      release = r;
    });
    const base = mockFetch(withDestination);
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/plan/destination")) {
        return pending.then(() => ({ ok: true, json: async () => withDestination }));
      }
      return base(url, init);
    });

    await renderSheet(makeProps({ plan: withDestination }));

    expect(screen.getByTestId("plan-syncing")).toBeInTheDocument();

    await act(async () => {
      release(null);
    });

    await waitFor(() =>
      expect(screen.queryByTestId("plan-syncing")).not.toBeInTheDocument()
    );
  });

  it("keeps the last known plan when the sync fails", async () => {
    global.fetch = mockFetch({ error: "Jira unavailable" }, false);
    const onPlanChange = vi.fn();

    await renderSheet(makeProps({ plan: withDestination, onPlanChange }));

    await waitFor(() => expect(destinationCalls()).toHaveLength(1));
    // A stale plan beats an error wall.
    expect(onPlanChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("plan-totals")).toBeInTheDocument();
  });
});

describe("SprintPlanSheet — destination sprint contents", () => {
  const planWithSprintTickets: SprintPlanPayload = {
    ...plan,
    items: [
      {
        issue_key: "PROJ-1",
        summary: "Carried over",
        points: 8,
        position: 0,
        ...itemBase,
        origin: "sprint",
      },
      { issue_key: "PROJ-2", summary: "Newly queued", points: 3, position: 1, ...itemBase },
    ],
    total_points: 11,
    unpointed_count: 0,
    destination: { board_id: 1, sprint_id: 10, sprint_name: "Sprint 10" },
  };

  it("badges tickets that are already in the destination sprint", async () => {
    await renderSheet(makeProps({ plan: planWithSprintTickets }));

    expect(screen.getByTestId("in-sprint-PROJ-1")).toBeInTheDocument();
    expect(screen.queryByTestId("in-sprint-PROJ-2")).not.toBeInTheDocument();
  });

  it("only offers to move the tickets that aren't in the sprint yet", async () => {
    await renderSheet(makeProps({ plan: planWithSprintTickets }));

    fireEvent.click(screen.getByRole("button", { name: "Move tickets to sprint" }));
    // PROJ-1 is already there, so only PROJ-2 is counted.
    expect(screen.getByRole("button", { name: /Confirm — move 1$/ })).toBeInTheDocument();
  });

  it("lets a re-assignment on an already-in-sprint ticket be committed even though nothing needs to move", async () => {
    const onlySprintOrigin: SprintPlanPayload = {
      ...planWithSprintTickets,
      items: [
        {
          issue_key: "PROJ-1",
          summary: "Carried over",
          points: 8,
          position: 0,
          ...itemBase,
          origin: "sprint",
          assignee_account_id: "acc-1",
        },
      ],
      total_points: 8,
    };

    await renderSheet(makeProps({ plan: onlySprintOrigin }));

    const commitButton = screen.getByRole("button", { name: "Sync assignee changes" });
    expect(commitButton).not.toBeDisabled();

    fireEvent.click(commitButton);
    expect(
      screen.getByRole("button", { name: "Confirm — sync assignee changes" })
    ).toBeInTheDocument();
  });

  it("persists the destination when a sprint is selected", async () => {
    const onPlanChange = vi.fn();
    global.fetch = mockFetch(planWithSprintTickets);

    await renderSheet(makeProps({ onPlanChange }));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Team Board" })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "1" } });

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Sprint 10/ })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Target sprint"), { target: { value: "10" } });

    await waitFor(() => expect(onPlanChange).toHaveBeenCalledWith(planWithSprintTickets));

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([u]) => typeof u === "string" && u.includes("/plan/destination"))
      .at(-1);
    expect(call![1].method).toBe("PUT");
    expect(JSON.parse(call![1].body)).toEqual({
      board_id: 1,
      sprint_id: 10,
      sprint_name: "Sprint 10",
    });
  });

  it("clears the destination sprint when switching to a new sprint", async () => {
    global.fetch = mockFetch(plan);

    await renderSheet(makeProps({ plan: planWithSprintTickets }));
    showSetup();

    fireEvent.change(screen.getByLabelText("Destination type"), {
      target: { value: "new" },
    });

    await waitFor(() => {
      // Last, not first: opening the sheet fires an auto-sync PUT of its own.
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([u]) => typeof u === "string" && u.includes("/plan/destination")
      );
      // Creating a sprint has no existing tickets, so they're dropped.
      expect(JSON.parse(calls[calls.length - 1]![1].body).sprint_id).toBeNull();
    });
  });

  it("surfaces a destination failure and reverts the selection", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/jira/sprints") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ boards: [{ id: 1, name: "Team Board", type: "scrum" }] }),
        });
      }
      if (typeof url === "string" && url.startsWith("/api/jira/sprints?boardId=")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ sprints: [{ id: 10, name: "Sprint 10", state: "future" }] }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: "Jira API 403" }) });
    });

    await renderSheet(makeProps());

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Team Board" })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "1" } });

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Sprint 10/ })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText("Target sprint"), { target: { value: "10" } });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Jira API 403"));
  });

  it("lands on Setup until a destination sprint is chosen", async () => {
    await renderSheet(makeProps());

    expect(screen.getByTestId("destination-picker")).toBeInTheDocument();
    expect(screen.queryByText("First ticket")).not.toBeInTheDocument();
  });

  it("lands on Plan once a destination sprint is set", async () => {
    await renderSheet(makeProps({ plan: planWithSprintTickets }));

    expect(screen.getByText("Carried over")).toBeInTheDocument();
    expect(screen.queryByTestId("destination-picker")).not.toBeInTheDocument();
  });

  it("puts the destination picker first in the Setup tab", async () => {
    await renderSheet(makeProps({ plan: planWithSprintTickets }));
    showSetup();

    const picker = screen.getByTestId("destination-picker");
    // The sprint decides what the plan contains, so it comes before capacity.
    const capacity = screen.getByLabelText("Capacity in points");
    expect(picker.compareDocumentPosition(capacity)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("keeps the destination picker visible after a commit lands", async () => {
    global.fetch = mockFetch({
      sprint_id: 10,
      sprint_name: "Sprint 10",
      moved: ["PROJ-2"],
      failed: [],
      plan: planWithSprintTickets,
    });

    await renderSheet(makeProps({ plan: planWithSprintTickets }));

    fireEvent.click(screen.getByRole("button", { name: "Move tickets to sprint" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm — move 1/ }));

    await waitFor(() =>
      expect(screen.getByText(/moved to Sprint 10/)).toBeInTheDocument()
    );
    showSetup();
    // The picker (and the ability to keep adjusting the plan) stays put
    // rather than being hidden behind a "Plan another sprint" reset.
    expect(screen.getByTestId("destination-picker")).toBeInTheDocument();
  });

  it("shows guests the destination sprint without a selector", async () => {
    await renderSheet(makeProps({ plan: planWithSprintTickets, readOnly: true }));
    showSetup();

    expect(screen.getByTestId("guest-destination")).toHaveTextContent("Sprint 10");
    expect(screen.queryByLabelText("Target sprint")).not.toBeInTheDocument();
  });
});

describe("SprintPlanSheet — staged removals", () => {
  const planWithRemovals: SprintPlanPayload = {
    ...plan,
    items: [
      { issue_key: "PROJ-1", summary: "Staying", points: 3, position: 0, ...itemBase },
    ],
    total_points: 3,
    unpointed_count: 0,
    pending_removals: [
      {
        issue_key: "PROJ-9",
        summary: "Leaving the sprint",
        points: 5,
        position: 1,
        ...itemBase,
        origin: "sprint",
        removed: true,
      },
    ],
    destination: { board_id: 1, sprint_id: 10, sprint_name: "Sprint 10" },
  };

  it("lists staged removals separately from the plan", async () => {
    await renderSheet(makeProps({ plan: planWithRemovals }));

    const section = screen.getByTestId("pending-removals");
    expect(within(section).getByText("PROJ-9")).toBeInTheDocument();
    expect(within(section).getByText("Leaving the sprint")).toBeInTheDocument();
  });

  it("reflects the removals in the commit button", async () => {
    await renderSheet(makeProps({ plan: planWithRemovals }));
    expect(screen.getByRole("button", { name: "Move 1 · remove 1" })).toBeInTheDocument();
  });

  it("restores a staged removal via undo", async () => {
    const onPlanChange = vi.fn();
    global.fetch = mockFetch(plan);

    await renderSheet(makeProps({ plan: planWithRemovals, onPlanChange }));

    fireEvent.click(screen.getByLabelText("Undo removal of PROJ-9"));

    await waitFor(() => expect(onPlanChange).toHaveBeenCalledWith(plan));

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("/plan/PROJ-9")
    );
    expect(call![1].method).toBe("PATCH");
    expect(JSON.parse(call![1].body)).toEqual({ removed: false });
  });

  it("surfaces an undo failure", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: "denied" }) });

    await renderSheet(makeProps({ plan: planWithRemovals }));
    fireEvent.click(screen.getByLabelText("Undo removal of PROJ-9"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("denied"));
  });

  it("gives guests no undo control", async () => {
    await renderSheet(makeProps({ plan: planWithRemovals, readOnly: true }));

    expect(screen.getByTestId("pending-removals")).toBeInTheDocument();
    expect(screen.queryByLabelText("Undo removal of PROJ-9")).not.toBeInTheDocument();
  });

  it("allows committing a plan that is only removals", async () => {
    await renderSheet(
      makeProps({
        plan: { ...planWithRemovals, items: [] },
      })
    );
    // Nothing to move, but the removals still need to reach Jira.
    expect(screen.getByRole("button", { name: "Move 0 · remove 1" })).toBeEnabled();
  });
});

describe("SprintPlanSheet — capacity suggestion from the roster", () => {
  // Alice 5 + Bob 8 = 13, against the plan's team capacity of 40.
  const rosterWithCapacities: SprintPlanPayload = {
    ...plannedWithRoster,
    teammates: [roster[0], { ...roster[1], capacity_points: 8 }],
  };

  it("suggests the roster total when it differs from the team capacity", async () => {
    await renderSheet(makeProps({ plan: rosterWithCapacities }));

    const suggestion = screen.getByTestId("capacity-suggestion");
    expect(within(suggestion).getByText("Roster totals 13 pts")).toBeInTheDocument();
  });

  it("ignores teammates with no per-person target", async () => {
    // Only Alice has a target (5), so that is the whole suggestion.
    await renderSheet(makeProps({ plan: plannedWithRoster }));

    expect(screen.getByTestId("capacity-suggestion")).toHaveTextContent(
      "Roster totals 5 pts"
    );
  });

  it("offers no suggestion when nobody has a per-person target", async () => {
    await renderSheet(
      makeProps({
        plan: {
          ...plannedWithRoster,
          teammates: roster.map((t) => ({ ...t, capacity_points: null })),
        },
      })
    );

    expect(screen.queryByTestId("capacity-suggestion")).not.toBeInTheDocument();
  });

  it("offers no suggestion when the team capacity already matches", async () => {
    await renderSheet(
      makeProps({ plan: { ...rosterWithCapacities, capacity_points: 13 } })
    );

    expect(screen.queryByTestId("capacity-suggestion")).not.toBeInTheDocument();
  });

  it("offers a suggestion when no team capacity is set at all", async () => {
    await renderSheet(
      makeProps({ plan: { ...rosterWithCapacities, capacity_points: null } })
    );

    expect(screen.getByRole("button", { name: "Use 13 pts" })).toBeInTheDocument();
  });

  it("renders the suggestion as a real, outlined button", async () => {
    await renderSheet(makeProps({ plan: rosterWithCapacities }));
    showSetup();

    // A ghost button next to muted text read as static copy.
    const apply = screen.getByRole("button", { name: "Use 13 pts" });
    expect(apply.className).toContain("border");
    expect(apply.className).toContain("cursor-pointer");
  });

  it("applies the suggestion to the plan", async () => {
    const onPlanChange = vi.fn();
    const saved = { ...rosterWithCapacities, capacity_points: 13 };
    global.fetch = mockFetch(saved);

    await renderSheet(makeProps({ plan: rosterWithCapacities, onPlanChange }));

    fireEvent.click(screen.getByRole("button", { name: "Use 13 pts" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Capacity updated"));
    expect(onPlanChange).toHaveBeenCalledWith(saved);

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => typeof u === "string" && u.endsWith("/plan")
    );
    expect(JSON.parse(call![1].body)).toEqual({ capacity_points: 13 });
    expect(screen.getByLabelText("Capacity in points")).toHaveValue(13);
  });

  it("surfaces a failure to apply the suggestion", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) });

    await renderSheet(makeProps({ plan: rosterWithCapacities }));
    fireEvent.click(screen.getByRole("button", { name: "Use 13 pts" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope"));
  });

  it("never shows guests the suggestion", async () => {
    await renderSheet(makeProps({ plan: rosterWithCapacities, readOnly: true }));

    expect(screen.queryByTestId("capacity-suggestion")).not.toBeInTheDocument();
  });
});

describe("SprintPlanSheet — layout", () => {
  const configured: SprintPlanPayload = {
    ...plannedWithRoster,
    destination: { board_id: 1, sprint_id: 10, sprint_name: "Sprint 10" },
  };

  it("separates configuration from the ticket list across two tabs", async () => {
    await renderSheet(makeProps({ plan: configured }));

    expect(screen.getByRole("tab", { name: /^Plan/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Setup" })).toBeInTheDocument();

    // Plan tab: tickets, no config.
    expect(screen.getByText("First ticket")).toBeInTheDocument();
    expect(screen.queryByLabelText("Capacity in points")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search Jira users")).not.toBeInTheDocument();

    showSetup();

    // Setup tab: config, no tickets.
    expect(screen.getByLabelText("Capacity in points")).toBeInTheDocument();
    expect(screen.getByLabelText("Search Jira users")).toBeInTheDocument();
    expect(screen.queryByText("First ticket")).not.toBeInTheDocument();
  });

  it("switches back to the plan from setup", async () => {
    await renderSheet(makeProps({ plan: configured }));

    showSetup();
    expect(screen.queryByText("First ticket")).not.toBeInTheDocument();

    showPlan();
    expect(screen.getByText("First ticket")).toBeInTheDocument();
  });

  it("counts the plan's tickets on the Plan tab label", async () => {
    await renderSheet(makeProps({ plan: configured }));
    expect(screen.getByRole("tab", { name: "Plan · 2" })).toBeInTheDocument();
  });

  it("drops the count from the tab label when the plan is empty", async () => {
    await renderSheet(makeProps({ plan: { ...configured, items: [] } }));
    expect(screen.getByRole("tab", { name: "Plan" })).toBeInTheDocument();
  });

  it("keeps the totals pinned on both tabs", async () => {
    await renderSheet(makeProps({ plan: configured }));

    // The capacity read-out is what the host plans against, so it must survive
    // a tab switch.
    expect(screen.getByTestId("plan-totals")).toBeInTheDocument();
    expect(screen.getByTestId("capacity-bar")).toBeInTheDocument();

    showSetup();

    expect(screen.getByTestId("plan-totals")).toBeInTheDocument();
    expect(screen.getByTestId("capacity-bar")).toBeInTheDocument();
  });

  it("keeps the commit footer outside the tabs", async () => {
    await renderSheet(makeProps({ plan: configured }));

    expect(
      screen.getByRole("button", { name: "Move tickets to sprint" })
    ).toBeInTheDocument();

    showSetup();

    expect(
      screen.getByRole("button", { name: "Move tickets to sprint" })
    ).toBeInTheDocument();
  });

  it("gives guests the same two tabs", async () => {
    await renderSheet(makeProps({ plan: configured, readOnly: true }));

    expect(screen.getByRole("tab", { name: /^Plan/ })).toBeInTheDocument();

    showSetup();
    expect(screen.getByTestId("guest-destination")).toBeInTheDocument();
    expect(screen.getByText("Teammates")).toBeInTheDocument();
  });

  it("accents a group under capacity in blue", async () => {
    await renderSheet(
      makeProps({
        plan: {
          ...configured,
          teammates: roster,
          items: [
            { ...plan.items[0], assignee_account_id: "acc-1" },
            { ...plan.items[1], assignee_account_id: null },
          ],
        },
      })
    );
    showPlan();

    // Alice: 3 of 5 pts.
    expect(screen.getByTestId("plan-group-acc-1").className).toContain("border-l-blue-500");
  });

  it("accents a group over capacity in red", async () => {
    await renderSheet(
      makeProps({
        plan: {
          ...configured,
          teammates: roster,
          items: [
            { ...plan.items[0], assignee_account_id: "acc-1", points: 8 },
            { ...plan.items[1], assignee_account_id: null },
          ],
        },
      })
    );
    showPlan();

    expect(screen.getByTestId("plan-group-acc-1").className).toContain("border-l-red-500");
  });

  it("accents a group at capacity in green", async () => {
    await renderSheet(
      makeProps({
        plan: {
          ...configured,
          teammates: roster,
          items: [
            { ...plan.items[0], assignee_account_id: "acc-1", points: 5 },
            { ...plan.items[1], assignee_account_id: null },
          ],
        },
      })
    );
    showPlan();

    expect(screen.getByTestId("plan-group-acc-1").className).toContain("border-l-emerald-500");
  });

  it("gives a group with no capacity target a neutral accent", async () => {
    await renderSheet(
      makeProps({
        plan: {
          ...configured,
          teammates: roster,
          items: [
            { ...plan.items[0], assignee_account_id: "acc-2" },
            { ...plan.items[1], assignee_account_id: null },
          ],
        },
      })
    );
    showPlan();

    // Bob has no per-person target, so there is nothing to be under or over.
    expect(screen.getByTestId("plan-group-acc-2").className).toContain(
      "border-l-muted-foreground/40"
    );
  });

  it("gives the unassigned group a neutral accent, not a colour", async () => {
    await renderSheet(makeProps({ plan: configured }));
    showPlan();

    const unassigned = screen.getByTestId("plan-group-__unassigned__");
    expect(unassigned.className).toContain("border-l-muted-foreground/40");
  });

  it("orders Setup before Plan", async () => {
    await renderSheet(makeProps({ plan: configured }));

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs[0]).toBe("Setup");
    expect(tabs[1]).toMatch(/^Plan/);
  });

  it("separates the roster rows with real borders", async () => {
    await renderSheet(makeProps({ plan: configured }));
    showSetup();

    const row = screen.getByTestId("teammate-acc-1");
    expect(row.closest("ul")!.className).toContain("divide-y");
    expect(row.closest("ul")!.className).toContain("border");
  });

  it("groups the setup sections into the same bordered cards as the plan", async () => {
    await renderSheet(makeProps({ plan: configured }));
    showSetup();

    for (const id of ["destination-picker", "teammate-roster", "capacity-section"]) {
      const section = screen.getByTestId(id);
      expect(section.tagName).toBe("SECTION");
      expect(section.className).toContain("border-2");
      expect(section.className).toContain("rounded-md");
    }
  });

  it("gives guests a bordered destination card too", async () => {
    await renderSheet(makeProps({ plan: configured, readOnly: true }));
    showSetup();

    const card = screen.getByTestId("guest-destination").closest("section")!;
    expect(card.className).toContain("border-2");
  });

  it("gives the tabs a pointer cursor", async () => {
    await renderSheet(makeProps({ plan: configured }));

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("cursor-pointer");
    }
  });

  it("separates rows within a group more lightly than the groups themselves", async () => {
    await renderSheet(
      makeProps({
        plan: {
          ...configured,
          items: configured.items.map((i) => ({ ...i, assignee_account_id: "acc-1" })),
        },
      })
    );

    const group = screen.getByTestId("plan-group-acc-1");
    expect(group.querySelector("ul")!.className).toContain("divide-y");
    // The group itself is the heavier boundary.
    expect(group.className).toContain("rounded-md");
  });
});
