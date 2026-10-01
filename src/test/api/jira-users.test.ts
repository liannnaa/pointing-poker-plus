import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser } };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockLoadCredentials = vi.fn();
const mockSearchUsers = vi.fn();

vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  searchUsers: mockSearchUsers,
}));

const { GET } = await import("@/app/api/jira/users/route");

const CREDS = {
  email: "a@b.com",
  token: "tok",
  baseUrl: "https://x.atlassian.net",
};

const USERS = [
  { accountId: "acc-1", displayName: "Alice", emailAddress: "alice@x.com", active: true },
];

function request(query: string | null) {
  const url =
    query === null
      ? "http://localhost/api/jira/users"
      : `http://localhost/api/jira/users?query=${encodeURIComponent(query)}`;
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/jira/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockLoadCredentials.mockResolvedValue(CREDS);
    mockSearchUsers.mockResolvedValue(USERS);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(request("alice"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the query is missing", async () => {
    const res = await GET(request(null));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("query is required");
  });

  it("returns 400 when the query is only whitespace", async () => {
    const res = await GET(request("   "));
    expect(res.status).toBe(400);
  });

  it("returns 400 when Jira is not connected", async () => {
    mockLoadCredentials.mockResolvedValue(null);
    const res = await GET(request("alice"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Jira not connected");
  });

  it("returns matching users for the trimmed query", async () => {
    const res = await GET(request("  alice  "));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.users).toEqual(USERS);
    expect(mockSearchUsers).toHaveBeenCalledWith(
      { email: CREDS.email, token: CREDS.token, baseUrl: CREDS.baseUrl },
      "alice"
    );
  });

  it("translates a Jira 403 into an actionable permission message", async () => {
    mockSearchUsers.mockRejectedValue(new Error("Jira API 403: Forbidden"));
    const res = await GET(request("alice"));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Browse users and groups/);
  });

  it("returns 502 for other Jira failures", async () => {
    mockSearchUsers.mockRejectedValue(new Error("Jira API 500: boom"));
    const res = await GET(request("alice"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("500");
  });

  it("returns 502 with a fallback message for non-Error throws", async () => {
    mockSearchUsers.mockRejectedValue("kaboom");
    const res = await GET(request("alice"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Failed to search Jira users");
  });
});
