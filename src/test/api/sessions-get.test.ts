import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock Supabase server client ──────────────────────────────────────────────
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

// ── Import handler after mocks ───────────────────────────────────────────────
const { GET } = await import("@/app/api/sessions/[code]/route");

function makeRequest(code: string): NextRequest {
  return new NextRequest(`http://localhost/api/sessions/${code}`);
}

describe("GET /api/sessions/[code]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("returns 404 when session not found (error returned)", async () => {
    const mockEq = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "not found" },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: mockEq,
      single: mockSingle,
    });

    const params = Promise.resolve({ code: "ABC123" });
    const res = await GET(makeRequest("ABC123"), { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Session not found");
  });

  it("returns 404 when data is null (no error)", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const params = Promise.resolve({ code: "ABC123" });
    const res = await GET(makeRequest("ABC123"), { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Session not found");
  });

  it("returns 200 with session data on success", async () => {
    const sessionData = { id: "session-1", code: "ABC123", facilitator_id: "user-1" };
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: sessionData, error: null }),
    });

    const params = Promise.resolve({ code: "ABC123" });
    const res = await GET(makeRequest("ABC123"), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(sessionData);
  });

  it("uses code.toUpperCase() when querying (passes lowercase, asserts uppercase in .eq)", async () => {
    const mockEq = vi.fn().mockReturnThis();
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: mockEq,
      single: vi.fn().mockResolvedValue({
        data: { id: "session-1", code: "ABC123" },
        error: null,
      }),
    });

    const params = Promise.resolve({ code: "abc123" });
    const res = await GET(makeRequest("abc123"), { params });
    expect(res.status).toBe(200);
    expect(mockEq).toHaveBeenCalledWith("code", "ABC123");
  });
});
