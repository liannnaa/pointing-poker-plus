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

const { POST } = await import("@/app/api/sessions/[code]/lock/route");

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/lock", {
    method: "POST",
  });
}

const params = Promise.resolve({ code: "ABC123" });

function makeSessionSelect(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

describe("POST /api/sessions/[code]/lock", () => {
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
    mockFrom.mockReturnValue(makeSessionSelect(null));
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not the facilitator", async () => {
    mockFrom.mockReturnValue(
      makeSessionSelect({
        id: "session-1",
        facilitator_id: "other-user",
        state: "revealed",
        current_issue_key: "round-1",
      })
    );
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when session is not yet revealed", async () => {
    mockFrom.mockReturnValue(
      makeSessionSelect({
        id: "session-1",
        facilitator_id: "facilitator-1",
        state: "voting",
        current_issue_key: "round-1",
      })
    );
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Votes must be revealed before they can be locked");
  });

  it("returns 400 when votes are already locked", async () => {
    mockFrom.mockReturnValue(
      makeSessionSelect({
        id: "session-1",
        facilitator_id: "facilitator-1",
        state: "locked",
        current_issue_key: "round-1",
      })
    );
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
  });

  it("locks the session, excludes the facilitator's own vote, and broadcasts a locked event", async () => {
    const votes = [
      { user_id: "u1", value: 3 },
      { user_id: "u2", value: 3 },
    ];
    const neqVotes = vi.fn().mockResolvedValue({ data: votes, error: null });
    const eqVotes2 = vi.fn().mockReturnValue({ neq: neqVotes });
    const eqVotes1 = vi.fn().mockReturnValue({ eq: eqVotes2 });
    const selectVotes = vi.fn().mockReturnValue({ eq: eqVotes1 });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === "votes") return { select: selectVotes };
      return {};
    });

    let selectCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        selectCallCount++;
        if (selectCallCount === 1) {
          return makeSessionSelect({
            id: "session-1",
            facilitator_id: "facilitator-1",
            state: "revealed",
            current_issue_key: "round-1",
          });
        }
        const eqUpdate = vi.fn().mockResolvedValue({ error: null });
        return { update: vi.fn().mockReturnValue({ eq: eqUpdate }) };
      }
      return {};
    });

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tally).toEqual({ 3: 2 });
    expect(body.average).toBe(3);
    expect(neqVotes).toHaveBeenCalledWith("user_id", "facilitator-1");
    expect(mockServiceClient.channel).toHaveBeenCalledWith("room:ABC123");
    expect(mockChannel.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "locked",
      payload: { tally: { 3: 2 }, average: 3, median: 3, votes },
    });
  });
});
