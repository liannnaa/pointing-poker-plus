import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser } };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockLoadCredentials = vi.fn();
const mockListBoardQuickFilters = vi.fn();

vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  listBoardQuickFilters: mockListBoardQuickFilters,
}));

const { GET } = await import("@/app/api/jira/board-config/route");

const CREDS = {
  email: "a@b.com",
  token: "tok",
  baseUrl: "https://x.atlassian.net",
  storyPointsField: "customfield_10026",
};

describe("GET /api/jira/board-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockLoadCredentials.mockResolvedValue(CREDS);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = new NextRequest("http://localhost/api/jira/board-config?boardId=1");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when boardId is missing", async () => {
    const req = new NextRequest("http://localhost/api/jira/board-config");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/boardId/);
  });

  it("returns 400 when Jira not connected", async () => {
    mockLoadCredentials.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/jira/board-config?boardId=1");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns quickFilters array when board has quick filters", async () => {
    const qf = [
      { id: 1, name: "My Issues", query: 'assignee = currentUser()' },
      { id: 2, name: "Defined", query: 'status = "Defined"' },
    ];
    mockListBoardQuickFilters.mockResolvedValue(qf);
    const req = new NextRequest("http://localhost/api/jira/board-config?boardId=10");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quickFilters).toEqual(qf);
  });

  it("returns empty quickFilters array when board has none", async () => {
    mockListBoardQuickFilters.mockResolvedValue([]);
    const req = new NextRequest("http://localhost/api/jira/board-config?boardId=10");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quickFilters).toEqual([]);
  });

  it("returns 502 when Jira API throws", async () => {
    mockListBoardQuickFilters.mockRejectedValue(new Error("Jira API 500"));
    const req = new NextRequest("http://localhost/api/jira/board-config?boardId=10");
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Jira API 500/);
  });

  it("passes the correct boardId to listBoardQuickFilters", async () => {
    mockListBoardQuickFilters.mockResolvedValue([]);
    const req = new NextRequest("http://localhost/api/jira/board-config?boardId=42");
    await GET(req);
    expect(mockListBoardQuickFilters).toHaveBeenCalledWith(
      { email: CREDS.email, token: CREDS.token, baseUrl: CREDS.baseUrl },
      42
    );
  });
});
