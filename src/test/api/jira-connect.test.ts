import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockServiceFrom = vi.fn();
const mockServiceClient = { from: mockServiceFrom };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn().mockReturnValue(mockServiceClient),
}));

vi.mock("@/lib/jira/encryption", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted-token"),
  decrypt: vi.fn().mockReturnValue("plain-token"),
}));

const mockValidateCredentials = vi.fn();
const mockDetectAcField = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/jira/client", () => ({
  validateCredentials: mockValidateCredentials,
  loadCredentials: vi.fn(),
  detectAcField: mockDetectAcField,
}));

const { POST, GET, DELETE } = await import("@/app/api/jira/connect/route");

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/jira/connect", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/jira/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockValidateCredentials.mockResolvedValue({ accountId: "abc", emailAddress: "test@example.com" });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makePostRequest({ email: "a@b.com", token: "t", base_url: "https://example.atlassian.net" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/jira/connect", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when email is missing", async () => {
    const res = await POST(makePostRequest({ token: "t", base_url: "https://example.atlassian.net" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when email is not valid", async () => {
    const res = await POST(makePostRequest({ email: "not-an-email", token: "t", base_url: "https://example.atlassian.net" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when base_url is http (not https)", async () => {
    const res = await POST(makePostRequest({ email: "a@b.com", token: "t", base_url: "http://example.atlassian.net" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when base_url is not a valid URL", async () => {
    const res = await POST(makePostRequest({ email: "a@b.com", token: "t", base_url: "not-a-url" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when Jira credentials are invalid", async () => {
    mockValidateCredentials.mockRejectedValue(new Error("Jira API 401: Unauthorized"));
    const res = await POST(makePostRequest({ email: "a@b.com", token: "t", base_url: "https://example.atlassian.net" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 and connected:true on success", async () => {
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    mockServiceFrom.mockReturnValue({ upsert: upsertFn });
    const res = await POST(makePostRequest({
      email: "a@b.com",
      token: "tok",
      base_url: "https://example.atlassian.net",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connected).toBe(true);
    expect(body.email).toBe("a@b.com");
  });

  it("defaults story_points_field to customfield_10026", async () => {
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    mockServiceFrom.mockReturnValue({ upsert: upsertFn });
    await POST(makePostRequest({ email: "a@b.com", token: "tok", base_url: "https://x.atlassian.net" }));
    const upsertArg = upsertFn.mock.calls[0][0];
    expect(upsertArg.story_points_field).toBe("customfield_10026");
  });

  it("stores detected ac_field when detectAcField returns a value", async () => {
    mockDetectAcField.mockResolvedValue("customfield_10113");
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    mockServiceFrom.mockReturnValue({ upsert: upsertFn });
    await POST(makePostRequest({ email: "a@b.com", token: "tok", base_url: "https://x.atlassian.net" }));
    const upsertArg = upsertFn.mock.calls[0][0];
    expect(upsertArg.ac_field).toBe("customfield_10113");
  });

  it("stores null ac_field when no AC field detected", async () => {
    mockDetectAcField.mockResolvedValue(null);
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    mockServiceFrom.mockReturnValue({ upsert: upsertFn });
    await POST(makePostRequest({ email: "a@b.com", token: "tok", base_url: "https://x.atlassian.net" }));
    const upsertArg = upsertFn.mock.calls[0][0];
    expect(upsertArg.ac_field).toBeNull();
  });
});

describe("GET /api/jira/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = new NextRequest("http://localhost/api/jira/connect");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns connected:false when no credentials", async () => {
    mockServiceFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const req = new NextRequest("http://localhost/api/jira/connect");
    const res = await GET(req);
    const body = await res.json();
    expect(body.connected).toBe(false);
  });

  it("returns connected:true with credential fields when found", async () => {
    mockServiceFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { email: "a@b.com", base_url: "https://x.atlassian.net", story_points_field: "customfield_10026", project_key: null, ac_field: null },
        error: null,
      }),
    });
    const req = new NextRequest("http://localhost/api/jira/connect");
    const res = await GET(req);
    const body = await res.json();
    expect(body.connected).toBe(true);
    expect(body.email).toBe("a@b.com");
  });

  it("returns ac_field in GET response when set", async () => {
    mockServiceFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { email: "a@b.com", base_url: "https://x.atlassian.net", story_points_field: "customfield_10026", project_key: null, ac_field: "customfield_10113" },
        error: null,
      }),
    });
    const req = new NextRequest("http://localhost/api/jira/connect");
    const res = await GET(req);
    const body = await res.json();
    expect(body.ac_field).toBe("customfield_10113");
  });
});

describe("DELETE /api/jira/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = new NextRequest("http://localhost/api/jira/connect", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it("returns connected:false after deletion", async () => {
    mockServiceFrom.mockReturnValue({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const req = new NextRequest("http://localhost/api/jira/connect", { method: "DELETE" });
    const res = await DELETE(req);
    const body = await res.json();
    expect(body.connected).toBe(false);
  });
});
