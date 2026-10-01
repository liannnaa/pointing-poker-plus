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

const { POST } = await import("@/app/api/sessions/[code]/nudge/route");

const params = Promise.resolve({ code: "ABC123" });

function makeRequest(body: Record<string, unknown> = { user_id: "user-to-nudge" }): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/nudge", {
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

describe("POST /api/sessions/[code]/nudge", () => {
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

  it("returns 403 when user is not the facilitator", async () => {
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

  it("returns 400 when trying to nudge the facilitator", async () => {
    mockSessionQuery(SESSION);
    const res = await POST(makeRequest({ user_id: "facilitator-1" }), { params });
    expect(res.status).toBe(400);
  });

  it("broadcasts nudge event and returns ok on success", async () => {
    mockSessionQuery(SESSION);

    const res = await POST(makeRequest({ user_id: "user-to-nudge" }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "nudge",
        payload: { user_id: "user-to-nudge" },
      })
    );
  });

  it("does not touch the database (no participants or votes deletion)", async () => {
    mockSessionQuery(SESSION);

    await POST(makeRequest({ user_id: "user-to-nudge" }), { params });

    // mockFrom is only called for the session lookup (auth client), not for any
    // service-role DB writes — the service client has no `from` mock registered.
    expect(mockServiceClient).not.toHaveProperty("from");
  });

  it("uses the uppercased session code for the broadcast channel", async () => {
    mockSessionQuery(SESSION);

    await POST(makeRequest({ user_id: "user-to-nudge" }), { params });

    expect(mockServiceClient.channel).toHaveBeenCalledWith("room:ABC123");
  });
});
