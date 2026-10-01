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
const { POST } = await import(
  "@/app/api/sessions/[code]/join/route"
);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/sessions/ABC123/join", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const params = Promise.resolve({ code: "ABC123" });

describe("POST /api/sessions/[code]/join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest({ display_name: "Alice" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 when display_name is missing", async () => {
    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 when display_name is empty string", async () => {
    const res = await POST(makeRequest({ display_name: "   " }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when display_name exceeds 50 characters", async () => {
    const res = await POST(makeRequest({ display_name: "x".repeat(51) }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 404 when session not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const res = await POST(makeRequest({ display_name: "Alice" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 200 when join is successful", async () => {
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: "session-1" }, error: null }),
        };
      }
      return {
        upsert: upsertFn,
      };
    });
    const res = await POST(makeRequest({ display_name: "Alice" }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Alice", avatar_emoji: null }),
      { onConflict: "session_id,user_id" }
    );
  });

  it("returns 400 when avatar_emoji is not in the allow-list", async () => {
    const res = await POST(
      makeRequest({ display_name: "Alice", avatar_emoji: "🍕" }),
      { params }
    );
    expect(res.status).toBe(400);
  });

  it("stores the selected avatar_emoji on successful join", async () => {
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "sessions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: "session-1" }, error: null }),
        };
      }
      return {
        upsert: upsertFn,
      };
    });
    const res = await POST(
      makeRequest({ display_name: "Alice", avatar_emoji: "😀" }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Alice", avatar_emoji: "😀" }),
      { onConflict: "session_id,user_id" }
    );
  });
});
