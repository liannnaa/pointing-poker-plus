import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockServiceFrom = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ from: mockServiceFrom })),
}));

const mockLoadCredentials = vi.fn();
const mockFetchAttachmentContent = vi.fn();
const mockGetIssue = vi.fn();

vi.mock("@/lib/jira/client", () => ({
  loadCredentials: mockLoadCredentials,
  fetchAttachmentContent: mockFetchAttachmentContent,
  getIssue: mockGetIssue,
}));

const { GET } = await import("@/app/api/jira/attachment/[id]/route");

const CREDS = {
  email: "host@b.com",
  token: "tok",
  baseUrl: "https://x.atlassian.net",
  storyPointsField: "customfield_10026",
  acField: undefined,
};
const OPTS = { email: "host@b.com", token: "tok", baseUrl: "https://x.atlassian.net" };

function sessionRow(row: Record<string, unknown> | null) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row, error: null }),
  });
}

function participantRow(row: Record<string, unknown> | null) {
  mockServiceFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  });
}

function issueWithAttachments(attachments: Record<string, unknown>[]) {
  mockGetIssue.mockResolvedValue({
    id: "1",
    key: "PROJ-1",
    fields: { summary: "s", attachment: attachments },
  });
}

function request(url = "http://localhost/api/jira/attachment/10001?session_code=abc123") {
  return new NextRequest(url);
}

const call = (id = "10001", url?: string) =>
  GET(request(url), { params: Promise.resolve({ id }) });

describe("GET /api/jira/attachment/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
    mockLoadCredentials.mockResolvedValue(CREDS);
    sessionRow({ id: "s1", facilitator_id: "user-1", current_issue_key: "PROJ-1" });
    participantRow({ user_id: "user-2" });
    issueWithAttachments([
      { id: "10001", filename: "screenshot.png", mimeType: "image/png", size: 5 },
    ]);
    mockFetchAttachmentContent.mockResolvedValue({
      body: new TextEncoder().encode("png-bytes").buffer,
      contentType: "image/png",
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await call()).status).toBe(401);
  });

  it("returns 400 when session_code is missing", async () => {
    const res = await call("10001", "http://localhost/api/jira/attachment/10001");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the session does not exist", async () => {
    sessionRow(null);
    expect((await call()).status).toBe(404);
  });

  it("returns 403 when the caller has not joined the session", async () => {
    participantRow(null);
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockFetchAttachmentContent).not.toHaveBeenCalled();
  });

  it("returns 404 when no Jira issue is selected", async () => {
    sessionRow({ id: "s1", facilitator_id: "user-1", current_issue_key: null });
    expect((await call()).status).toBe(404);
  });

  it("returns 404 for a non-Jira round", async () => {
    sessionRow({ id: "s1", facilitator_id: "user-1", current_issue_key: "round-2" });
    expect((await call()).status).toBe(404);
  });

  it("returns 400 when the facilitator has no Jira credentials", async () => {
    mockLoadCredentials.mockResolvedValue(null);
    expect((await call()).status).toBe(400);
  });

  it("refuses an attachment that does not belong to the current issue", async () => {
    const res = await call("99999", "http://localhost/api/jira/attachment/99999?session_code=abc123");
    expect(res.status).toBe(403);
    expect(mockFetchAttachmentContent).not.toHaveBeenCalled();
  });

  it("streams the image for a joined non-facilitator participant", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(await res.text()).toBe("png-bytes");
  });

  it("serves the facilitator without a participants lookup", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockServiceFrom).not.toHaveBeenCalled();
  });

  it("uses the facilitator's credentials, not the requesting user's", async () => {
    await call();
    expect(mockLoadCredentials).toHaveBeenCalledWith("user-1");
    expect(mockFetchAttachmentContent).toHaveBeenCalledWith(OPTS, "10001");
  });

  it("neutralises HTML attachments instead of serving them inline", async () => {
    issueWithAttachments([
      { id: "10001", filename: "evil.html", mimeType: "text/html", size: 5 },
    ]);
    mockFetchAttachmentContent.mockResolvedValue({
      body: new TextEncoder().encode("<script>alert(1)</script>").buffer,
      contentType: "text/html",
    });

    const res = await call();
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("neutralises SVG attachments", async () => {
    issueWithAttachments([
      { id: "10001", filename: "x.svg", mimeType: "image/svg+xml", size: 5 },
    ]);
    const res = await call();
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("sanitises the filename in Content-Disposition", async () => {
    issueWithAttachments([
      { id: "10001", filename: 'a"b;drop.png', mimeType: "image/png", size: 5 },
    ]);
    const res = await call();
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="a_b_drop.png"'
    );
  });

  it("serves a PDF attachment inline", async () => {
    issueWithAttachments([
      { id: "10001", filename: "spec.pdf", mimeType: "application/pdf", size: 5 },
    ]);
    mockFetchAttachmentContent.mockResolvedValue({
      body: new TextEncoder().encode("%PDF-bytes").buffer,
      contentType: "application/pdf",
    });

    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
  });

  it("returns 502 when Jira rejects the content request", async () => {
    mockFetchAttachmentContent.mockRejectedValue(new Error("Jira API 404: gone"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Jira API 404");
  });
});
