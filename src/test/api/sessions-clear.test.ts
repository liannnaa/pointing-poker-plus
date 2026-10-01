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

const { POST } = await import("@/app/api/sessions/[code]/clear/route");

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/clear", {
    method: "POST",
  });
}

const params = Promise.resolve({ code: "ABC123" });

describe("POST /api/sessions/[code]/clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "facilitator-1" } }, error: null });
    mockChannel.send.mockResolvedValue(undefined);
    mockServiceClient.removeChannel.mockResolvedValue(undefined);
    mockServiceClient.channel.mockReturnValue(mockChannel);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when session not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not facilitator", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "other-user", current_issue_key: "round-1" },
        error: null,
      }),
    });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 200 and increments round number", async () => {
    // service client: delete votes
    const eqDelete2 = vi.fn().mockResolvedValue({ error: null });
    const eqDelete1 = vi.fn().mockReturnValue({ eq: eqDelete2 });
    const deleteVotes = vi.fn().mockReturnValue({ eq: eqDelete1 });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { delete: deleteVotes };
      return {};
    });

    // regular client: session fetch then update
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: "round-1" },
              error: null,
            }),
          };
        }
        const eqUpdate = vi.fn().mockResolvedValue({ error: null });
        return { update: vi.fn().mockReturnValue({ eq: eqUpdate }) };
      }
      return {};
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.next_issue_key).toBe("round-2");
  });

  it("does not increment non-round issue keys", async () => {
    const eqDelete2 = vi.fn().mockResolvedValue({ error: null });
    const eqDelete1 = vi.fn().mockReturnValue({ eq: eqDelete2 });
    const deleteVotes = vi.fn().mockReturnValue({ eq: eqDelete1 });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { delete: deleteVotes };
      return {};
    });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: "PROJ-42" },
              error: null,
            }),
          };
        }
        const eqUpdate = vi.fn().mockResolvedValue({ error: null });
        return { update: vi.fn().mockReturnValue({ eq: eqUpdate }) };
      }
      return {};
    });

    const res = await POST(makeRequest(), { params });
    const body = await res.json();
    expect(body.next_issue_key).toBe("PROJ-42");
  });

  it("broadcasts clear event with next_issue_key", async () => {
    const eqDelete2 = vi.fn().mockResolvedValue({ error: null });
    const eqDelete1 = vi.fn().mockReturnValue({ eq: eqDelete2 });
    const deleteVotes = vi.fn().mockReturnValue({ eq: eqDelete1 });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { delete: deleteVotes };
      return {};
    });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "session-1", facilitator_id: "facilitator-1", current_issue_key: "round-3" },
              error: null,
            }),
          };
        }
        const eqUpdate = vi.fn().mockResolvedValue({ error: null });
        return { update: vi.fn().mockReturnValue({ eq: eqUpdate }) };
      }
      return {};
    });

    await POST(makeRequest(), { params });
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "clear",
        payload: { next_issue_key: "round-4" },
      })
    );
  });
});
