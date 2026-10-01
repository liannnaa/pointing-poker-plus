import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { IssueList } from "@/components/room/IssueList";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * Mock @/components/ui/select with lightweight test doubles.
 *
 * Base UI Select uses pointer events that don't work in jsdom.
 * Replacing with simple <select> / <option> elements lets us use
 * fireEvent.change to drive onValueChange, fully exercising component logic.
 */
vi.mock("@/components/ui/select", () => {

  // Minimal Select double: renders a native <select> and wires onValueChange
  function Select({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
  }) {
    // The real component formats its trigger label via SelectValue's children
    // function (Base UI renders the raw value otherwise). Render it here, and
    // hoist SelectTrigger's aria-label, so both are assertable.
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
          disabled={disabled}
          onChange={(e) => onValueChange?.(e.target.value)}
        >
          {children}
        </select>
      </>
    );
  }

  // Pass-through wrappers — only Select and SelectItem matter for interaction
  function SelectTrigger({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  // SelectValue sits inside SelectTrigger which is inside the native <select>.
  // Returning null avoids the invalid <span>-inside-<select> warning.
  function SelectValue(_props: { placeholder?: string }) {
    return null;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  function SelectItem({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) {
    // <option> cannot contain elements — flatten to text only so React
    // doesn't emit the invalid-HTML hydration warning in jsdom.
    const text = React.Children.toArray(children)
      .map((c: React.ReactNode) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
      .join("");
    return <option value={value}>{text}</option>;
  }
  function SelectGroup({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  function SelectLabel({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  function SelectSeparator() {
    return <hr />;
  }
  function SelectScrollUpButton() {
    return null;
  }
  function SelectScrollDownButton() {
    return null;
  }

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
    SelectScrollUpButton,
    SelectScrollDownButton,
  };
});

// Picking a board is the entry point for most tests in this file. Waiting on
// the `/api/jira/sprints` fetch only proves the request was issued — React may
// not have rendered the board <option> yet, and firing a change to a value the
// native <select> does not contain is silently a no-op. That race was the cause
// of this file's intermittent failures, so wait for the option itself.
async function selectBoard(value: string) {
  let select!: HTMLSelectElement;
  await waitFor(() => {
    select = screen.getAllByTestId("select")[0] as HTMLSelectElement;
    expect(select.querySelector(`option[value="${value}"]`)).not.toBeNull();
  });
  fireEvent.change(select, { target: { value } });
}

const defaultProps = {
  onSelectIssue: vi.fn(),
  currentIssueKey: undefined,
  pointedIssues: [],
  storyPointsField: "customfield_10016",
};

/** Build a sequential fetch mock: boards → sprints+config → issues */
function buildFetchChain(issues: object[] = defaultIssues) {
  return vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ boards: [{ id: 1, name: "Board", type: "scrum" }] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sprints: [{ id: 10, name: "Sprint 1", state: "active" }],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ quickFilters: [] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issues }),
    });
}

const defaultIssues = [
  {
    id: "1",
    key: "PROJ-1",
    fields: {
      summary: "Fix bug",
      status: { name: "To Do" },
      issuetype: { name: "Bug" },
      customfield_10016: null,
    },
  },
  {
    id: "2",
    key: "PROJ-2",
    fields: {
      summary: "Add feature",
      status: { name: "Done" },
      issuetype: { name: "Story" },
      customfield_10016: 3,
    },
  },
];

/** Mount and load issues all the way through board + sprint selection. */
async function mountWithIssues(
  issues = defaultIssues,
  extraProps: Partial<React.ComponentProps<typeof IssueList>> = {}
) {
  global.fetch = buildFetchChain(issues);
  render(<IssueList {...defaultProps} {...extraProps} />);

  // Wait for boards to load (option appears only after fetch completes and
  // loadingBoards is false — ensures the select is no longer disabled)
  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Board" })).toBeInTheDocument();
  });

  // Select a board (first <select> on the page)
  const selects = screen.getAllByTestId("select");
  fireEvent.change(selects[0], { target: { value: "1" } });

  // Wait for sprints to load (Backlog option appears only after fetch completes
  // and loadingSprints is false — ensures the sprint select is no longer disabled)
  await waitFor(() => {
    const sprintSelects = screen.getAllByTestId("select");
    expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
    expect(sprintSelects[1]).not.toBeDisabled();
  });

  // Select a sprint (second <select>)
  const selects2 = screen.getAllByTestId("select");
  fireEvent.change(selects2[1], { target: { value: "10" } });

  // Wait for issues to be fetched
  await waitFor(() => {
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeGreaterThanOrEqual(4);
  });
}

// ---------------------------------------------------------------------------

describe("IssueList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ boards: [{ id: 1, name: "Team Board", type: "scrum" }] }),
    });
  });

  // 1. Renders without crashing — board select present
  it("renders without crashing and shows a board select", async () => {
    render(<IssueList {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId("select")).toBeInTheDocument();
    });
  });

  // 2. Calls fetch with /api/jira/sprints on mount
  it("calls fetch with /api/jira/sprints on mount", async () => {
    render(<IssueList {...defaultProps} />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/jira/sprints");
    });
  });

  // 3. Renders board options after boards load
  it("renders board options after boards load", async () => {
    render(<IssueList {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Team Board/i })).toBeInTheDocument();
    });
  });

  // 4. Shows toast on board fetch failure
  it("calls toast.error when boards fetch returns non-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Unauthorized" }),
    });

    render(<IssueList {...defaultProps} />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Unauthorized");
    });
  });

  // 10. No message shown before sprint is selected
  it("does not show any no-issues message before a sprint is selected", async () => {
    render(<IssueList {...defaultProps} />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/jira/sprints");
    });
    expect(screen.queryByText(/no issues/i)).not.toBeInTheDocument();
  });

  // 5/6/7 — Tests that need issues loaded
  describe("with issues loaded", () => {
    it("renders issues after selecting board and sprint", async () => {
      await mountWithIssues();
      await waitFor(() => {
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
        expect(screen.getByText("Add feature")).toBeInTheDocument();
      });
    });

    // 7. Search filter
    it("filters issues by search query (matching summary)", async () => {
      await mountWithIssues();

      await waitFor(() => {
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Ticket # or summary/i);
      fireEvent.change(searchInput, { target: { value: "Fix bug" } });

      await waitFor(() => {
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
        expect(screen.queryByText("Add feature")).not.toBeInTheDocument();
      });
    });

    // Search filter by key
    it("filters issues by search query matching issue key", async () => {
      await mountWithIssues();

      await waitFor(() => {
        expect(screen.getByText("PROJ-1")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Ticket # or summary/i);
      fireEvent.change(searchInput, { target: { value: "PROJ-2" } });

      await waitFor(() => {
        expect(screen.queryByText("Fix bug")).not.toBeInTheDocument();
        expect(screen.getByText("Add feature")).toBeInTheDocument();
      });
    });

    // 8. Point filter "unpointed"
    it("shows only unpointed issues when 'unpointed' filter is selected", async () => {
      await mountWithIssues();

      await waitFor(() => {
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
      });

      // Point filter is the second select in the filter section.
      // After board + sprint selects, there are more selects for filters.
      const selects = screen.getAllByTestId("select");
      // selects[0] = board, selects[1] = sprint, selects[2] = status, selects[3] = point
      const pointSelect = selects.find((s) => {
        const options = Array.from(s.querySelectorAll("option"));
        return options.some((o) => o.value === "unpointed");
      });
      expect(pointSelect).toBeDefined();
      fireEvent.change(pointSelect!, { target: { value: "unpointed" } });

      await waitFor(() => {
        // PROJ-1 has no points (customfield_10016: null) → visible
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
        // PROJ-2 has customfield_10016: 3 → hidden
        expect(screen.queryByText("Add feature")).not.toBeInTheDocument();
      });
    });

    // 8b. Point filter "pointed"
    it("shows only pointed issues when 'pointed' filter is selected", async () => {
      await mountWithIssues();

      await waitFor(() => {
        expect(screen.getByText("Add feature")).toBeInTheDocument();
      });

      const selects = screen.getAllByTestId("select");
      const pointSelect = selects.find((s) => {
        const options = Array.from(s.querySelectorAll("option"));
        return options.some((o) => o.value === "pointed");
      });
      expect(pointSelect).toBeDefined();
      fireEvent.change(pointSelect!, { target: { value: "pointed" } });

      await waitFor(() => {
        expect(screen.queryByText("Fix bug")).not.toBeInTheDocument();
        expect(screen.getByText("Add feature")).toBeInTheDocument();
      });
    });

    // Status filter
    it("filters issues by status when status filter is selected", async () => {
      await mountWithIssues();

      await waitFor(() => {
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
      });

      const selects = screen.getAllByTestId("select");
      const statusSelect = selects.find((s) => {
        const options = Array.from(s.querySelectorAll("option"));
        return options.some((o) => o.value === "all" && o.textContent === "All statuses");
      });
      expect(statusSelect).toBeDefined();
      fireEvent.change(statusSelect!, { target: { value: "Done" } });

      await waitFor(() => {
        // Only Done issue visible
        expect(screen.queryByText("Fix bug")).not.toBeInTheDocument();
        expect(screen.getByText("Add feature")).toBeInTheDocument();
      });
    });

    // onSelectIssue called when clicking an issue
    it("calls onSelectIssue when an issue button is clicked", async () => {
      const onSelectIssue = vi.fn();
      global.fetch = buildFetchChain();
      render(<IssueList {...defaultProps} onSelectIssue={onSelectIssue} />);

      await waitFor(() => expect(screen.getByRole("option", { name: "Board" })).toBeInTheDocument());
      const selects = screen.getAllByTestId("select");
      fireEvent.change(selects[0], { target: { value: "1" } });
      await waitFor(() => {
        const sprintSelects = screen.getAllByTestId("select");
        expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
        expect(sprintSelects[1]).not.toBeDisabled();
      });
      fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "10" } });
      await waitFor(() =>
        expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
      );

      await waitFor(() => expect(screen.getByText("Fix bug")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Fix bug").closest("button")!);
      expect(onSelectIssue).toHaveBeenCalledWith(
        expect.objectContaining({ key: "PROJ-1" })
      );
    });

    // currentIssueKey highlights the active issue
    it("highlights the current issue with border-primary class", async () => {
      global.fetch = buildFetchChain();
      render(
        <IssueList
          {...defaultProps}
          currentIssueKey="PROJ-1"
        />
      );

      await waitFor(() => expect(screen.getByRole("option", { name: "Board" })).toBeInTheDocument());
      const selects = screen.getAllByTestId("select");
      fireEvent.change(selects[0], { target: { value: "1" } });
      await waitFor(() => {
        const sprintSelects = screen.getAllByTestId("select");
        expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
        expect(sprintSelects[1]).not.toBeDisabled();
      });
      fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "10" } });
      await waitFor(() =>
        expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
      );

      await waitFor(() => expect(screen.getByText("Fix bug")).toBeInTheDocument());
      const activeBtn = screen.getByText("Fix bug").closest("button")!;
      expect(activeBtn.className).toContain("border-primary");
    });

    // 9. "No issues" message when sprint has no issues
    it("shows 'No issues in this sprint' when sprint has no issues", async () => {
      await mountWithIssues([]);
      await waitFor(() => {
        expect(screen.getByText(/no issues in this sprint/i)).toBeInTheDocument();
      });
    });

    // "No issues match filters" message
    it("shows 'No issues match' message when filters exclude all issues", async () => {
      await mountWithIssues();

      await waitFor(() => {
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Ticket # or summary/i);
      fireEvent.change(searchInput, { target: { value: "zzznomatch" } });

      await waitFor(() => {
        expect(screen.getByText(/no issues match the current filters/i)).toBeInTheDocument();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// statusBadgeClasses branch coverage
// ---------------------------------------------------------------------------

describe("statusBadgeClasses color logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const statusIssues = [
    {
      id: "1",
      key: "IP-1",
      fields: {
        summary: "In Progress issue",
        status: { name: "In Progress" },
        issuetype: { name: "Story" },
        customfield_10016: null,
      },
    },
    {
      id: "2",
      key: "DN-1",
      fields: {
        summary: "Done issue",
        status: { name: "Done" },
        issuetype: { name: "Story" },
        customfield_10016: null,
      },
    },
    {
      id: "3",
      key: "BL-1",
      fields: {
        summary: "Blocked issue",
        status: { name: "Blocked" },
        issuetype: { name: "Story" },
        customfield_10016: null,
      },
    },
    {
      id: "4",
      key: "TD-1",
      fields: {
        summary: "To Do issue",
        status: { name: "To Do" },
        issuetype: { name: "Story" },
        customfield_10016: null,
      },
    },
  ];

  async function loadStatusIssues() {
    global.fetch = buildFetchChain(statusIssues);
    render(<IssueList {...defaultProps} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "Board" })).toBeInTheDocument());
    const selects = screen.getAllByTestId("select");
    fireEvent.change(selects[0], { target: { value: "1" } });
    await waitFor(() => {
      const sprintSelects = screen.getAllByTestId("select");
      expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
      expect(sprintSelects[1]).not.toBeDisabled();
    });
    fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "10" } });
    await waitFor(() =>
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
    );
    await waitFor(() => expect(screen.getByText("In Progress issue")).toBeInTheDocument());
  }

  // 6. statusBadgeClasses — "In Progress" → green
  it("In Progress → green badge (bg-[#1C3A2A])", async () => {
    await loadStatusIssues();
    const badge = Array.from(document.querySelectorAll("span")).find(
      (el) => el.textContent?.trim() === "In Progress"
    );
    expect(badge).toBeDefined();
    expect(badge!.className).toContain("bg-[#1C3A2A]");
    expect(badge!.className).toContain("text-[#4BCE97]");
  });

  // 6. statusBadgeClasses — "Done" → yellow
  it("Done → yellow badge (bg-[#2C2A1E])", async () => {
    await loadStatusIssues();
    const badge = Array.from(document.querySelectorAll("span")).find(
      (el) => el.textContent?.trim() === "Done"
    );
    expect(badge).toBeDefined();
    expect(badge!.className).toContain("bg-[#2C2A1E]");
    expect(badge!.className).toContain("text-[#F5CD47]");
  });

  // 6. statusBadgeClasses — "Blocked" → red
  it("Blocked → red badge (bg-[#3D1F1D])", async () => {
    await loadStatusIssues();
    const badge = Array.from(document.querySelectorAll("span")).find(
      (el) => el.textContent?.trim() === "Blocked"
    );
    expect(badge).toBeDefined();
    expect(badge!.className).toContain("bg-[#3D1F1D]");
    expect(badge!.className).toContain("text-[#F87168]");
  });

  // 6. statusBadgeClasses — "To Do" → blue (default)
  it("To Do → blue badge (bg-[#1C2B41]) — default branch", async () => {
    await loadStatusIssues();
    const badge = Array.from(document.querySelectorAll("span")).find(
      (el) => el.textContent?.trim() === "To Do"
    );
    expect(badge).toBeDefined();
    expect(badge!.className).toContain("bg-[#1C2B41]");
    expect(badge!.className).toContain("text-[#579DFF]");
  });
});

// ---------------------------------------------------------------------------
// matchesQuickFilter via component — quick filter selection
// ---------------------------------------------------------------------------

describe("matchesQuickFilter branches via component quick filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const qfIssues = [
    {
      id: "1",
      key: "A-1",
      fields: {
        summary: "Active task",
        status: { name: "In Progress" },
        issuetype: { name: "Task" },
        customfield_10016: null,
      },
    },
    {
      id: "2",
      key: "A-2",
      fields: {
        summary: "Todo task",
        status: { name: "To Do" },
        issuetype: { name: "Task" },
        customfield_10016: null,
      },
    },
  ];

  async function loadQfIssues() {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ boards: [{ id: 5, name: "QF Board", type: "scrum" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sprints: [{ id: 20, name: "Sprint A", state: "active" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quickFilters: [
            // Note: regex ([^"'\s,)]+) captures only non-whitespace, so use
            // single-word statuses for the status= branch, and multi-word via status in ()
            { id: 1, name: "Done Only", query: "status = Done" },
            { id: 2, name: "To Do Only", query: "status in (\"To Do\")" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issues: qfIssues }),
      });

    render(<IssueList {...defaultProps} />);

    await selectBoard("5");
    await waitFor(() => {
      const sprintSelects = screen.getAllByTestId("select");
      expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
      expect(sprintSelects[1]).not.toBeDisabled();
    });
    fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "20" } });
    await waitFor(() =>
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
    );
    await waitFor(() => expect(screen.getByText("Active task")).toBeInTheDocument());
  }

  // matchesQuickFilter: status = ... branch (single-word status via status in)
  it("status= quick filter (status in To Do) shows only To Do issues", async () => {
    await loadQfIssues();

    // Quick filter select should be visible (quickFilters.length > 0)
    const selects = screen.getAllByTestId("select");
    const qfSelect = selects.find((s) => {
      const options = Array.from(s.querySelectorAll("option"));
      return options.some((o) => o.value === "none");
    });
    expect(qfSelect).toBeDefined();

    // Select "To Do Only" quick filter (id=2): status in ("To Do")
    fireEvent.change(qfSelect!, { target: { value: "2" } });

    await waitFor(() => {
      expect(screen.queryByText("Active task")).not.toBeInTheDocument();
      expect(screen.getByText("Todo task")).toBeInTheDocument();
    });
  });

  // matchesQuickFilter: status= branch with single-word value
  it("status= quick filter with single-word status filters correctly", async () => {
    const issuesWithDone = [
      ...qfIssues,
      {
        id: "3",
        key: "A-3",
        fields: {
          summary: "Closed task",
          status: { name: "Done" },
          issuetype: { name: "Task" },
          customfield_10016: null,
        },
      },
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ boards: [{ id: 5, name: "QF Board", type: "scrum" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sprints: [{ id: 20, name: "Sprint A", state: "active" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quickFilters: [
            { id: 10, name: "Done Only", query: "status = Done" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issues: issuesWithDone }),
      });

    render(<IssueList {...defaultProps} />);
    await selectBoard("5");
    await waitFor(() => {
      const sprintSelects = screen.getAllByTestId("select");
      expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
      expect(sprintSelects[1]).not.toBeDisabled();
    });
    fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "20" } });
    await waitFor(() =>
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
    );
    await waitFor(() => expect(screen.getByText("Closed task")).toBeInTheDocument());

    const selects = screen.getAllByTestId("select");
    const qfSelect = selects.find((s) => {
      const opts = Array.from(s.querySelectorAll("option"));
      return opts.some((o) => o.value === "none");
    });
    fireEvent.change(qfSelect!, { target: { value: "10" } });

    await waitFor(() => {
      expect(screen.getByText("Closed task")).toBeInTheDocument();
      expect(screen.queryByText("Active task")).not.toBeInTheDocument();
      expect(screen.queryByText("Todo task")).not.toBeInTheDocument();
    });
  });

  // matchesQuickFilter: status in (...) branch
  it("status in quick filter with In Progress shows only in-progress issues", async () => {
    // Override loadQfIssues with a status in ("In Progress") filter
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ boards: [{ id: 5, name: "QF Board", type: "scrum" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sprints: [{ id: 20, name: "Sprint A", state: "active" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quickFilters: [
            { id: 3, name: "Active Only", query: 'status in ("In Progress")' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issues: qfIssues }),
      });

    render(<IssueList {...defaultProps} />);
    await selectBoard("5");
    await waitFor(() => {
      const sprintSelects = screen.getAllByTestId("select");
      expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
      expect(sprintSelects[1]).not.toBeDisabled();
    });
    fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "20" } });
    await waitFor(() =>
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
    );
    await waitFor(() => expect(screen.getByText("Active task")).toBeInTheDocument());

    const selects = screen.getAllByTestId("select");
    const qfSelect = selects.find((s) => {
      const opts = Array.from(s.querySelectorAll("option"));
      return opts.some((o) => o.value === "none");
    });
    fireEvent.change(qfSelect!, { target: { value: "3" } });

    await waitFor(() => {
      expect(screen.getByText("Active task")).toBeInTheDocument();
      expect(screen.queryByText("Todo task")).not.toBeInTheDocument();
    });
  });

  // matchesQuickFilter: no match pattern → returns true (all shown)
  it("unknown quick filter query shows all issues (matchesQuickFilter returns true)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ boards: [{ id: 5, name: "Board", type: "scrum" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sprints: [{ id: 20, name: "Sprint A", state: "active" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quickFilters: [
            { id: 9, name: "Unknown filter", query: "assignee = currentUser()" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issues: qfIssues }),
      });

    render(<IssueList {...defaultProps} />);
    await selectBoard("5");
    await waitFor(() => {
      const sprintSelects = screen.getAllByTestId("select");
      expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
      expect(sprintSelects[1]).not.toBeDisabled();
    });
    fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "20" } });
    await waitFor(() =>
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
    );
    await waitFor(() => expect(screen.getByText("Active task")).toBeInTheDocument());

    const qfSelect = screen.getAllByTestId("select").find((s) => {
      const opts = Array.from(s.querySelectorAll("option"));
      return opts.some((o) => o.value === "none");
    });
    fireEvent.change(qfSelect!, { target: { value: "9" } });

    await waitFor(() => {
      // Unknown pattern → matchesQuickFilter returns true → both shown
      expect(screen.getByText("Active task")).toBeInTheDocument();
      expect(screen.getByText("Todo task")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Error handling: sprints fetch failure and issues fetch failure
// ---------------------------------------------------------------------------

describe("IssueList error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("calls toast.error when sprints fetch fails", async () => {
    // handleBoardChange fires two parallel fetches: sprints?boardId and board-config?boardId.
    // Use mockImplementation to route by URL so order doesn't matter.
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/jira/sprints") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ boards: [{ id: 1, name: "Board", type: "scrum" }] }),
        });
      }
      if (url === "/api/jira/sprints?boardId=1") {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "Sprint fetch failed" }),
        });
      }
      // board-config or anything else
      return Promise.resolve({
        ok: true,
        json: async () => ({ quickFilters: [] }),
      });
    });

    render(<IssueList {...defaultProps} />);
    await selectBoard("1");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Sprint fetch failed");
    });
  });

  it("calls toast.error when issues fetch fails", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ boards: [{ id: 1, name: "Board", type: "scrum" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sprints: [{ id: 10, name: "Sprint 1", state: "active" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quickFilters: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Issues fetch failed" }),
      });

    render(<IssueList {...defaultProps} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Board" })).toBeInTheDocument());
    fireEvent.change(screen.getAllByTestId("select")[0], { target: { value: "1" } });
    await waitFor(() => {
      const sprintSelects = screen.getAllByTestId("select");
      expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
      expect(sprintSelects[1]).not.toBeDisabled();
    });
    fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "10" } });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Issues fetch failed");
    });
  });

  it("uses backlog URL when sprint value is 'backlog'", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ boards: [{ id: 1, name: "Board", type: "scrum" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sprints: [{ id: 10, name: "Sprint 1", state: "active" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quickFilters: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issues: [] }),
      });

    render(<IssueList {...defaultProps} />);
    await selectBoard("1");
    await waitFor(() => {
      const sprintSelects = screen.getAllByTestId("select");
      expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
      expect(sprintSelects[1]).not.toBeDisabled();
    });
    fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "backlog" } });

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const issueCall = calls.find(
        (c: string[]) => typeof c[0] === "string" && c[0].includes("backlog=true")
      );
      expect(issueCall).toBeDefined();
    });
  });

  it("renders points badge when issue has story points", async () => {
    await (async () => {
      global.fetch = buildFetchChain([
        {
          id: "1",
          key: "PROJ-1",
          fields: {
            summary: "Pointed story",
            status: { name: "To Do" },
            issuetype: { name: "Story" },
            customfield_10016: 5,
          },
        },
      ]);
      render(<IssueList {...defaultProps} />);

      await selectBoard("1");
      await waitFor(() => {
        const sprintSelects = screen.getAllByTestId("select");
        expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
        expect(sprintSelects[1]).not.toBeDisabled();
      });
      fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "10" } });
      await waitFor(() =>
        expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
      );

      await waitFor(() => {
        expect(screen.getByText("5pt")).toBeInTheDocument();
      });
    })();
  });

  it("renders session points badge from pointedIssues prop", async () => {
    global.fetch = buildFetchChain([
      {
        id: "1",
        key: "PROJ-1",
        fields: {
          summary: "Session pointed story",
          status: { name: "To Do" },
          issuetype: { name: "Story" },
          customfield_10016: null,
        },
      },
    ]);
    render(
      <IssueList
        {...defaultProps}
        pointedIssues={[{ key: "PROJ-1", points: 8 }]}
      />
    );

    await selectBoard("1");
    await waitFor(() => {
      const sprintSelects = screen.getAllByTestId("select");
      expect(sprintSelects.length).toBeGreaterThanOrEqual(2);
      expect(sprintSelects[1]).not.toBeDisabled();
    });
    fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: "10" } });
    await waitFor(() =>
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
    );

    await waitFor(() => {
      expect(screen.getByText("8pt")).toBeInTheDocument();
    });
  });

  // New test: persists board selection to localStorage
  it("persists board selection to localStorage", async () => {
    global.fetch = buildFetchChain();
    render(<IssueList {...defaultProps} />);

    await selectBoard("1");

    await waitFor(() => {
      expect(localStorage.getItem("pp_jira_board")).toBe("1");
    });
  });

  // New test: restores previously selected board and sprint on remount
  it("restores previously selected board and sprint on remount", async () => {
    // Seed localStorage before mounting so the restore effect fires on mount
    localStorage.setItem("pp_jira_board", "1");
    localStorage.setItem("pp_jira_sprint", "10");

    // Use URL-based mockImplementation because the mount effect fires
    // sprints?boardId=1 and board-config?boardId=1 in parallel (Promise.all),
    // so call-order matching is unreliable.
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/jira/sprints") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ boards: [{ id: 1, name: "Board", type: "scrum" }] }),
        });
      }
      if (url === "/api/jira/sprints?boardId=1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sprints: [{ id: 10, name: "Sprint 1", state: "active" }],
          }),
        });
      }
      if (url === "/api/jira/board-config?boardId=1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ quickFilters: [] }),
        });
      }
      if (url === "/api/jira/issues?sprintId=10&boardId=1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ issues: defaultIssues }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    render(<IssueList {...defaultProps} />);

    // Verify the mount-time restore calls were made
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: string[]) => c[0]
      );
      expect(calls).toContain("/api/jira/sprints?boardId=1");
      expect(calls).toContain("/api/jira/board-config?boardId=1");
      expect(calls).toContain("/api/jira/issues?sprintId=10&boardId=1");
    });

    // Issues should appear after the restore
    await waitFor(() => {
      expect(screen.getByText("Fix bug")).toBeInTheDocument();
      expect(screen.getByText("Add feature")).toBeInTheDocument();
    });
  });
});

describe("IssueList — sprint plan add affordance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("does not render add buttons when onAddToPlan is omitted", async () => {
    await mountWithIssues();
    expect(screen.queryByLabelText("Add PROJ-1 to sprint plan")).not.toBeInTheDocument();
  });

  it("renders an add button per issue when onAddToPlan is provided", async () => {
    await mountWithIssues(defaultIssues, { onAddToPlan: vi.fn() });

    await waitFor(() => {
      expect(screen.getByLabelText("Add PROJ-1 to sprint plan")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Add PROJ-2 to sprint plan")).toBeInTheDocument();
  });

  it("calls onAddToPlan with the issue and not onSelectIssue", async () => {
    const onAddToPlan = vi.fn();
    const onSelectIssue = vi.fn();
    await mountWithIssues(defaultIssues, { onAddToPlan, onSelectIssue });

    await waitFor(() => {
      expect(screen.getByLabelText("Add PROJ-1 to sprint plan")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Add PROJ-1 to sprint plan"));

    expect(onAddToPlan).toHaveBeenCalledTimes(1);
    expect(onAddToPlan.mock.calls[0][0].key).toBe("PROJ-1");
    expect(onSelectIssue).not.toHaveBeenCalled();
  });

  it("marks tickets already in the plan as added and disables the button", async () => {
    const onAddToPlan = vi.fn();
    await mountWithIssues(defaultIssues, {
      onAddToPlan,
      planKeys: new Set(["PROJ-1"]),
    });

    await waitFor(() => {
      expect(
        screen.getByLabelText("Remove PROJ-1 from sprint plan")
      ).toBeInTheDocument();
    });

    const added = screen.getByLabelText("Remove PROJ-1 from sprint plan");
    expect(added).toBeDisabled();
    fireEvent.click(added);
    expect(onAddToPlan).not.toHaveBeenCalled();
  });

  it("removes a queued ticket when onRemoveFromPlan is provided and clicked", async () => {
    const onAddToPlan = vi.fn();
    const onRemoveFromPlan = vi.fn();
    await mountWithIssues(defaultIssues, {
      onAddToPlan,
      onRemoveFromPlan,
      planKeys: new Set(["PROJ-1"]),
    });

    const added = await screen.findByLabelText("Remove PROJ-1 from sprint plan");
    expect(added).not.toBeDisabled();
    fireEvent.click(added);

    expect(onRemoveFromPlan).toHaveBeenCalledTimes(1);
    expect(onRemoveFromPlan.mock.calls[0][0].key).toBe("PROJ-1");
    expect(onAddToPlan).not.toHaveBeenCalled();
  });

  it("still selects the issue for voting when the row itself is clicked", async () => {
    const onSelectIssue = vi.fn();
    const onAddToPlan = vi.fn();
    await mountWithIssues(defaultIssues, { onSelectIssue, onAddToPlan });

    await waitFor(() => {
      expect(screen.getByText("PROJ-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Fix bug"));

    expect(onSelectIssue).toHaveBeenCalledTimes(1);
    expect(onAddToPlan).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Trigger labels — Base UI's Select.Value renders the raw value unless a
// children formatter is supplied, so every dropdown must show a readable name.
describe("IssueList — dropdown trigger labels", () => {
  const labelIssues = [
    {
      id: "1",
      key: "LBL-1",
      fields: {
        summary: "Label issue",
        status: { name: "In Progress" },
        issuetype: { name: "Task" },
        customfield_10016: null,
      },
    },
  ];

  function chain() {
    return vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ boards: [{ id: 7, name: "Label Board", type: "scrum" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sprints: [{ id: 30, name: "Sprint Label", state: "future" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quickFilters: [{ id: 9, name: "My Filter", query: "status = Done" }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ issues: labelIssues }) });
  }

  async function mount(sprintValue = "30") {
    global.fetch = chain();
    render(<IssueList {...defaultProps} />);
    await selectBoard("7");
    await waitFor(() => {
      const selects = screen.getAllByTestId("select");
      expect(selects.length).toBeGreaterThanOrEqual(2);
      expect(selects[1].querySelector(`option[value="${sprintValue}"]`)).not.toBeNull();
    });
    fireEvent.change(screen.getAllByTestId("select")[1], { target: { value: sprintValue } });
    await waitFor(() => expect(screen.getByText("Label issue")).toBeInTheDocument());
  }

  function labels() {
    return screen.getAllByTestId("select-value").map((n) => n.textContent);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows readable board and sprint names instead of ids", async () => {
    await mount();
    const [board, sprint] = labels();
    expect(board).toBe("Label Board");
    expect(sprint).toBe("Sprint Label (future)");
  });

  it("shows 'Backlog' when the backlog pseudo-sprint is selected", async () => {
    await mount("backlog");
    expect(labels()[1]).toBe("Backlog");
  });

  it("shows readable default labels for the status, points and quick filters", async () => {
    await mount();
    const [, , status, points, quick] = labels();
    expect(status).toBe("All statuses");
    expect(points).toBe("All");
    expect(quick).toBe("No quick filter");
  });

  it("shows the chosen status, points and quick filter names after selection", async () => {
    await mount();
    const selects = screen.getAllByTestId("select");

    fireEvent.change(selects[2], { target: { value: "In Progress" } });
    fireEvent.change(selects[3], { target: { value: "unpointed" } });
    fireEvent.change(selects[4], { target: { value: "9" } });

    await waitFor(() => {
      const [, , status, points, quick] = labels();
      expect(status).toBe("In Progress");
      expect(points).toBe("Unpointed");
      expect(quick).toBe("My Filter");
    });
  });
});
