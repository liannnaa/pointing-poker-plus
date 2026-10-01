import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockServiceFrom = vi.fn();
const mockChannel = { send: vi.fn().mockResolvedValue(undefined) };
const mockServiceClient = {
  from: mockServiceFrom,
  channel: vi.fn().mockReturnValue(mockChannel),
  removeChannel: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn().mockReturnValue(mockServiceClient),
}));

const { DELETE, PATCH } = await import("@/app/api/sessions/[code]/plan/[key]/route");

const params = Promise.resolve({ code: "ABC123", key: "PROJ-1" });

const mockSession = {
  id: "session-1",
  facilitator_id: "facilitator-1",
  capacity_points: null,
};

function sessionSelectMock(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
}

const deleteEq2 = vi.fn();
const updateEq2 = vi.fn();
/** Resolves the single-`eq` update used by the staged-removal path. */
const updateEq1 = vi.fn();

/**
 * loadPlanState reads both sprint_plan_items and sprint_teammates, so the
 * service-client mock has to be table-aware. DELETE also probes for the
 * existing row (select → eq → eq → maybeSingle) to decide between a hard
 * delete and staging the removal, so the inner `eq` doubles as a thenable
 * (roster count) and a maybeSingle chain.
 */
function planTableMock(
  rows: unknown[],
  teammateRows: unknown[] = [],
  existingItem: { id: string; origin: string } | null = null
) {
  return (table: string) => {
    const data = table === "sprint_teammates" ? teammateRows : rows;
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data, error: null }),
          eq: vi.fn().mockReturnValue(
            Object.assign(Promise.resolve({ count: teammateRows.length, error: null }), {
              maybeSingle: vi.fn().mockResolvedValue({ data: existingItem, error: null }),
            })
          ),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ eq: deleteEq2 }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation((col: string) =>
          col === "id" ? updateEq1() : { eq: updateEq2 }
        ),
      }),
    };
  };
}

function jsonRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "facilitator-1" } }, error: null });
  deleteEq2.mockResolvedValue({ error: null });
  updateEq2.mockResolvedValue({ error: null });
  updateEq1.mockResolvedValue({ error: null });
  mockChannel.send.mockResolvedValue(undefined);
  mockServiceClient.channel.mockReturnValue(mockChannel);
});

describe("DELETE /api/sessions/[code]/plan/[key]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the session does not exist", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(null, { message: "nope" }));
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(403);
  });

  it("removes the ticket, returns fresh totals and broadcasts", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation(
      planTableMock([{ issue_key: "PROJ-2", summary: "Second", points: 5, position: 0 }])
    );

    const res = await DELETE({} as NextRequest, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.total_points).toBe(5);
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plan:updated" })
    );
  });

  it("decodes URL-encoded issue keys", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const deleteChain = { eq: vi.fn().mockReturnValue({ eq: deleteEq2 }) };
    mockServiceFrom.mockImplementation((table: string) => ({
      ...planTableMock([])(table),
      delete: vi.fn().mockReturnValue(deleteChain),
    }));

    const res = await DELETE({} as NextRequest, {
      params: Promise.resolve({ code: "ABC123", key: "PROJ%2F1" }),
    });

    expect(res.status).toBe(200);
    expect(deleteEq2).toHaveBeenCalledWith("issue_key", "PROJ/1");
  });

  it("stages a sprint-origin ticket instead of deleting it", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const deleteFn = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: deleteEq2 }) });
    const updateFn = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockServiceFrom.mockImplementation((table: string) => ({
      ...planTableMock([], [], { id: "row-1", origin: "sprint" })(table),
      delete: deleteFn,
      update: updateFn,
    }));

    const res = await DELETE({} as NextRequest, { params });

    expect(res.status).toBe(200);
    // The row survives so the removal is undoable and commit can push the key
    // back to the Jira backlog.
    expect(deleteFn).not.toHaveBeenCalled();
    expect(updateFn).toHaveBeenCalledWith({ removed: true });
  });

  it("hard-deletes a host-added ticket", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const updateFn = vi.fn();
    mockServiceFrom.mockImplementation((table: string) => ({
      ...planTableMock([], [], { id: "row-1", origin: "added" })(table),
      update: updateFn,
    }));

    const res = await DELETE({} as NextRequest, { params });

    expect(res.status).toBe(200);
    expect(updateFn).not.toHaveBeenCalled();
    expect(deleteEq2).toHaveBeenCalledWith("issue_key", "PROJ-1");
  });

  it("returns 500 when staging a sprint-origin removal fails", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation((table: string) => ({
      ...planTableMock([], [], { id: "row-1", origin: "sprint" })(table),
      update: vi
        .fn()
        .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: "denied" } }) }),
    }));

    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(500);
  });

  it("returns 500 when the delete fails", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    deleteEq2.mockResolvedValue({ error: { message: "denied" } });
    mockServiceFrom.mockImplementation(planTableMock([]));

    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/sessions/[code]/plan/[key] — assign", () => {
  const roster = [
    {
      account_id: "acc-1",
      display_name: "Alice",
      email: null,
      avatar_url: null,
      capacity_points: 13,
      position: 0,
    },
  ];

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await PATCH(jsonRequest({ assignee_account_id: "acc-1" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const res = await PATCH(jsonRequest({ assignee_account_id: "acc-1" }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const req = {
      json: vi.fn().mockRejectedValue(new Error("bad")),
    } as unknown as NextRequest;
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON");
  });

  it("returns 400 when the payload fails validation", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const res = await PATCH(jsonRequest({ assignee_account_id: 7 }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("rejects an assignee who is not on the roster", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation(planTableMock([], []));
    const res = await PATCH(jsonRequest({ assignee_account_id: "acc-ghost" }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Assignee is not on the sprint roster");
  });

  it("assigns the ticket, returns fresh state and broadcasts", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation(
      planTableMock(
        [
          {
            issue_key: "PROJ-1",
            summary: "First",
            points: 3,
            position: 0,
            assignee_account_id: "acc-1",
          },
        ],
        roster
      )
    );

    const res = await PATCH(jsonRequest({ assignee_account_id: "acc-1" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items[0].assignee_account_id).toBe("acc-1");
    expect(body.teammates).toHaveLength(1);
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plan:updated" })
    );
  });

  it("unassigns without a roster lookup when given null", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation(planTableMock([], []));

    const res = await PATCH(jsonRequest({ assignee_account_id: null }), { params });

    expect(res.status).toBe(200);
    expect(updateEq2).toHaveBeenCalledWith("issue_key", "PROJ-1");
  });

  it("returns 500 when the update fails", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation(planTableMock([], roster));
    updateEq2.mockResolvedValue({ error: { message: "denied" } });

    const res = await PATCH(jsonRequest({ assignee_account_id: "acc-1" }), { params });
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/sessions/[code]/plan/[key] — undo removal", () => {
  it("clears the removed flag without touching the assignee", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const updateFn = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: updateEq2 }) });
    mockServiceFrom.mockImplementation((table: string) => ({
      ...planTableMock([])(table),
      update: updateFn,
    }));

    const res = await PATCH(jsonRequest({ removed: false }), { params });

    expect(res.status).toBe(200);
    expect(updateFn).toHaveBeenCalledWith({ removed: false });
  });

  it("rejects an attempt to stage a removal through PATCH", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation(planTableMock([]));

    const res = await PATCH(jsonRequest({ removed: true }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects an empty patch", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation(planTableMock([]));

    const res = await PATCH(jsonRequest({}), { params });
    expect(res.status).toBe(400);
  });
});
