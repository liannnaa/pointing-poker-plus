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
const mockGetIssue = vi.fn();
vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  getIssue: mockGetIssue,
}));

const { GET, POST } = await import("@/app/api/sessions/[code]/reveal/route");

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/reveal", {
    method: "POST",
  });
}

const params = Promise.resolve({ code: "ABC123" });

describe("GET /api/sessions/[code]/reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockLoadCredentials.mockResolvedValue(null);
  });

  function makeGetRequest(): NextRequest {
    return new NextRequest("http://localhost/api/sessions/ABC123/reveal");
  }

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

  it("returns 400 when session is not in revealed state", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", state: "voting", current_issue_key: "round-1" },
        error: null,
      }),
    });
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Votes not yet revealed");
  });

  it("returns tally and average for a revealed session", async () => {
    const votes = [
      { user_id: "u1", value: 3 },
      { user_id: "u2", value: 5 },
      { user_id: "u3", value: 3 },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", state: "revealed", current_issue_key: "round-1" },
        error: null,
      }),
    });

    const neqVotes = vi.fn().mockResolvedValue({ data: votes, error: null });
    const eqVotes2 = vi.fn().mockReturnValue({ neq: neqVotes });
    const eqVotes1 = vi.fn().mockReturnValue({ eq: eqVotes2 });
    const selectVotes = vi.fn().mockReturnValue({ eq: eqVotes1 });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { select: selectVotes };
      return {};
    });

    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tally).toEqual({ 3: 2, 5: 1 });
    expect(body.average).toBeCloseTo(11 / 3);
    expect(body.votes).toEqual(votes);
  });

  it("includes issue and jira metadata when facilitator has Jira credentials", async () => {
    const mockIssue = { key: "PROJ-1", fields: { summary: "Test" } };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", state: "revealed", current_issue_key: "PROJ-1" },
        error: null,
      }),
    });

    const neqVotes = vi.fn().mockResolvedValue({ data: [], error: null });
    const eqVotes2 = vi.fn().mockReturnValue({ neq: neqVotes });
    const eqVotes1 = vi.fn().mockReturnValue({ eq: eqVotes2 });
    const selectVotes = vi.fn().mockReturnValue({ eq: eqVotes1 });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { select: selectVotes };
      return {};
    });

    mockLoadCredentials.mockResolvedValue({
      email: "fac@example.com",
      token: "tok",
      baseUrl: "https://example.atlassian.net",
      storyPointsField: "customfield_10026",
      acField: "customfield_10113",
    });
    mockGetIssue.mockResolvedValue(mockIssue);

    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issue).toEqual(mockIssue);
    expect(body.jira_base_url).toBe("https://example.atlassian.net");
    expect(body.ac_field).toBe("customfield_10113");
  });

  it("still returns tally when Jira issue fetch fails (non-fatal)", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", state: "revealed", current_issue_key: "PROJ-1" },
        error: null,
      }),
    });

    const neqVotes = vi.fn().mockResolvedValue({ data: [{ user_id: "u1", value: 5 }], error: null });
    const eqVotes2 = vi.fn().mockReturnValue({ neq: neqVotes });
    const eqVotes1 = vi.fn().mockReturnValue({ eq: eqVotes2 });
    const selectVotes = vi.fn().mockReturnValue({ eq: eqVotes1 });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { select: selectVotes };
      return {};
    });

    mockLoadCredentials.mockResolvedValue({
      email: "fac@example.com",
      token: "tok",
      baseUrl: "https://example.atlassian.net",
      storyPointsField: "customfield_10026",
    });
    mockGetIssue.mockRejectedValue(new Error("Jira error"));

    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.average).toBe(5);
    expect(body.issue).toBeNull();
  });
});

describe("POST /api/sessions/[code]/reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "facilitator-1" } }, error: null });
    mockChannel.send.mockResolvedValue(undefined);
    mockServiceClient.removeChannel.mockResolvedValue(undefined);
    mockServiceClient.channel.mockReturnValue(mockChannel);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when session not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not facilitator", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "other-user", state: "voting", current_issue_key: "round-1" },
        error: null,
      }),
    });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when already revealed", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", state: "revealed", current_issue_key: "round-1" },
        error: null,
      }),
    });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Votes already revealed");
  });

  it("returns tally and average on success", async () => {
    const votes = [
      { user_id: "u1", value: 3 },
      { user_id: "u2", value: 5 },
      { user_id: "u3", value: 3 },
    ];

    // Service client: from("votes") must support .select().eq().eq().neq() resolving to votes
    const neqVotes = vi.fn().mockResolvedValue({ data: votes, error: null });
    const eqVotes2 = vi.fn().mockReturnValue({ neq: neqVotes });
    const eqVotes1 = vi.fn().mockReturnValue({ eq: eqVotes2 });
    const selectVotes = vi.fn().mockReturnValue({ eq: eqVotes1 });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { select: selectVotes };
      return {};
    });

    // Regular client: sessions — select/eq/single for the session lookup, then update/eq for state
    let selectCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        selectCallCount++;
        if (selectCallCount === 1) {
          // First call: fetch session
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "session-1", facilitator_id: "facilitator-1", state: "voting", current_issue_key: "round-1" },
              error: null,
            }),
          };
        }
        // Second call: update state
        const eqUpdate = vi.fn().mockResolvedValue({ error: null });
        return { update: vi.fn().mockReturnValue({ eq: eqUpdate }) };
      }
      return {};
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tally).toEqual({ 3: 2, 5: 1 });
    expect(body.average).toBeCloseTo(11 / 3);
  });
});
