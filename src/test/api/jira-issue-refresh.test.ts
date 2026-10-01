import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockChannel = { send: vi.fn().mockResolvedValue(undefined) };
const mockServiceClient = {
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

const { POST } = await import("@/app/api/jira/issue/[key]/refresh/route");

const params = Promise.resolve({ key: "PROJ-1" });

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/jira/issue/PROJ-1/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSessionQuery(data: unknown, error: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  return { select };
}

const defaultCreds = {
  email: "a@b.com",
  token: "tok",
  baseUrl: "https://x.atlassian.net",
  storyPointsField: "customfield_10016",
  acField: "customfield_10113",
};

const defaultSession = { id: "session-1", facilitator_id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mockLoadCredentials.mockResolvedValue(defaultCreds);
  mockFrom.mockReturnValue(makeSessionQuery(defaultSession));
});

describe("POST /api/jira/issue/[key]/refresh", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest({ session_code: "ABC123" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/jira/issue/PROJ-1/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    vi.spyOn(req, "json").mockRejectedValue(new SyntaxError("Unexpected token"));
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid json/i);
  });

  it("returns 400 when validation fails (missing session_code)", async () => {
    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/validation failed/i);
  });

  it("returns 404 when session not found", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(null));
    const res = await POST(makeRequest({ session_code: "ABC123" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not facilitator", async () => {
    mockFrom.mockReturnValue(makeSessionQuery({ id: "session-1", facilitator_id: "other-user" }));
    const res = await POST(makeRequest({ session_code: "ABC123" }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when Jira credentials missing", async () => {
    mockLoadCredentials.mockResolvedValue(null);
    const res = await POST(makeRequest({ session_code: "ABC123" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/jira not connected/i);
  });

  it("returns 502 when getIssue throws", async () => {
    mockGetIssue.mockRejectedValue(new Error("Jira down"));
    const res = await POST(makeRequest({ session_code: "ABC123" }), { params });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Jira down");
  });

  it("returns 200 on success and broadcasts issue:updated", async () => {
    const fakeIssue = { key: "PROJ-1", fields: { summary: "Refreshed" } };
    mockGetIssue.mockResolvedValue(fakeIssue);

    const res = await POST(makeRequest({ session_code: "ABC123" }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.issue_key).toBe("PROJ-1");
    expect(body.issue).toEqual(fakeIssue);

    expect(mockGetIssue).toHaveBeenCalledWith(
      { email: defaultCreds.email, token: defaultCreds.token, baseUrl: defaultCreds.baseUrl },
      "PROJ-1",
      defaultCreds.storyPointsField,
      defaultCreds.acField
    );

    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "issue:updated",
        payload: { issue_key: "PROJ-1", issue: fakeIssue },
      })
    );
  });
});
