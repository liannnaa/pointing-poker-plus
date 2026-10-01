import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockLoadCredentials = vi.fn();
const mockUploadIssueAttachment = vi.fn();
const mockGetIssue = vi.fn();

vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  uploadIssueAttachment: mockUploadIssueAttachment,
  getIssue: mockGetIssue,
}));

const mockChannel = { send: vi.fn().mockResolvedValue(undefined) };
const mockServiceClient = {
  channel: vi.fn().mockReturnValue(mockChannel),
  removeChannel: vi.fn().mockResolvedValue(undefined),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn().mockReturnValue(mockServiceClient),
}));

const { POST } = await import("@/app/api/jira/issue/[key]/attachments/route");

describe("POST /api/jira/issue/[key]/attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockLoadCredentials.mockResolvedValue({
      email: "a@b.com",
      token: "tok",
      baseUrl: "https://x.atlassian.net",
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const form = new FormData();
    form.set("file", new File(["abc"], "image.png", { type: "image/png" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the current user is not the facilitator", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { facilitator_id: "user-2" },
        error: null,
      }),
    });

    const form = new FormData();
    form.set("file", new File(["abc"], "image.png", { type: "image/png" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 400 when the uploaded file is not an image", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { facilitator_id: "user-1" },
        error: null,
      }),
    });

    const form = new FormData();
    form.set("file", new File(["abc"], "notes.txt", { type: "text/plain" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    expect(res.status).toBe(400);
  });

  it("uploads an image to Jira for the facilitator", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { facilitator_id: "user-1" },
        error: null,
      }),
    });
    mockUploadIssueAttachment.mockResolvedValue({
      id: "att-1",
      filename: "image.png",
    });
    mockGetIssue.mockResolvedValue({ key: "PROJ-1", fields: { summary: "Ticket" } });

    const form = new FormData();
    form.set("file", new File(["abc"], "image.png", { type: "image/png" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.attachment.filename).toBe("image.png");
    expect(mockUploadIssueAttachment).toHaveBeenCalledWith(
      { email: "a@b.com", token: "tok", baseUrl: "https://x.atlassian.net" },
      "PROJ-1",
      expect.any(File)
    );
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: "issue:updated" })
    );
  });

  it("still returns 200 when the post-upload issue refresh fails (non-fatal)", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { facilitator_id: "user-1" },
        error: null,
      }),
    });
    mockUploadIssueAttachment.mockResolvedValue({
      id: "att-1",
      filename: "image.png",
    });
    mockGetIssue.mockRejectedValue(new Error("fetch failed"));

    const form = new FormData();
    form.set("file", new File(["abc"], "image.png", { type: "image/png" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  // ── Line 22: missing session_code query param ─────────────────────────────

  it("returns 400 when session_code query param is missing", async () => {
    const form = new FormData();
    form.set("file", new File(["abc"], "image.png", { type: "image/png" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/session_code/i);
  });

  // ── Line 35: session not found ─────────────────────────────────────────────

  it("returns 404 when session is not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const form = new FormData();
    form.set("file", new File(["abc"], "image.png", { type: "image/png" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=NOTFOUND",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    expect(res.status).toBe(404);
  });

  // ── Line 47: Jira credentials not found ───────────────────────────────────

  it("returns 400 when Jira credentials are not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { facilitator_id: "user-1" },
        error: null,
      }),
    });
    mockLoadCredentials.mockResolvedValue(null);

    const form = new FormData();
    form.set("file", new File(["abc"], "image.png", { type: "image/png" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/jira not connected/i);
  });

  // ── Line 57: request.formData() throws ────────────────────────────────────

  it("returns 400 when request.formData() throws", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { facilitator_id: "user-1" },
        error: null,
      }),
    });

    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST" }
    );
    // Override formData to throw
    req.formData = vi.fn().mockRejectedValue(new Error("parse error"));

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid form data/i);
  });

  // ── Line 70: file is present but size is 0 ────────────────────────────────

  it("returns 400 when the file size is 0", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { facilitator_id: "user-1" },
        error: null,
      }),
    });

    // Provide a FormData via a mock so we can control the file object directly
    const zeroSizeFile = new File([], "empty.png", { type: "image/png" });
    const mockForm = new FormData();
    // Override get() to return a File-like object with size=0 explicitly
    const fileLike = { size: 0, type: "image/png", name: "empty.png" };
    mockForm.get = vi.fn().mockReturnValue(fileLike);

    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST", body: new FormData() }
    );
    req.formData = vi.fn().mockResolvedValue(mockForm);

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid image or pdf file/i);
  });

  // ── Line 96: uploadIssueAttachment throws ─────────────────────────────────

  it("returns 502 when uploadIssueAttachment throws an Error", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { facilitator_id: "user-1" },
        error: null,
      }),
    });
    mockUploadIssueAttachment.mockRejectedValue(new Error("Jira API error"));

    const form = new FormData();
    form.set("file", new File(["abc"], "image.png", { type: "image/png" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Jira API error");
  });

  it("uploads a PDF to Jira for the facilitator", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { facilitator_id: "user-1" },
        error: null,
      }),
    });
    mockUploadIssueAttachment.mockResolvedValue({
      id: "att-2",
      filename: "spec.pdf",
    });
    mockGetIssue.mockResolvedValue({ key: "PROJ-1", fields: { summary: "Ticket" } });

    const form = new FormData();
    form.set("file", new File(["%PDF"], "spec.pdf", { type: "application/pdf" }));
    const req = new NextRequest(
      "http://localhost/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
      { method: "POST", body: form }
    );

    const res = await POST(req, { params: Promise.resolve({ key: "PROJ-1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.attachment.filename).toBe("spec.pdf");
  });
});
