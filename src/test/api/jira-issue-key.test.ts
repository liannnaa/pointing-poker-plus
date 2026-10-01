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
const mockUpdateStoryPoints = vi.fn();
const mockUpdateIssueFields = vi.fn();
vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  getIssue: mockGetIssue,
  updateStoryPoints: mockUpdateStoryPoints,
  updateIssueFields: mockUpdateIssueFields,
}));

const { GET, PUT, PATCH } = await import("@/app/api/jira/issue/[key]/route");

const params = Promise.resolve({ key: "PROJ-1" });

function makeGetRequest() {
  return new NextRequest("http://localhost/api/jira/issue/PROJ-1");
}
function makePutRequest(body: object) {
  return new NextRequest("http://localhost/api/jira/issue/PROJ-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function makePatchRequest(body: object) {
  return new NextRequest("http://localhost/api/jira/issue/PROJ-1", {
    method: "PATCH",
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
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
describe("GET /api/jira/issue/[key]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when no Jira credentials", async () => {
    mockLoadCredentials.mockResolvedValue(null);
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/jira not connected/i);
  });

  it("returns 200 with issue data on success", async () => {
    const fakeIssue = {
      key: "PROJ-1",
      fields: { summary: "A ticket", customfield_10016: 5 },
    };
    mockGetIssue.mockResolvedValue(fakeIssue);

    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issue).toEqual(fakeIssue);
    expect(body.story_points_field).toBe(defaultCreds.storyPointsField);
    expect(body.current_points).toBe(5);

    expect(mockGetIssue).toHaveBeenCalledWith(
      { email: defaultCreds.email, token: defaultCreds.token, baseUrl: defaultCreds.baseUrl },
      "PROJ-1",
      defaultCreds.storyPointsField
    );
  });

  it("returns 502 when getIssue throws", async () => {
    mockGetIssue.mockRejectedValue(new Error("Jira down"));
    const res = await GET(makeGetRequest(), { params });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Jira down");
  });
});

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------
describe("PUT /api/jira/issue/[key]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await PUT(makePutRequest({ points: 3, session_code: "ABC123" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/jira/issue/PROJ-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    // Override json() to throw
    vi.spyOn(req, "json").mockRejectedValue(new SyntaxError("Unexpected token"));
    const res = await PUT(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid json/i);
  });

  it("returns 400 when validation fails (points: -1)", async () => {
    const res = await PUT(makePutRequest({ points: -1, session_code: "ABC123" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/validation failed/i);
  });

  it("returns 404 when session not found", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(null));
    const res = await PUT(makePutRequest({ points: 3, session_code: "ABC123" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not facilitator", async () => {
    mockFrom.mockReturnValue(makeSessionQuery({ id: "session-1", facilitator_id: "other-user" }));
    const res = await PUT(makePutRequest({ points: 3, session_code: "ABC123" }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when Jira credentials missing (after session check)", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(defaultSession));
    mockLoadCredentials.mockResolvedValue(null);
    const res = await PUT(makePutRequest({ points: 3, session_code: "ABC123" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/jira not connected/i);
  });

  it("returns 502 when updateStoryPoints throws", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(defaultSession));
    mockUpdateStoryPoints.mockRejectedValue(new Error("Jira API error"));
    const res = await PUT(makePutRequest({ points: 3, session_code: "ABC123" }), { params });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Jira API error");
  });

  it("returns 200 on success and broadcasts points:submitted", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(defaultSession));
    mockUpdateStoryPoints.mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ points: 8, session_code: "ABC123" }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.issue_key).toBe("PROJ-1");
    expect(body.points).toBe(8);

    expect(mockUpdateStoryPoints).toHaveBeenCalledWith(
      { email: defaultCreds.email, token: defaultCreds.token, baseUrl: defaultCreds.baseUrl },
      "PROJ-1",
      defaultCreds.storyPointsField,
      8
    );

    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "points:submitted" })
    );
  });
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe("PATCH /api/jira/issue/[key]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await PATCH(makePatchRequest({ session_code: "ABC123", summary: "New title" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/jira/issue/PROJ-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    vi.spyOn(req, "json").mockRejectedValue(new SyntaxError("Unexpected token"));
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid json/i);
  });

  it("returns 400 when validation fails (no fields provided)", async () => {
    const res = await PATCH(makePatchRequest({ session_code: "ABC123" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/validation failed/i);
  });

  it("returns 404 when session not found", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(null));
    const res = await PATCH(makePatchRequest({ session_code: "ABC123", summary: "New title" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not facilitator", async () => {
    mockFrom.mockReturnValue(makeSessionQuery({ id: "session-1", facilitator_id: "other-user" }));
    const res = await PATCH(makePatchRequest({ session_code: "ABC123", summary: "New title" }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when Jira credentials missing (after session check)", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(defaultSession));
    mockLoadCredentials.mockResolvedValue(null);
    const res = await PATCH(makePatchRequest({ session_code: "ABC123", summary: "New title" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/jira not connected/i);
  });

  it("returns 502 when updateIssueFields throws", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(defaultSession));
    mockUpdateIssueFields.mockRejectedValue(new Error("Jira API error"));
    const res = await PATCH(makePatchRequest({ session_code: "ABC123", summary: "New title" }), { params });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Jira API error");
  });

  it("returns 200 on success with summary only and broadcasts issue:updated", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(defaultSession));
    mockUpdateIssueFields.mockResolvedValue(undefined);
    const fakeIssue = { key: "PROJ-1", fields: { summary: "New title" } };
    mockGetIssue.mockResolvedValue(fakeIssue);

    const res = await PATCH(makePatchRequest({ session_code: "ABC123", summary: "New title" }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.issue_key).toBe("PROJ-1");

    expect(mockUpdateIssueFields).toHaveBeenCalledWith(
      { email: defaultCreds.email, token: defaultCreds.token, baseUrl: defaultCreds.baseUrl },
      "PROJ-1",
      expect.objectContaining({ summary: "New title" })
    );

    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "issue:updated" })
    );
  });

  it("returns 200 even when getIssue throws after update (non-fatal)", async () => {
    mockFrom.mockReturnValue(makeSessionQuery(defaultSession));
    mockUpdateIssueFields.mockResolvedValue(undefined);
    mockGetIssue.mockRejectedValue(new Error("fetch failed"));

    const res = await PATCH(makePatchRequest({ session_code: "ABC123", summary: "New title" }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // broadcast still happens, with null issue
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "issue:updated" })
    );
  });
});
