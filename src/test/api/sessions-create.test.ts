import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase server client ──────────────────────────────────────────────
const mockGetUser = vi.fn();
const mockInsert = vi.fn();
const mockFrom = vi.fn(() => ({ insert: mockInsert }));
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

// ── Mock session code generator ──────────────────────────────────────────────
const mockGenerateSessionCode = vi.fn();
vi.mock("@/lib/session/codes", () => ({
  generateSessionCode: mockGenerateSessionCode,
}));

// ── Import handler after mocks ───────────────────────────────────────────────
const { POST } = await import("@/app/api/sessions/route");

describe("POST /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockGenerateSessionCode.mockReturnValue("ABC123");
    mockInsert.mockResolvedValue({ error: null });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Not authenticated");
  });

  it("returns 201 with code on success", async () => {
    mockGenerateSessionCode.mockReturnValue("XYZ789");
    mockInsert.mockResolvedValue({ error: null });
    const res = await POST();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toBe("XYZ789");
  });

  it("retries on 23505 unique constraint collision and succeeds on second attempt", async () => {
    mockGenerateSessionCode
      .mockReturnValueOnce("AAAA11")
      .mockReturnValueOnce("BBBB22");
    mockInsert
      .mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } })
      .mockResolvedValueOnce({ error: null });

    const res = await POST();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toBe("BBBB22");
    expect(mockGenerateSessionCode).toHaveBeenCalledTimes(2);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("returns 500 after 5 consecutive 23505 collisions", async () => {
    mockGenerateSessionCode.mockReturnValue("CCCC33");
    mockInsert.mockResolvedValue({ error: { code: "23505", message: "duplicate" } });

    const res = await POST();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to generate unique session code");
    expect(mockInsert).toHaveBeenCalledTimes(5);
  });

  it("returns 500 on a non-collision DB error", async () => {
    mockInsert.mockResolvedValue({
      error: { code: "XXXXXX", message: "unexpected database error" },
    });

    const res = await POST();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("unexpected database error");
    // Should not retry on non-collision errors
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
