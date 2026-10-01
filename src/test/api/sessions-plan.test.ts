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
const mockGetIssuePoints = vi.fn();
vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  getIssuePoints: mockGetIssuePoints,
}));

const { GET, POST, PATCH } = await import("@/app/api/sessions/[code]/plan/route");

const params = Promise.resolve({ code: "ABC123" });

const mockSession = {
  id: "session-1",
  facilitator_id: "facilitator-1",
  capacity_points: 40,
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/plan", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Chainable select().eq().order() returning the given plan rows. */
function planSelectMock(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
  };
}

function sessionSelectMock(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  };
}

const PLAN_ROWS = [
  { issue_key: "PROJ-1", summary: "First", points: 3, position: 0 },
  { issue_key: "PROJ-2", summary: "Second", points: null, position: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "facilitator-1" } }, error: null });
  mockLoadCredentials.mockResolvedValue({
    email: "a@b.com",
    token: "t",
    baseUrl: "https://x.atlassian.net",
    storyPointsField: "customfield_10026",
  });
  mockChannel.send.mockResolvedValue(undefined);
  mockServiceClient.channel.mockReturnValue(mockChannel);
});

describe("GET /api/sessions/[code]/plan", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET({} as NextRequest, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the session does not exist", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(null, { message: "nope" }));
    const res = await GET({} as NextRequest, { params });
    expect(res.status).toBe(404);
  });

  it("returns the plan with computed totals for any participant", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "sessions" ? sessionSelectMock(mockSession) : planSelectMock(PLAN_ROWS)
    );

    const res = await GET({} as NextRequest, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.total_points).toBe(3);
    expect(body.unpointed_count).toBe(1);
    expect(body.capacity_points).toBe(40);
  });

  it("returns 500 when the plan query fails", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") return sessionSelectMock(mockSession);
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
          }),
        }),
      };
    });

    const res = await GET({} as NextRequest, { params });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});

describe("POST /api/sessions/[code]/plan", () => {
  let insertMock: ReturnType<typeof vi.fn>;
  let updateMock: ReturnType<typeof vi.fn>;

  /**
   * The add path now branches on whether the ticket is already in the plan and
   * on whether the ticket's Jira assignee is on the roster, so the service mock
   * has to serve the existence probe (select → eq → eq → maybeSingle), the
   * roster membership count (select → eq → eq), `loadPlanState`'s ordered reads
   * of both tables, and the writes.
   */
  function setupAddMocks(
    writeError: unknown = null,
    existing: { id: string; assignee_account_id?: string | null } | null = null,
    rosterRows: { account_id: string }[] = []
  ) {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    insertMock = vi.fn().mockResolvedValue({ error: writeError });
    updateMock = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: writeError }) });

    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "sprint_teammates") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: rosterRows, error: null }),
              eq: vi.fn((_col: string, id: string) =>
                Promise.resolve({
                  count: rosterRows.some((r) => r.account_id === id) ? 1 : 0,
                })
              ),
            }),
          }),
        };
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn((col: string) =>
            col === "session_id"
              ? Object.assign(Promise.resolve({ count: 1 }), {
                  order: vi.fn().mockResolvedValue({ data: PLAN_ROWS, error: null }),
                  eq: vi
                    .fn()
                    .mockReturnValue({
                      maybeSingle: vi
                        .fn()
                        .mockResolvedValue({ data: existing, error: null }),
                    }),
                })
              : {}
          ),
        }),
        insert: insertMock,
        update: updateMock,
      };
    });
  }

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/sessions/ABC123/plan", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when issue_key is missing", async () => {
    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("returns 404 when the session does not exist", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(null, { message: "nope" }));
    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when Jira is not connected", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockLoadCredentials.mockResolvedValue(null);
    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Jira not connected");
  });

  it("returns 502 when the Jira fetch fails", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockGetIssuePoints.mockRejectedValue(new Error("Jira API 404"));
    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(502);
  });

  it("adds the ticket using points read from Jira and broadcasts", async () => {
    setupAddMocks();
    mockGetIssuePoints.mockResolvedValue({ summary: "First", points: 3 });

    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetIssuePoints).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://x.atlassian.net" }),
      "PROJ-1",
      "customfield_10026"
    );
    expect(body.total_points).toBe(3);
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plan:updated" })
    );
  });

  it("returns 500 when the insert fails", async () => {
    setupAddMocks({ message: "constraint" });
    mockGetIssuePoints.mockResolvedValue({ summary: "First", points: 3 });
    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(500);
  });

  it("inserts a new ticket as host-added", async () => {
    setupAddMocks();
    mockGetIssuePoints.mockResolvedValue({ summary: "First", points: 3 });

    await POST(makeRequest({ issue_key: "PROJ-1" }), { params });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ issue_key: "PROJ-1", origin: "added", removed: false })
    );
  });

  it("un-stages an existing row instead of rewriting its origin", async () => {
    // A ticket already in the plan — re-adding it must not flip a sprint-origin
    // ticket to host-added, and must clear a staged removal.
    setupAddMocks(null, { id: "row-1" });
    mockGetIssuePoints.mockResolvedValue({ summary: "First", points: 3 });

    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });

    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({ summary: "First", points: 3, removed: false });
  });

  it("pre-fills the assignee when the Jira assignee is already on the roster", async () => {
    setupAddMocks(null, null, [{ account_id: "acc-1" }]);
    mockGetIssuePoints.mockResolvedValue({
      summary: "First",
      points: 3,
      assignee: { accountId: "acc-1", displayName: "Ada Lovelace" },
    });

    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ assignee_account_id: "acc-1" })
    );
    // Nothing to offer: they're already on the team.
    expect((await res.json()).suggested_teammate).toBeNull();
  });

  it("suggests adding a Jira assignee who isn't on the roster, without assigning them", async () => {
    setupAddMocks(null, null, []);
    mockGetIssuePoints.mockResolvedValue({
      summary: "First",
      points: 3,
      assignee: {
        accountId: "acc-9",
        displayName: "Grace Hopper",
        emailAddress: "grace@example.com",
        avatarUrls: { "48x48": "https://x/avatar.png" },
      },
    });

    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    const body = await res.json();

    // The roster is the host's deliberate team — commit pushes these accountIds
    // to Jira, so a stranger is offered, never silently written.
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ assignee_account_id: null })
    );
    expect(body.suggested_teammate).toEqual({
      issue_key: "PROJ-1",
      account_id: "acc-9",
      display_name: "Grace Hopper",
      email: "grace@example.com",
      avatar_url: "https://x/avatar.png",
    });
  });

  it("does not overwrite an assignee the host already chose", async () => {
    setupAddMocks(null, { id: "row-1", assignee_account_id: "acc-2" }, [
      { account_id: "acc-1" },
      { account_id: "acc-2" },
    ]);
    mockGetIssuePoints.mockResolvedValue({
      summary: "First",
      points: 3,
      assignee: { accountId: "acc-1", displayName: "Ada Lovelace" },
    });

    await POST(makeRequest({ issue_key: "PROJ-1" }), { params });

    expect(updateMock).toHaveBeenCalledWith({ summary: "First", points: 3, removed: false });
  });

  it("fills a gap on an existing row from the Jira assignee", async () => {
    setupAddMocks(null, { id: "row-1", assignee_account_id: null }, [
      { account_id: "acc-1" },
    ]);
    mockGetIssuePoints.mockResolvedValue({
      summary: "First",
      points: 3,
      assignee: { accountId: "acc-1", displayName: "Ada Lovelace" },
    });

    await POST(makeRequest({ issue_key: "PROJ-1" }), { params });

    expect(updateMock).toHaveBeenCalledWith({
      summary: "First",
      points: 3,
      removed: false,
      assignee_account_id: "acc-1",
    });
  });

  it("ignores an unassigned Jira ticket", async () => {
    setupAddMocks(null, null, [{ account_id: "acc-1" }]);
    mockGetIssuePoints.mockResolvedValue({ summary: "First", points: 3, assignee: null });

    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ assignee_account_id: null })
    );
    expect((await res.json()).suggested_teammate).toBeNull();
  });
});

describe("PATCH /api/sessions/[code]/plan", () => {
  function patchRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/sessions/ABC123/plan", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  const updateEq = vi.fn().mockResolvedValue({ error: null });

  const planUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: updateEq }),
  });

  function setupPatchMocks(rosterRows: unknown[] = []) {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation((table: string) => ({
      ...planSelectMock(table === "sprint_teammates" ? rosterRows : PLAN_ROWS),
      update: planUpdate,
    }));
  }

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await PATCH(patchRequest({ capacity_points: 40 }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/sessions/ABC123/plan", {
      method: "PATCH",
      body: "{{",
      headers: { "content-type": "application/json" },
    });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when no field is provided", async () => {
    const res = await PATCH(patchRequest({}), { params });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the session does not exist", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(null, { message: "nope" }));
    const res = await PATCH(patchRequest({ capacity_points: 40 }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    const res = await PATCH(patchRequest({ capacity_points: 40 }), { params });
    expect(res.status).toBe(403);
  });

  it("saves the capacity target and broadcasts", async () => {
    setupPatchMocks();
    const res = await PATCH(patchRequest({ capacity_points: 25 }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.capacity_points).toBe(25);
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plan:updated" })
    );
  });

  it("clears the capacity target when set to null", async () => {
    setupPatchMocks();
    const res = await PATCH(patchRequest({ capacity_points: null }), { params });
    expect((await res.json()).capacity_points).toBeNull();
  });

  it("re-fetches every item from Jira when refresh is requested", async () => {
    setupPatchMocks();
    mockGetIssuePoints.mockResolvedValue({ summary: "Fresh", points: 5 });

    const res = await PATCH(patchRequest({ refresh: true }), { params });

    expect(res.status).toBe(200);
    expect(mockGetIssuePoints).toHaveBeenCalledTimes(PLAN_ROWS.length);
  });

  it("backfills a missing assignee from Jira on refresh when they're on the roster", async () => {
    setupPatchMocks([{ account_id: "acc-1", display_name: "Ada", position: 0 }]);
    mockGetIssuePoints.mockResolvedValue({
      summary: "Fresh",
      points: 5,
      assignee: { accountId: "acc-1", displayName: "Ada" },
    });

    await PATCH(patchRequest({ refresh: true }), { params });

    expect(planUpdate).toHaveBeenCalledWith({
      summary: "Fresh",
      points: 5,
      assignee_account_id: "acc-1",
    });
  });

  it("leaves the assignee alone on refresh when the Jira assignee isn't on the roster", async () => {
    setupPatchMocks([]);
    mockGetIssuePoints.mockResolvedValue({
      summary: "Fresh",
      points: 5,
      assignee: { accountId: "acc-9", displayName: "Stranger" },
    });

    await PATCH(patchRequest({ refresh: true }), { params });

    expect(planUpdate).toHaveBeenCalledWith({ summary: "Fresh", points: 5 });
  });

  it("tolerates a Jira failure for one ticket during refresh", async () => {    setupPatchMocks();
    mockGetIssuePoints
      .mockRejectedValueOnce(new Error("Jira API 500"))
      .mockResolvedValue({ summary: "Fresh", points: 5 });

    const res = await PATCH(patchRequest({ refresh: true }), { params });
    expect(res.status).toBe(200);
  });

  it("returns 400 on refresh when Jira is not connected", async () => {
    setupPatchMocks();
    mockLoadCredentials.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ refresh: true }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 500 when the capacity update fails", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
    mockServiceFrom.mockImplementation(() => ({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: "denied" } }),
      }),
    }));
    const res = await PATCH(patchRequest({ capacity_points: 10 }), { params });
    expect(res.status).toBe(500);
  });
});
