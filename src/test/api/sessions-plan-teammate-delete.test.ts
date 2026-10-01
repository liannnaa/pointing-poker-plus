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

const { DELETE } = await import(
  "@/app/api/sessions/[code]/plan/teammates/[accountId]/route"
);

const params = Promise.resolve({ code: "ABC123", accountId: "acc-1" });

const mockSession = {
  id: "session-1",
  facilitator_id: "facilitator-1",
  capacity_points: null,
};

function sessionSelectMock(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
}

const deleteEq2 = vi.fn();
const updateEq2 = vi.fn();

function serviceMock(itemRows: unknown[] = [], teammateRows: unknown[] = []) {
  return (table: string) => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({
          data: table === "sprint_teammates" ? teammateRows : itemRows,
          error: null,
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ eq: deleteEq2 }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ eq: updateEq2 }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "facilitator-1" } }, error: null });
  deleteEq2.mockResolvedValue({ error: null });
  updateEq2.mockResolvedValue({ error: null });
  mockChannel.send.mockResolvedValue(undefined);
  mockServiceClient.channel.mockReturnValue(mockChannel);
  mockFrom.mockImplementation(() => sessionSelectMock(mockSession));
  mockServiceFrom.mockImplementation(serviceMock());
});

describe("DELETE /api/sessions/[code]/plan/teammates/[accountId]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the session does not exist", async () => {
    mockFrom.mockImplementation(() => sessionSelectMock(null, { message: "nope" }));
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-facilitators", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "guest-9" } }, error: null });
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(403);
  });

  it("removes the teammate and unassigns their tickets", async () => {
    const res = await DELETE({} as NextRequest, { params });

    expect(res.status).toBe(200);
    expect(deleteEq2).toHaveBeenCalledWith("account_id", "acc-1");
    expect(updateEq2).toHaveBeenCalledWith("assignee_account_id", "acc-1");
  });

  it("keeps the removed teammate's tickets in the plan as unassigned", async () => {
    mockServiceFrom.mockImplementation(
      serviceMock([
        {
          issue_key: "PROJ-1",
          summary: "First",
          points: 3,
          position: 0,
          assignee_account_id: null,
        },
      ])
    );

    const body = await (await DELETE({} as NextRequest, { params })).json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0].assignee_account_id).toBeNull();
    expect(body.total_points).toBe(3);
  });

  it("broadcasts the refreshed plan", async () => {
    await DELETE({} as NextRequest, { params });
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plan:updated" })
    );
  });

  it("decodes URL-encoded account ids", async () => {
    const res = await DELETE({} as NextRequest, {
      params: Promise.resolve({ code: "ABC123", accountId: "acc%2F1" }),
    });
    expect(res.status).toBe(200);
    expect(deleteEq2).toHaveBeenCalledWith("account_id", "acc/1");
  });

  it("returns 500 when the delete fails", async () => {
    deleteEq2.mockResolvedValue({ error: { message: "denied" } });
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(500);
  });

  it("returns 500 when unassigning fails", async () => {
    updateEq2.mockResolvedValue({ error: { message: "denied" } });
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(500);
  });
});
