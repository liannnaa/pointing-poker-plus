import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser } };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockLoadCredentials = vi.fn();
const mockListSprintIssues = vi.fn();
const mockListBacklogIssues = vi.fn();

vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  listSprintIssues: mockListSprintIssues,
  listBacklogIssues: mockListBacklogIssues,
  validateCredentials: vi.fn(),
  getIssue: vi.fn(),
  updateStoryPoints: vi.fn(),
}));

const { GET } = await import("@/app/api/jira/issues/route");

const CREDS = { email: "a@b.com", token: "tok", baseUrl: "https://x.atlassian.net", storyPointsField: "customfield_10026" };

describe("GET /api/jira/issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockLoadCredentials.mockResolvedValue(CREDS);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = new NextRequest("http://localhost/api/jira/issues");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when Jira not connected", async () => {
    mockLoadCredentials.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/jira/issues");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither sprintId nor backlog provided", async () => {
    const req = new NextRequest("http://localhost/api/jira/issues");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for backlog without boardId", async () => {
    const req = new NextRequest("http://localhost/api/jira/issues?backlog=true");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns issues for a valid sprintId", async () => {
    const issues = [{ id: "1", key: "PROJ-1", fields: { summary: "Story A" } }];
    mockListSprintIssues.mockResolvedValue(issues);
    const req = new NextRequest("http://localhost/api/jira/issues?sprintId=42&boardId=7");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issues).toEqual(issues);
    // Board scope must reach Jira, or another board's issues leak in.
    expect(mockListSprintIssues).toHaveBeenCalledWith(
      expect.anything(),
      7,
      42,
      expect.any(String)
    );
  });

  it("returns 400 for a sprintId with no boardId", async () => {
    const req = new NextRequest("http://localhost/api/jira/issues?sprintId=42");
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("boardId");
    expect(mockListSprintIssues).not.toHaveBeenCalled();
  });

  it("returns backlog issues when backlog=true with boardId", async () => {
    const issues = [{ id: "2", key: "PROJ-2", fields: { summary: "Backlog item" } }];
    mockListBacklogIssues.mockResolvedValue(issues);
    const req = new NextRequest("http://localhost/api/jira/issues?backlog=true&boardId=10");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issues).toEqual(issues);
  });

  it("returns 502 when Jira API throws", async () => {
    mockListSprintIssues.mockRejectedValue(new Error("Jira API 500"));
    const req = new NextRequest("http://localhost/api/jira/issues?sprintId=1&boardId=7");
    const res = await GET(req);
    expect(res.status).toBe(502);
  });
});
