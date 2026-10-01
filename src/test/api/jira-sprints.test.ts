import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser } };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockLoadCredentials = vi.fn();
const mockListBoards = vi.fn();
const mockListSprints = vi.fn();

vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  listBoards: mockListBoards,
  listSprints: mockListSprints,
}));

const { GET } = await import("@/app/api/jira/sprints/route");

const CREDS = {
  email: "a@b.com",
  token: "tok",
  baseUrl: "https://x.atlassian.net",
  projectKey: "PROJ",
};

describe("GET /api/jira/sprints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockLoadCredentials.mockResolvedValue(CREDS);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = new NextRequest("http://localhost/api/jira/sprints", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/not authenticated/i);
  });

  it("returns 400 when Jira credentials not found", async () => {
    mockLoadCredentials.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/jira/sprints", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/jira not connected/i);
  });

  it("returns boards when no boardId query param is present", async () => {
    const boards = [{ id: 1, name: "Board A" }, { id: 2, name: "Board B" }];
    mockListBoards.mockResolvedValue(boards);
    const req = new NextRequest("http://localhost/api/jira/sprints", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.boards).toEqual(boards);
    expect(mockListBoards).toHaveBeenCalledWith(
      { email: CREDS.email, token: CREDS.token, baseUrl: CREDS.baseUrl },
      CREDS.projectKey
    );
    expect(mockListSprints).not.toHaveBeenCalled();
  });

  it("returns sprints when boardId query param is present", async () => {
    const sprints = [{ id: 10, name: "Sprint 1" }, { id: 11, name: "Sprint 2" }];
    mockListSprints.mockResolvedValue(sprints);
    const req = new NextRequest("http://localhost/api/jira/sprints?boardId=42");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sprints).toEqual(sprints);
    expect(mockListSprints).toHaveBeenCalledWith(
      { email: CREDS.email, token: CREDS.token, baseUrl: CREDS.baseUrl },
      42
    );
    expect(mockListBoards).not.toHaveBeenCalled();
  });

  it("returns 502 when listBoards throws an Error", async () => {
    mockListBoards.mockRejectedValue(new Error("Jira API 500"));
    const req = new NextRequest("http://localhost/api/jira/sprints", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Jira API 500");
  });

  it("returns 502 with error message when listSprints throws", async () => {
    mockListSprints.mockRejectedValue(new Error("Sprint fetch failed"));
    const req = new NextRequest("http://localhost/api/jira/sprints?boardId=42");
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Sprint fetch failed");
  });

  it("returns 502 with generic message when thrown value is not an Error instance", async () => {
    mockListBoards.mockRejectedValue("something went wrong");
    const req = new NextRequest("http://localhost/api/jira/sprints", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Failed to fetch from Jira");
  });
});
