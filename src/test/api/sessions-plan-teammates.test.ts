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

const { POST, PATCH, PUT } = await import(
  "@/app/api/sessions/[code]/plan/teammates/route"
);

const params = Promise.resolve({ code: "ABC123" });

const mockSession = {
  id: "session-1",
  facilitator_id: "facilitator-1",
  capacity_points: 40,
};

const teammateRow = {
  account_id: "acc-1",
  display_name: "Alice",
  email: "alice@example.com",
  avatar_url: null,
  capacity_points: 13,
  position: 0,
};

function sessionSelectMock(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
}

const upsert = vi.fn();
const updateEq2 = vi.fn();

/** Table-aware service mock — loadPlanState reads both plan tables. */
function serviceMock(teammateRows: unknown[] = [], itemRows: unknown[] = []) {
  return (table: string) => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({
          data: table === "sprint_teammates" ? teammateRows : itemRows,
          error: null,
        }),
      }),
    }),
    upsert,
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ eq: updateEq2 }),
    }),
  });
}

function jsonRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

const badJsonRequest = () =>
  ({ json: vi.fn().mockRejectedValue(new Error("bad")) }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "facilitator-1" } }, error: null });
  upsert.mockResolvedValue({ error: null });
  updateEq2.mockResolvedValue({ error: null });
  mockChannel.send.mockResolvedValue(undefined);
  mockServiceClient.channel.mockReturnValue(mockChannel);
  mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
  mockServiceFrom.mockImplementation(serviceMock([teammateRow]));
});

describe("POST /api/sessions/[code]/plan/teammates", () => {
  const body = {
    account_id: "acc-1",
    display_name: "Alice",
    email: "alice@example.com",
  };

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(jsonRequest(body), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the session does not exist", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(null, { message: "nope" }));
    const res = await POST(jsonRequest(body), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    const res = await POST(jsonRequest(body), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await POST(badJsonRequest(), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON");
  });

  it("returns 400 when validation fails", async () => {
    const res = await POST(jsonRequest({ account_id: "" }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("upserts the teammate, returns full plan state and broadcasts", async () => {
    const res = await POST(jsonRequest(body), { params });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "session-1",
        account_id: "acc-1",
        display_name: "Alice",
        email: "alice@example.com",
        avatar_url: null,
        capacity_points: null,
      }),
      { onConflict: "session_id,account_id" }
    );
    expect(payload.teammates).toHaveLength(1);
    expect(payload.capacity_points).toBe(40);
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plan:updated" })
    );
  });

  it("returns 500 when the upsert fails", async () => {
    upsert.mockResolvedValue({ error: { message: "denied" } });
    const res = await POST(jsonRequest(body), { params });
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/sessions/[code]/plan/teammates", () => {
  const body = { account_id: "acc-1", capacity_points: 8 };

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await PATCH(jsonRequest(body), { params });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    const res = await PATCH(jsonRequest(body), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await PATCH(badJsonRequest(), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when capacity_points is missing", async () => {
    const res = await PATCH(jsonRequest({ account_id: "acc-1" }), { params });
    expect(res.status).toBe(400);
  });

  it("updates the capacity and broadcasts", async () => {
    const res = await PATCH(jsonRequest(body), { params });
    expect(res.status).toBe(200);
    expect(updateEq2).toHaveBeenCalledWith("account_id", "acc-1");
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plan:updated" })
    );
  });

  it("accepts a null capacity to clear the target", async () => {
    const res = await PATCH(
      jsonRequest({ account_id: "acc-1", capacity_points: null }),
      { params }
    );
    expect(res.status).toBe(200);
  });

  it("returns 500 when the update fails", async () => {
    updateEq2.mockResolvedValue({ error: { message: "denied" } });
    const res = await PATCH(jsonRequest(body), { params });
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/sessions/[code]/plan/teammates — bulk rehydrate", () => {
  const body = {
    teammates: [
      { account_id: "acc-1", display_name: "Alice", capacity_points: 13 },
      { account_id: "acc-2", display_name: "Bob" },
    ],
  };

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await PUT(jsonRequest(body), { params });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    const res = await PUT(jsonRequest(body), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await PUT(badJsonRequest(), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the payload is not a teammate array", async () => {
    const res = await PUT(jsonRequest({ teammates: "nope" }), { params });
    expect(res.status).toBe(400);
  });

  it("upserts every teammate with a stable position", async () => {
    const res = await PUT(jsonRequest(body), { params });

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({ account_id: "acc-1", position: 0, capacity_points: 13 }),
        expect.objectContaining({ account_id: "acc-2", position: 1, capacity_points: null }),
      ],
      { onConflict: "session_id,account_id" }
    );
  });

  it("skips the write for an empty roster but still returns state", async () => {
    const res = await PUT(jsonRequest({ teammates: [] }), { params });
    expect(res.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
    expect((await res.json()).teammates).toHaveLength(1);
  });

  it("returns 500 when the bulk upsert fails", async () => {
    upsert.mockResolvedValue({ error: { message: "denied" } });
    const res = await PUT(jsonRequest(body), { params });
    expect(res.status).toBe(500);
  });
});
