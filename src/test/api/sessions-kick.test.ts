import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockChannel = { send: vi.fn().mockResolvedValue(undefined) };
const mockServiceFrom = vi.fn();
const mockServiceClient = {
  channel: vi.fn().mockReturnValue(mockChannel),
  removeChannel: vi.fn().mockResolvedValue(undefined),
  from: mockServiceFrom,
};

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn().mockReturnValue(mockServiceClient),
}));

const { POST } = await import("@/app/api/sessions/[code]/kick/route");

const params = Promise.resolve({ code: "ABC123" });

function makeRequest(body: Record<string, unknown> = { user_id: "user-to-kick" }): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/kick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SESSION = { id: "session-1", facilitator_id: "facilitator-1" };

function mockSessionQuery(session: typeof SESSION | null, error: unknown = null) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: session, error }),
  });
}

function mockServiceDeletes() {
  mockServiceFrom.mockReturnValue({
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  });
}

describe("POST /api/sessions/[code]/kick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "facilitator-1" } }, error: null });
    mockChannel.send.mockResolvedValue(undefined);
    mockServiceClient.channel.mockReturnValue(mockChannel);
    mockServiceClient.removeChannel.mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when session not found", async () => {
    mockSessionQuery(null, { message: "not found" });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not facilitator", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "some-other-user" } }, error: null });
    mockSessionQuery(SESSION);
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when user_id is missing", async () => {
    mockSessionQuery(SESSION);
    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when trying to kick the facilitator", async () => {
    mockSessionQuery(SESSION);
    const res = await POST(makeRequest({ user_id: "facilitator-1" }), { params });
    expect(res.status).toBe(400);
  });

  it("broadcasts kick event and deletes participant + votes on success", async () => {
    mockSessionQuery(SESSION);
    mockServiceDeletes();

    const res = await POST(makeRequest({ user_id: "user-to-kick" }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "kick",
        payload: { user_id: "user-to-kick" },
      })
    );

    // Both votes and participants tables should be hit
    const tablesCalled = mockServiceFrom.mock.calls.map((c) => c[0]);
    expect(tablesCalled).toContain("votes");
    expect(tablesCalled).toContain("participants");
  });

  it("broadcasts kick before deleting from DB", async () => {
    mockSessionQuery(SESSION);
    const callOrder: string[] = [];
    mockChannel.send.mockImplementation(async () => { callOrder.push("broadcast"); });
    mockServiceFrom.mockImplementation(() => ({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(async () => { callOrder.push("delete"); return { error: null }; }),
        }),
      }),
    }));

    await POST(makeRequest({ user_id: "user-to-kick" }), { params });

    expect(callOrder[0]).toBe("broadcast");
  });
});
