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
const mockListSprintIssues = vi.fn();
vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  listSprintIssues: mockListSprintIssues,
}));

const { PUT } = await import("@/app/api/sessions/[code]/plan/destination/route");

const params = Promise.resolve({ code: "ABC123" });

const mockSession = {
  id: "session-1",
  facilitator_id: "facilitator-1",
  capacity_points: 40,
  target_board_id: null,
  target_sprint_id: null,
  target_sprint_name: null,
};

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

function sessionSelectMock(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Recorders for the writes the route performs. */
let sessionUpdate: ReturnType<typeof vi.fn>;
let itemInsert: ReturnType<typeof vi.fn>;
let originDeleteEq2: ReturnType<typeof vi.fn>;
let keyDeleteIn: ReturnType<typeof vi.fn>;

/**
 * Table-aware service mock. `sprint_plan_items` serves three shapes: the
 * existing-rows probe (select → eq, thenable), loadPlanState's ordered read,
 * and the delete/insert writes.
 */
function setupServiceMocks(options: {
  existingRows?: unknown[];
  roster?: unknown[];
  planRows?: unknown[];
  insertError?: unknown;
  deleteError?: unknown;
  sessionError?: unknown;
} = {}) {
  const {
    existingRows = [],
    roster = [],
    planRows = [],
    insertError = null,
    deleteError = null,
    sessionError = null,
  } = options;

  sessionUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: sessionError }),
  });
  itemInsert = vi.fn().mockResolvedValue({ error: insertError });
  originDeleteEq2 = vi.fn().mockResolvedValue({ error: deleteError });
  keyDeleteIn = vi.fn().mockResolvedValue({ error: null });

  mockServiceFrom.mockImplementation((table: string) => {
    if (table === "sessions") return { update: sessionUpdate };

    if (table === "sprint_teammates") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue(
            Object.assign(Promise.resolve({ data: roster, error: null }), {
              order: vi.fn().mockResolvedValue({ data: roster, error: null }),
            })
          ),
        }),
      };
    }

    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue(
          Object.assign(Promise.resolve({ data: existingRows, error: null }), {
            order: vi.fn().mockResolvedValue({ data: planRows, error: null }),
          })
        ),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ eq: originDeleteEq2, in: keyDeleteIn }),
      }),
      insert: itemInsert,
    };
  });
}

function jiraIssue(
  key: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: key,
    key,
    fields: {
      summary: `Summary for ${key}`,
      status: { name: "To Do", statusCategory: { key: "new" } },
      issuetype: { name: "Story" },
      customfield_10026: 5,
      ...overrides,
    },
  };
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
  mockListSprintIssues.mockResolvedValue([]);
  mockChannel.send.mockResolvedValue(undefined);
  mockServiceClient.channel.mockReturnValue(mockChannel);
  setupServiceMocks();
});

describe("PUT /api/sessions/[code]/plan/destination", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await PUT(makeRequest({ board_id: 1, sprint_id: 10 }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the session does not exist", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(null, { message: "nope" }));
    const res = await PUT(makeRequest({ board_id: 1, sprint_id: 10 }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    const res = await PUT(makeRequest({ board_id: 1, sprint_id: 10 }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 on invalid JSON", async () => {
    const req = { json: vi.fn().mockRejectedValue(new Error("bad")) } as unknown as NextRequest;
    const res = await PUT(req, { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the body fails validation", async () => {
    const res = await PUT(makeRequest({ board_id: "one", sprint_id: 10 }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("returns 400 when Jira is not connected", async () => {
    mockLoadCredentials.mockResolvedValue(null);
    const res = await PUT(makeRequest({ board_id: 1, sprint_id: 10 }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Jira not connected");
  });

  it("returns 502 and leaves the destination untouched when Jira fails", async () => {
    mockListSprintIssues.mockRejectedValue(new Error("Jira API 403"));

    const res = await PUT(makeRequest({ board_id: 1, sprint_id: 10 }), { params });

    expect(res.status).toBe(502);
    // Fail closed: nothing is written when the sprint can't be read.
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(originDeleteEq2).not.toHaveBeenCalled();
  });

  it("persists the destination and pulls the sprint's issues in as sprint-origin", async () => {
    mockListSprintIssues.mockResolvedValue([jiraIssue("PROJ-1"), jiraIssue("PROJ-2")]);
    setupServiceMocks({
      planRows: [
        { issue_key: "PROJ-1", summary: "Summary for PROJ-1", points: 5, position: 0, origin: "sprint" },
      ],
    });

    const res = await PUT(
      makeRequest({ board_id: 1, sprint_id: 10, sprint_name: "Sprint 10" }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockListSprintIssues).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://x.atlassian.net" }),
      // Board scope: sprint names repeat across boards, so the sprint's issues
      // must be read through the destination board's own filter.
      1,
      10,
      "customfield_10026"
    );
    expect(sessionUpdate).toHaveBeenCalledWith({
      target_board_id: 1,
      target_sprint_id: 10,
      target_sprint_name: "Sprint 10",
    });
    expect(itemInsert).toHaveBeenCalledWith([
      expect.objectContaining({ issue_key: "PROJ-1", origin: "sprint", points: 5 }),
      expect.objectContaining({ issue_key: "PROJ-2", origin: "sprint", points: 5 }),
    ]);
    expect(body.destination).toEqual({
      board_id: 1,
      sprint_id: 10,
      sprint_name: "Sprint 10",
    });
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plan:updated" })
    );
  });

  it("rejects a sprint with no board", async () => {
    const res = await PUT(makeRequest({ board_id: null, sprint_id: 10 }), { params });

    expect(res.status).toBe(400);
    expect(mockListSprintIssues).not.toHaveBeenCalled();
  });

  it("drops the previous sprint's tickets but keeps host-added ones", async () => {
    mockListSprintIssues.mockResolvedValue([jiraIssue("NEW-1")]);
    setupServiceMocks({
      existingRows: [
        { issue_key: "OLD-1", assignee_account_id: null, origin: "sprint" },
        { issue_key: "KEEP-1", assignee_account_id: null, origin: "added" },
      ],
    });

    const res = await PUT(makeRequest({ board_id: 1, sprint_id: 11 }), { params });

    expect(res.status).toBe(200);
    // Only the sprint-origin rows are cleared — the host's queue survives.
    expect(originDeleteEq2).toHaveBeenCalledWith("origin", "sprint");
    expect(keyDeleteIn).not.toHaveBeenCalled();
  });

  it("clears sprint-origin tickets when the sprint is set to null", async () => {
    setupServiceMocks({
      existingRows: [{ issue_key: "OLD-1", assignee_account_id: null, origin: "sprint" }],
    });

    const res = await PUT(makeRequest({ board_id: 1, sprint_id: null }), { params });

    expect(res.status).toBe(200);
    expect(mockListSprintIssues).not.toHaveBeenCalled();
    expect(originDeleteEq2).toHaveBeenCalledWith("origin", "sprint");
    expect(itemInsert).not.toHaveBeenCalled();
  });

  it("pre-fills the assignee when the Jira assignee is on the roster", async () => {
    mockListSprintIssues.mockResolvedValue([
      jiraIssue("PROJ-1", { assignee: { accountId: "acc-1", displayName: "Alice" } }),
      jiraIssue("PROJ-2", { assignee: { accountId: "acc-stranger", displayName: "Bob" } }),
    ]);
    setupServiceMocks({ roster: [{ account_id: "acc-1" }] });

    await PUT(makeRequest({ board_id: 1, sprint_id: 10 }), { params });

    expect(itemInsert).toHaveBeenCalledWith([
      expect.objectContaining({ issue_key: "PROJ-1", assignee_account_id: "acc-1" }),
      // Not on the roster, so it must not be planted — commit pushes these to Jira.
      expect.objectContaining({ issue_key: "PROJ-2", assignee_account_id: null }),
    ]);
  });

  it("preserves an assignee the host already set over Jira's", async () => {
    mockListSprintIssues.mockResolvedValue([
      jiraIssue("PROJ-1", { assignee: { accountId: "acc-2", displayName: "Bob" } }),
    ]);
    setupServiceMocks({
      existingRows: [{ issue_key: "PROJ-1", assignee_account_id: "acc-1", origin: "added" }],
      roster: [{ account_id: "acc-1" }, { account_id: "acc-2" }],
    });

    await PUT(makeRequest({ board_id: 1, sprint_id: 10 }), { params });

    expect(itemInsert).toHaveBeenCalledWith([
      expect.objectContaining({ issue_key: "PROJ-1", assignee_account_id: "acc-1" }),
    ]);
    // The host-added duplicate is collapsed into the sprint-origin row.
    expect(keyDeleteIn).toHaveBeenCalledWith("issue_key", ["PROJ-1"]);
  });

  it("treats a non-numeric story-point value as unpointed", async () => {
    mockListSprintIssues.mockResolvedValue([jiraIssue("PROJ-1", { customfield_10026: null })]);
    setupServiceMocks();

    await PUT(makeRequest({ board_id: 1, sprint_id: 10 }), { params });

    expect(itemInsert).toHaveBeenCalledWith([
      expect.objectContaining({ issue_key: "PROJ-1", points: null }),
    ]);
  });

  it("returns 500 when the session update fails", async () => {
    setupServiceMocks({ sessionError: { message: "denied" } });
    const res = await PUT(makeRequest({ board_id: 1, sprint_id: null }), { params });
    expect(res.status).toBe(500);
  });

  it("returns 500 when clearing the old sprint's tickets fails", async () => {
    setupServiceMocks({ deleteError: { message: "locked" } });
    const res = await PUT(makeRequest({ board_id: 1, sprint_id: null }), { params });
    expect(res.status).toBe(500);
  });

  it("returns 500 when inserting the sprint's tickets fails", async () => {
    mockListSprintIssues.mockResolvedValue([jiraIssue("PROJ-1")]);
    setupServiceMocks({ insertError: { message: "constraint" } });
    const res = await PUT(makeRequest({ board_id: 1, sprint_id: 10 }), { params });
    expect(res.status).toBe(500);
  });
});
