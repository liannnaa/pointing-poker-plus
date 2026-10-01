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

const { GET, POST } = await import("@/app/api/sessions/[code]/select-issue/route");

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/select-issue", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const params = Promise.resolve({ code: "ABC123" });

const mockSession = {
  id: "session-1",
  facilitator_id: "facilitator-1",
};

function setupSessionMock() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "sessions") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    }
    return {};
  });
}

describe("POST /api/sessions/[code]/select-issue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "facilitator-1" } }, error: null });
    mockLoadCredentials.mockResolvedValue(null);
    mockChannel.send.mockResolvedValue(undefined);
    mockServiceClient.removeChannel.mockResolvedValue(undefined);
    mockServiceClient.channel.mockReturnValue(mockChannel);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/sessions/ABC123/select-issue", {
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
  });

  it("returns 404 when session not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not facilitator", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "other-user" },
        error: null,
      }),
    });
    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 200 and broadcasts issue-select without Jira credentials", async () => {
    // Set up sessions mock: first call selects, second call updates
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
          };
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });
    mockLoadCredentials.mockResolvedValue(null);

    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.issue_key).toBe("PROJ-1");

    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "issue-select",
        payload: expect.objectContaining({
          issue_key: "PROJ-1",
          issue: null,
          jira_base_url: null,
          ac_field: null,
        }),
      })
    );
  });

  it("broadcasts issue data and ac_field when Jira credentials exist", async () => {
    const mockIssue = {
      id: "123",
      key: "PROJ-1",
      fields: { summary: "Test issue", status: { name: "To Do", statusCategory: { key: "new" } }, issuetype: { name: "Story" } },
    };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
          };
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    mockLoadCredentials.mockResolvedValue({
      email: "test@example.com",
      token: "tok",
      baseUrl: "https://example.atlassian.net",
      storyPointsField: "customfield_10026",
      acField: "customfield_10113",
    });
    mockGetIssue.mockResolvedValue(mockIssue);

    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(200);

    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "issue-select",
        payload: expect.objectContaining({
          issue_key: "PROJ-1",
          issue: mockIssue,
          jira_base_url: "https://example.atlassian.net",
          ac_field: "customfield_10113",
        }),
      })
    );
  });

  it("clears votes for the previous issue when switching tickets", async () => {
    const sessionWithPrev = { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: "PROJ-OLD" };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: sessionWithPrev, error: null }),
          };
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    const mockDeleteEq = vi.fn().mockReturnThis();
    const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { delete: mockDelete };
      return {};
    });
    mockLoadCredentials.mockResolvedValue(null);

    const res = await POST(makeRequest({ issue_key: "PROJ-NEW" }), { params });
    expect(res.status).toBe(200);

    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteEq).toHaveBeenCalledWith("session_id", "session-1");
    expect(mockDeleteEq).toHaveBeenCalledWith("issue_key", "PROJ-OLD");
  });

  it("skips vote deletion when there is no previous issue key", async () => {
    const sessionNoPrev = { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: null };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: sessionNoPrev, error: null }),
          };
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    mockServiceFrom.mockReturnValue({});
    mockLoadCredentials.mockResolvedValue(null);

    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(200);
    // votes table should never be touched
    expect(mockServiceFrom).not.toHaveBeenCalledWith("votes");
  });

  it("still returns 200 if Jira issue fetch fails (non-fatal)", async () => {
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
          };
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    mockLoadCredentials.mockResolvedValue({
      email: "test@example.com",
      token: "tok",
      baseUrl: "https://example.atlassian.net",
      storyPointsField: "customfield_10026",
    });
    mockGetIssue.mockRejectedValue(new Error("Jira API error"));

    const res = await POST(makeRequest({ issue_key: "PROJ-1" }), { params });
    expect(res.status).toBe(200);
    // issue should be null in broadcast since fetch failed
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ issue: null }),
      })
    );
  });
});

describe("GET /api/sessions/[code]/select-issue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockLoadCredentials.mockResolvedValue(null);
  });

  function makeGetRequest(): NextRequest {
    return new NextRequest("http://localhost/api/sessions/ABC123/select-issue");
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

  it("returns null issue when current_issue_key is a synthetic round key", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: "round-2" },
        error: null,
      }),
    });
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issue).toBeNull();
    expect(body.jira_base_url).toBeNull();
  });

  it("returns null issue when current_issue_key is null", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: null },
        error: null,
      }),
    });
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issue).toBeNull();
  });

  it("returns null issue when no Jira credentials are stored", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: "PROJ-1" },
        error: null,
      }),
    });
    mockLoadCredentials.mockResolvedValue(null);

    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issue).toBeNull();
  });

  it("returns issue and jira metadata when credentials exist", async () => {
    const mockIssue = { key: "PROJ-1", fields: { summary: "A story" } };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: "PROJ-1" },
        error: null,
      }),
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

  it("returns null issue when Jira fetch fails (non-fatal)", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: "PROJ-1" },
        error: null,
      }),
    });
    mockLoadCredentials.mockResolvedValue({
      email: "fac@example.com",
      token: "tok",
      baseUrl: "https://example.atlassian.net",
      storyPointsField: "customfield_10026",
    });
    mockGetIssue.mockRejectedValue(new Error("Jira API error"));

    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issue).toBeNull();
    expect(body.jira_base_url).toBe("https://example.atlassian.net");
  });
});
