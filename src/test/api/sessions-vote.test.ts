import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

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

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const { POST, GET } = await import("@/app/api/sessions/[code]/vote/route");

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/vote", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function makeGetRequest(): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/vote", {
    method: "GET",
  });
}

const params = Promise.resolve({ code: "ABC123" });

function makeSessionFrom(state = "voting", facilitatorId = "facilitator-1") {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: "session-1", state, facilitator_id: facilitatorId },
      error: null,
    }),
  };
}

function makeSessionWithFacilitator(
  facilitatorId = "user-1",
  issueKey: string | null = "PROJ-1"
) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: "session-1", facilitator_id: facilitatorId, current_issue_key: issueKey },
      error: null,
    }),
  };
}

describe("POST /api/sessions/[code]/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest({ value: 3, issue_key: "round-1" }), { params });
    expect(res.status).toBe(401);
  });

  it.each([0, 4, 6, 10, "five", null])("returns 400 for invalid vote value %s", async (value) => {
    const res = await POST(makeRequest({ value, issue_key: "round-1" }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when issue_key is missing", async () => {
    const res = await POST(makeRequest({ value: 3 }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 404 when session not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const res = await POST(makeRequest({ value: 5, issue_key: "round-1" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 400 when votes are locked", async () => {
    mockFrom.mockReturnValue(makeSessionFrom("locked"));
    const res = await POST(makeRequest({ value: 5, issue_key: "round-1" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Votes are locked");
  });

  it("allows a vote change after reveal and rebroadcasts the updated tally", async () => {
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") return makeSessionFrom("revealed");
      return { upsert: upsertFn };
    });
    const neqVotes = vi.fn().mockResolvedValue({
      data: [{ user_id: "user-1", value: 3 }],
      error: null,
    });
    const eqVotes2 = vi.fn().mockReturnValue({ neq: neqVotes });
    const eqVotes1 = vi.fn().mockReturnValue({ eq: eqVotes2 });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { select: vi.fn().mockReturnValue({ eq: eqVotes1 }) };
      throw new Error(`unexpected table ${table}`);
    });

    const res = await POST(makeRequest({ value: 3, issue_key: "round-1" }), { params });

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(upsertFn).toHaveBeenCalled();
    expect(mockServiceClient.channel).toHaveBeenCalledWith("room:ABC123");
    expect(mockChannel.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "reveal",
      payload: { tally: { 3: 1 }, average: 3, median: 3, votes: [{ user_id: "user-1", value: 3 }] },
    });
  });

  it.each([1, 2, 3, 5])("accepts valid vote value %d", async (value) => {
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") return makeSessionFrom();
      return { upsert: upsertFn };
    });
    const res = await POST(makeRequest({ value, issue_key: "round-1" }), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("GET /api/sessions/[code]/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when session not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not the facilitator", async () => {
    mockFrom.mockReturnValue(makeSessionWithFacilitator("other-user", "PROJ-1"));
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 200 with voted_user_ids on success", async () => {
    mockFrom.mockReturnValue(makeSessionWithFacilitator("user-1", "PROJ-1"));
    mockServiceFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ user_id: "user-1" }, { user_id: "user-2" }],
            error: null,
          }),
        }),
      }),
    });
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voted_user_ids).toEqual(["user-1", "user-2"]);
  });

  it("uses round-1 as issue key when current_issue_key is null", async () => {
    mockFrom.mockReturnValue(makeSessionWithFacilitator("user-1", null));
    mockServiceFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ user_id: "user-1" }],
            error: null,
          }),
        }),
      }),
    });
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
  });

  it("returns 500 when votes query fails", async () => {
    mockFrom.mockReturnValue(makeSessionWithFacilitator("user-1", "PROJ-1"));
    mockServiceFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "db error" },
          }),
        }),
      }),
    });
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(500);
  });
});
