import { describe, it, expect, vi } from "vitest";
import {
  computePlanTotals,
  computeRosterCapacity,
  capacityAccent,
  computeTeammateTotals,
  loadPlanState,
  broadcastPlanUpdate,
  requireFacilitatorSession,
  type SprintPlanItem,
  type SprintTeammate,
} from "@/lib/session/plan";

const base = { assignee_account_id: null, origin: "added" as const, removed: false };

const items: SprintPlanItem[] = [
  { issue_key: "PROJ-1", summary: "First", points: 3, position: 0, ...base },
  { issue_key: "PROJ-2", summary: "Second", points: 5, position: 1, ...base },
  { issue_key: "PROJ-3", summary: "Third", points: null, position: 2, ...base },
];

const NO_DESTINATION = { board_id: null, sprint_id: null, sprint_name: null };

/** The session shape loadPlanState derives the plan from. */
function ctx(capacity: number | null = null, overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    capacity_points: capacity,
    target_board_id: null,
    target_sprint_id: null,
    target_sprint_name: null,
    ...overrides,
  };
}

/**
 * Minimal chainable client. loadPlanState issues two queries (items then
 * teammates), so results are keyed by table name.
 */
function makeClient(
  itemsResult: { data?: unknown; error?: unknown },
  teammatesResult: { data?: unknown; error?: unknown } = { data: [], error: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi
            .fn()
            .mockResolvedValue(table === "sprint_teammates" ? teammatesResult : itemsResult),
        }),
      }),
    })),
  };
}

describe("computePlanTotals", () => {
  it("returns zeroes for an empty plan", () => {
    expect(computePlanTotals([])).toEqual({ total_points: 0, unpointed_count: 0 });
  });

  it("sums points and counts unpointed tickets separately", () => {
    expect(computePlanTotals(items)).toEqual({ total_points: 8, unpointed_count: 1 });
  });

  it("counts every ticket as unpointed when none have points", () => {
    const none = items.map((i) => ({ ...i, points: null }));
    expect(computePlanTotals(none)).toEqual({ total_points: 0, unpointed_count: 3 });
  });
});

describe("loadPlanState", () => {
  it("maps rows, coerces numerics and derives totals", async () => {
    const client = makeClient({
      data: [
        { issue_key: "PROJ-1", summary: "First", points: "3", position: "0" },
        { issue_key: "PROJ-2", summary: "Second", points: null, position: 1 },
      ],
      error: null,
    });

    const state = await loadPlanState(client, ctx(40));

    expect(state.items).toEqual([
      { issue_key: "PROJ-1", summary: "First", points: 3, position: 0, ...base },
      { issue_key: "PROJ-2", summary: "Second", points: null, position: 1, ...base },
    ]);
    expect(state.total_points).toBe(3);
    expect(state.unpointed_count).toBe(1);
    expect(state.capacity_points).toBe(40);
  });

  it("returns an empty plan when there are no rows", async () => {
    const state = await loadPlanState(makeClient({ data: null, error: null }), ctx());
    expect(state).toEqual({
      items: [],
      teammates: [],
      capacity_points: null,
      total_points: 0,
      unpointed_count: 0,
      destination: NO_DESTINATION,
      pending_removals: [],
    });
  });

  it("defaults a missing position to 0", async () => {
    const client = makeClient({
      data: [{ issue_key: "PROJ-1", summary: "First", points: 2 }],
      error: null,
    });
    const state = await loadPlanState(client, ctx());
    expect(state.items[0].position).toBe(0);
  });

  it("splits staged removals out of items and excludes them from totals", async () => {
    const client = makeClient({
      data: [
        { issue_key: "PROJ-1", summary: "Live", points: 3, position: 0, origin: "sprint" },
        {
          issue_key: "PROJ-2",
          summary: "Staged",
          points: 5,
          position: 1,
          origin: "sprint",
          removed: true,
        },
      ],
      error: null,
    });

    const state = await loadPlanState(client, ctx());

    expect(state.items.map((i) => i.issue_key)).toEqual(["PROJ-1"]);
    expect(state.pending_removals.map((i) => i.issue_key)).toEqual(["PROJ-2"]);
    // The staged ticket's 5 points must not inflate the capacity read-out.
    expect(state.total_points).toBe(3);
  });

  it("defaults a legacy row with no origin to 'added' and not removed", async () => {
    const client = makeClient({
      data: [{ issue_key: "PROJ-1", summary: "Legacy", points: 1, position: 0 }],
      error: null,
    });
    const state = await loadPlanState(client, ctx());
    expect(state.items[0].origin).toBe("added");
    expect(state.items[0].removed).toBe(false);
  });

  it("surfaces the session's destination", async () => {
    const client = makeClient({ data: [], error: null });
    const state = await loadPlanState(
      client,
      ctx(null, {
        target_board_id: 7,
        target_sprint_id: 42,
        target_sprint_name: "Sprint 9",
      })
    );
    expect(state.destination).toEqual({
      board_id: 7,
      sprint_id: 42,
      sprint_name: "Sprint 9",
    });
  });

  it("throws when the query errors", async () => {
    const client = makeClient({ data: null, error: { message: "denied" } });
    await expect(loadPlanState(client, ctx())).rejects.toThrow("denied");
  });
});

describe("broadcastPlanUpdate", () => {
  it("sends plan:updated on the uppercased room channel and cleans up", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const removeChannel = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      channel: vi.fn().mockReturnValue({ send }),
      removeChannel,
    };

    const state = {
      items,
      teammates: [],
      capacity_points: 40,
      total_points: 8,
      unpointed_count: 1,
      destination: NO_DESTINATION,
      pending_removals: [],
    };

    await broadcastPlanUpdate(client, "abc123", state);

    expect(client.channel).toHaveBeenCalledWith("room:ABC123");
    expect(send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "plan:updated",
      payload: state,
    });
    expect(removeChannel).toHaveBeenCalled();
  });
});

const roster: SprintTeammate[] = [
  {
    account_id: "acc-1",
    display_name: "Alice",
    email: "alice@example.com",
    avatar_url: null,
    capacity_points: 13,
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

describe("capacityAccent", () => {
  it("returns the neutral accent when there is no target", () => {
    expect(capacityAccent("none")).toBe("border-l-muted-foreground/40");
  });

  it("is blue while there is room left", () => {
    expect(capacityAccent("under")).toContain("border-l-blue-500");
  });

  it("is green at exactly capacity", () => {
    expect(capacityAccent("at")).toContain("border-l-emerald-500");
  });

  it("is red when over capacity", () => {
    expect(capacityAccent("over")).toContain("border-l-red-500");
  });

  it("gives every state a distinct accent", () => {
    const states = ["none", "under", "at", "over"] as const;
    const accents = states.map(capacityAccent);
    expect(new Set(accents).size).toBe(states.length);
  });

  it("returns a left-border class for every state", () => {
    for (const state of ["none", "under", "at", "over"] as const) {
      expect(capacityAccent(state)).toMatch(/^border-l-/);
    }
  });
});

describe("computeRosterCapacity", () => {
  it("returns null for an empty roster", () => {
    expect(computeRosterCapacity([])).toBeNull();
  });

  it("returns null when nobody has a per-person target", () => {
    expect(
      computeRosterCapacity(roster.map((t) => ({ ...t, capacity_points: null })))
    ).toBeNull();
  });

  it("sums the targets that are set, ignoring those that aren't", () => {
    // Alice is 13, Bob has no target.
    expect(computeRosterCapacity(roster)).toBe(13);
  });

  it("sums every teammate when all have targets", () => {
    expect(
      computeRosterCapacity([roster[0], { ...roster[1], capacity_points: 8 }])
    ).toBe(21);
  });

  it("returns 0 when the only targets set are zero", () => {
    expect(
      computeRosterCapacity([{ ...roster[0], capacity_points: 0 }, roster[1]])
    ).toBe(0);
  });
});

describe("computeTeammateTotals", () => {
  it("returns an empty bucket per teammate when nothing is assigned", () => {
    const { byAccountId, unassigned } = computeTeammateTotals([], roster);
    expect(byAccountId["acc-1"]).toEqual({
      assigned_points: 0,
      assigned_count: 0,
      unpointed_count: 0,
    });
    expect(byAccountId["acc-2"]).toEqual({
      assigned_points: 0,
      assigned_count: 0,
      unpointed_count: 0,
    });
    expect(unassigned).toEqual({
      assigned_points: 0,
      assigned_count: 0,
      unpointed_count: 0,
    });
  });

  it("sums points per teammate and tracks unpointed tickets", () => {
    const assigned: SprintPlanItem[] = [
      { ...items[0], assignee_account_id: "acc-1" },
      { ...items[1], assignee_account_id: "acc-1" },
      { ...items[2], assignee_account_id: "acc-2" },
    ];

    const { byAccountId, unassigned } = computeTeammateTotals(assigned, roster);

    expect(byAccountId["acc-1"]).toEqual({
      assigned_points: 8,
      assigned_count: 2,
      unpointed_count: 0,
    });
    expect(byAccountId["acc-2"]).toEqual({
      assigned_points: 0,
      assigned_count: 1,
      unpointed_count: 1,
    });
    expect(unassigned.assigned_count).toBe(0);
  });

  it("buckets null assignees under unassigned", () => {
    const { unassigned } = computeTeammateTotals(items, roster);
    expect(unassigned).toEqual({
      assigned_points: 8,
      assigned_count: 3,
      unpointed_count: 1,
    });
  });

  it("treats an assignee who is no longer on the roster as unassigned", () => {
    const orphaned: SprintPlanItem[] = [{ ...items[0], assignee_account_id: "acc-gone" }];
    const { unassigned, byAccountId } = computeTeammateTotals(orphaned, roster);
    expect(unassigned.assigned_count).toBe(1);
    expect(unassigned.assigned_points).toBe(3);
    expect(byAccountId["acc-gone"]).toBeUndefined();
  });
});

describe("loadPlanState — teammates", () => {
  it("maps teammate rows and coerces numeric capacity", async () => {
    const client = makeClient(
      { data: [], error: null },
      {
        data: [
          {
            account_id: "acc-1",
            display_name: "Alice",
            email: "alice@example.com",
            avatar_url: "http://x/a.png",
            capacity_points: "13",
            position: "0",
          },
          { account_id: "acc-2", display_name: "Bob" },
        ],
        error: null,
      }
    );

    const state = await loadPlanState(client, ctx());

    expect(state.teammates).toEqual([
      {
        account_id: "acc-1",
        display_name: "Alice",
        email: "alice@example.com",
        avatar_url: "http://x/a.png",
        capacity_points: 13,
        position: 0,
      },
      {
        account_id: "acc-2",
        display_name: "Bob",
        email: null,
        avatar_url: null,
        capacity_points: null,
        position: 0,
      },
    ]);
  });

  it("maps an item's assignee_account_id", async () => {
    const client = makeClient({
      data: [
        { issue_key: "PROJ-1", summary: "First", points: 3, position: 0, assignee_account_id: "acc-1" },
      ],
      error: null,
    });
    const state = await loadPlanState(client, ctx());
    expect(state.items[0].assignee_account_id).toBe("acc-1");
  });

  it("throws when the teammate query errors", async () => {
    const client = makeClient({ data: [], error: null }, { data: null, error: { message: "nope" } });
    await expect(loadPlanState(client, ctx())).rejects.toThrow("nope");
  });
});

describe("requireFacilitatorSession", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeAuthClient(user: unknown, sessionResult: { data?: unknown; error?: unknown }): any {
    return {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(sessionResult),
          }),
        }),
      }),
    };
  }

  it("401s when unauthenticated", async () => {
    const client = makeAuthClient(null, { data: null, error: null });
    const result = await requireFacilitatorSession(client, "abc123");
    expect(result.response).toEqual({ error: "Not authenticated", status: 401 });
  });

  it("404s when the session is missing", async () => {
    const client = makeAuthClient({ id: "u1" }, { data: null, error: { message: "x" } });
    const result = await requireFacilitatorSession(client, "abc123");
    expect(result.response?.status).toBe(404);
  });

  it("403s when the caller is not the facilitator", async () => {
    const client = makeAuthClient(
      { id: "u1" },
      { data: { id: "s1", facilitator_id: "other", capacity_points: null }, error: null }
    );
    const result = await requireFacilitatorSession(client, "abc123");
    expect(result.response?.status).toBe(403);
  });

  it("returns the session row for the facilitator and uppercases the code", async () => {
    const client = makeAuthClient(
      { id: "u1" },
      { data: { id: "s1", facilitator_id: "u1", capacity_points: 40 }, error: null }
    );
    const result = await requireFacilitatorSession(client, "abc123");
    expect(result.response).toBeUndefined();
    expect(result.row).toEqual({ id: "s1", facilitator_id: "u1", capacity_points: 40 });
    expect(result.userId).toBe("u1");
    expect(client.from().select().eq).toHaveBeenCalledWith("code", "ABC123");
  });
});
