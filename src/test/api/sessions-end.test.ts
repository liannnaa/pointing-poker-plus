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

const { POST } = await import("@/app/api/sessions/[code]/end/route");

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/end", {
    method: "POST",
  });
}

const params = Promise.resolve({ code: "ABC123" });

describe("POST /api/sessions/[code]/end", () => {
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

  it("returns 200 ok when session not found (already deleted)", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 403 when user is not facilitator", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", facilitator_id: "other-user" },
        error: null,
      }),
    });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("broadcasts session:ended and deletes session on success", async () => {
    let fromCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        fromCallCount++;
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "session-1", facilitator_id: "facilitator-1" },
              error: null,
            }),
          };
        }
        // Second call: delete
        const eqDelete = vi.fn().mockResolvedValue({ error: null });
        return { delete: vi.fn().mockReturnValue({ eq: eqDelete }) };
      }
      return {};
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "session:ended" })
    );
  });

  it("returns 500 when delete fails", async () => {
    let fromCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        fromCallCount++;
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "session-1", facilitator_id: "facilitator-1" },
              error: null,
            }),
          };
        }
        const eqDelete = vi.fn().mockResolvedValue({ error: { message: "db error" } });
        return { delete: vi.fn().mockReturnValue({ eq: eqDelete }) };
      }
      return {};
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(500);
  });
});
