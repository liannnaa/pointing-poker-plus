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

const mockLoadCredentials = vi.fn();
const mockCreateSprint = vi.fn();
const mockMoveIssuesToSprint = vi.fn();
const mockMoveIssuesToBacklog = vi.fn();
const mockUpdateIssueAssignee = vi.fn();
vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  createSprint: mockCreateSprint,
  moveIssuesToSprint: mockMoveIssuesToSprint,
  moveIssuesToBacklog: mockMoveIssuesToBacklog,
  updateIssueAssignee: mockUpdateIssueAssignee,
}));

const { POST } = await import("@/app/api/sessions/[code]/plan/commit/route");

const params = Promise.resolve({ code: "ABC123" });

const mockSession = {
  id: "session-1",
  facilitator_id: "facilitator-1",
  capacity_points: 40,
  target_board_id: 5,
  target_sprint_id: null,
  target_sprint_name: null,
};

const PLAN_ROWS = [
  { issue_key: "PROJ-1", summary: "First", points: 3, position: 0 },
  { issue_key: "PROJ-2", summary: "Second", points: 5, position: 1 },
];

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/plan/commit", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function sessionSelectMock(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
}

const deleteIn = vi.fn();
const updateIn = vi.fn();
/** Captures the `update()` payloads, keyed by table. */
const sessionUpdate = vi.fn();

/**
 * Plan rows returned on each successive load: first the full plan, then the
 * remainder. loadPlanState reads sprint_plan_items and sprint_teammates, so the
 * mock is table-aware and only the item reads advance the sequence.
 */
function setupPlanMocks(loads: unknown[][], teammateRows: unknown[] = []) {
  let call = 0;
  mockServiceFrom.mockImplementation((table: string) => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockImplementation(() => {
          if (table === "sprint_teammates") {
            return Promise.resolve({ data: teammateRows, error: null });
          }
          const rows = loads[Math.min(call, loads.length - 1)];
          call += 1;
          return Promise.resolve({ data: rows, error: null });
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ in: deleteIn }),
    }),
    update: vi.fn().mockImplementation((payload: unknown) => {
      if (table === "sessions") {
        sessionUpdate(payload);
        return { eq: vi.fn().mockResolvedValue({ error: null }) };
      }
      return { eq: vi.fn().mockReturnValue({ in: updateIn }) };
    }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "facilitator-1" } }, error: null });
  mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
  mockLoadCredentials.mockResolvedValue({
    email: "a@b.com",
    token: "t",
    baseUrl: "https://x.atlassian.net",
    storyPointsField: "customfield_10026",
  });
  deleteIn.mockResolvedValue({ error: null });
  updateIn.mockResolvedValue({ error: null });
  mockMoveIssuesToBacklog.mockResolvedValue({ removed: [], failed: [] });
  mockChannel.send.mockResolvedValue(undefined);
  mockServiceClient.channel.mockReturnValue(mockChannel);
  mockMoveIssuesToSprint.mockResolvedValue({
    moved: ["PROJ-1", "PROJ-2"],
    failed: [],
  });
  mockUpdateIssueAssignee.mockResolvedValue(undefined);
});

describe("POST /api/sessions/[code]/plan/commit", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/sessions/ABC123/plan/commit", {
      method: "POST",
      body: "nope",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither a sprint_id nor new-sprint fields are given", async () => {
    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("returns 400 when both sprint_id and new-sprint fields are given", async () => {
    const res = await POST(makeRequest({ sprint_id: 7, board_id: 1, name: "S1" }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the session does not exist", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(null, { message: "nope" }));
    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when Jira is not connected", async () => {
    mockLoadCredentials.mockResolvedValue(null);
    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Jira not connected");
  });

  it("returns 400 when the plan is empty", async () => {
    setupPlanMocks([[]]);
    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Sprint plan is empty");
  });

  it("moves the plan into an existing sprint and broadcasts", async () => {
    setupPlanMocks([PLAN_ROWS, []]);

    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockCreateSprint).not.toHaveBeenCalled();
    expect(mockMoveIssuesToSprint).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://x.atlassian.net" }),
      7,
      ["PROJ-1", "PROJ-2"]
    );
    expect(body.moved).toEqual(["PROJ-1", "PROJ-2"]);
    expect(body.failed).toEqual([]);
    // Moved tickets stay in the plan as sprint-origin — the panel goes on
    // mirroring the sprint rather than emptying out.
    expect(updateIn).toHaveBeenCalledWith("issue_key", ["PROJ-1", "PROJ-2"]);
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plan:committed" })
    );
  });

  it("re-tags only the successfully moved tickets, leaving failures to retry", async () => {
    setupPlanMocks([PLAN_ROWS, PLAN_ROWS]);
    mockMoveIssuesToSprint.mockResolvedValue({
      moved: ["PROJ-1"],
      failed: [{ keys: ["PROJ-2"], error: "Jira API 400" }],
    });

    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateIn).toHaveBeenCalledWith("issue_key", ["PROJ-1"]);
    expect(body.failed).toEqual(["PROJ-2"]);
    expect(body.errors).toEqual(["Jira API 400"]);
  });

  it("skips the re-tag when nothing moved", async () => {
    setupPlanMocks([PLAN_ROWS, PLAN_ROWS]);
    mockMoveIssuesToSprint.mockResolvedValue({
      moved: [],
      failed: [{ keys: ["PROJ-1", "PROJ-2"], error: "Jira API 500" }],
    });

    const res = await POST(makeRequest({ sprint_id: 7 }), { params });

    expect(res.status).toBe(200);
    expect(updateIn).not.toHaveBeenCalled();
  });

  it("does not move tickets that are already in the sprint", async () => {
    setupPlanMocks([
      [
        { ...PLAN_ROWS[0], origin: "sprint" },
        { ...PLAN_ROWS[1], origin: "added" },
      ],
      [],
    ]);
    mockMoveIssuesToSprint.mockResolvedValue({ moved: ["PROJ-2"], failed: [] });

    const res = await POST(makeRequest({ sprint_id: 7 }), { params });

    expect(res.status).toBe(200);
    expect(mockMoveIssuesToSprint).toHaveBeenCalledWith(expect.anything(), 7, ["PROJ-2"]);
  });

  it("pushes staged removals back to the backlog and drops them from the plan", async () => {
    setupPlanMocks([
      [
        { ...PLAN_ROWS[0], origin: "added" },
        { ...PLAN_ROWS[1], origin: "sprint", removed: true },
      ],
      [],
    ]);
    mockMoveIssuesToSprint.mockResolvedValue({ moved: ["PROJ-1"], failed: [] });
    mockMoveIssuesToBacklog.mockResolvedValue({ removed: ["PROJ-2"], failed: [] });

    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockMoveIssuesToBacklog).toHaveBeenCalledWith(expect.anything(), ["PROJ-2"]);
    expect(body.removed).toEqual(["PROJ-2"]);
    expect(deleteIn).toHaveBeenCalledWith("issue_key", ["PROJ-2"]);
  });

  it("keeps a failed removal staged without failing the commit", async () => {
    setupPlanMocks([[{ ...PLAN_ROWS[1], origin: "sprint", removed: true }], []]);
    mockMoveIssuesToSprint.mockResolvedValue({ moved: [], failed: [] });
    mockMoveIssuesToBacklog.mockResolvedValue({
      removed: [],
      failed: [{ keys: ["PROJ-2"], error: "board mismatch" }],
    });

    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.remove_failed).toEqual(["PROJ-2"]);
    expect(deleteIn).not.toHaveBeenCalled();
  });

  it("commits a plan that only contains staged removals", async () => {
    setupPlanMocks([[{ ...PLAN_ROWS[1], origin: "sprint", removed: true }], []]);
    mockMoveIssuesToSprint.mockResolvedValue({ moved: [], failed: [] });
    mockMoveIssuesToBacklog.mockResolvedValue({ removed: ["PROJ-2"], failed: [] });

    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    expect(res.status).toBe(200);
  });

  it("persists a newly created sprint as the plan's destination", async () => {
    setupPlanMocks([PLAN_ROWS, []]);
    mockCreateSprint.mockResolvedValue({ id: 99, name: "Sprint 42", state: "future" });

    await POST(makeRequest({ board_id: 5, name: "Sprint 42" }), { params });

    expect(sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target_sprint_id: 99, target_sprint_name: "Sprint 42" })
    );
  });

  it("writes the assignee for a ticket already in the sprint", async () => {
    setupPlanMocks([
      [{ ...PLAN_ROWS[0], origin: "sprint", assignee_account_id: "acc-1" }],
      [],
    ]);
    mockMoveIssuesToSprint.mockResolvedValue({ moved: [], failed: [] });

    const res = await POST(makeRequest({ sprint_id: 7 }), { params });
    const body = await res.json();

    // Re-assigning an existing sprint ticket during planning must reach Jira,
    // even though the ticket itself is never moved.
    expect(res.status).toBe(200);
    expect(mockUpdateIssueAssignee).toHaveBeenCalledWith(
      expect.anything(),
      "PROJ-1",
      "acc-1"
    );
    expect(body.assigned).toEqual(["PROJ-1"]);
  });

  it("creates a new sprint when board_id and name are given", async () => {
    setupPlanMocks([PLAN_ROWS, []]);
    mockCreateSprint.mockResolvedValue({ id: 99, name: "Sprint 42", state: "future" });

    const res = await POST(
      makeRequest({
        board_id: 5,
        name: "Sprint 42",
        start_date: "2026-01-01T00:00:00.000Z",
        end_date: "2026-01-14T00:00:00.000Z",
      }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockCreateSprint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ boardId: 5, name: "Sprint 42" })
    );
    expect(body.sprint_id).toBe(99);
    expect(body.sprint_name).toBe("Sprint 42");
  });

  it("returns 502 when sprint creation fails", async () => {
    setupPlanMocks([PLAN_ROWS, []]);
    mockCreateSprint.mockRejectedValue(new Error("Jira API 403"));

    const res = await POST(makeRequest({ board_id: 5, name: "Sprint 42" }), { params });
    expect(res.status).toBe(502);
  });
});

describe("POST /api/sessions/[code]/plan/commit — assignee write-back", () => {
  const ASSIGNED_ROWS = [
    {
      issue_key: "PROJ-1",
      summary: "First",
      points: 3,
      position: 0,
      assignee_account_id: "acc-1",
    },
    {
      issue_key: "PROJ-2",
      summary: "Second",
      points: 5,
      position: 1,
      assignee_account_id: null,
    },
  ];

  it("sets the Jira assignee only for assigned tickets that moved", async () => {
    setupPlanMocks([ASSIGNED_ROWS, []]);

    const res = await POST(makeRequest({ sprint_id: 10 }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpdateIssueAssignee).toHaveBeenCalledTimes(1);
    expect(mockUpdateIssueAssignee).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://x.atlassian.net" }),
      "PROJ-1",
      "acc-1"
    );
    expect(body.assigned).toEqual(["PROJ-1"]);
    expect(body.assign_failed).toEqual([]);
  });

  it("skips assignees for tickets that failed to move", async () => {
    setupPlanMocks([ASSIGNED_ROWS, ASSIGNED_ROWS]);
    mockMoveIssuesToSprint.mockResolvedValue({
      moved: [],
      failed: [{ keys: ["PROJ-1", "PROJ-2"], error: "boom" }],
    });

    const res = await POST(makeRequest({ sprint_id: 10 }), { params });
    const body = await res.json();

    expect(mockUpdateIssueAssignee).not.toHaveBeenCalled();
    expect(body.assigned).toEqual([]);
  });

  it("reports a failed assignee write without failing the commit", async () => {
    setupPlanMocks([ASSIGNED_ROWS, []]);
    mockUpdateIssueAssignee.mockRejectedValue(new Error("no permission"));

    const res = await POST(makeRequest({ sprint_id: 10 }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.moved).toEqual(["PROJ-1", "PROJ-2"]);
    expect(body.assigned).toEqual([]);
    expect(body.assign_failed).toEqual(["PROJ-1"]);
  });

  it("includes the assignee outcome in the plan:committed broadcast", async () => {
    setupPlanMocks([ASSIGNED_ROWS, []]);

    await POST(makeRequest({ sprint_id: 10 }), { params });

    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "plan:committed",
        payload: expect.objectContaining({
          assigned: ["PROJ-1"],
          assign_failed: [],
        }),
      })
    );
  });

  it("makes no assignee calls when nothing in the plan is assigned", async () => {
    setupPlanMocks([PLAN_ROWS, []]);

    const res = await POST(makeRequest({ sprint_id: 10 }), { params });

    expect(res.status).toBe(200);
    expect(mockUpdateIssueAssignee).not.toHaveBeenCalled();
  });
});
