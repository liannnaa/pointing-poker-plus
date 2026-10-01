import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Supabase service mock ----------
const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ single: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockServiceClient = { from: mockFrom };

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn().mockReturnValue(mockServiceClient),
}));

// ---------- Encryption mock ----------
vi.mock("@/lib/jira/encryption", () => ({
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
}));

// ---------- ADF / Markdown mock ----------
vi.mock("@/lib/jira/adf-markdown", () => ({
  markdownToAdf: vi.fn((md: string) => ({ type: "doc", version: 1, content: [], _md: md })),
}));

// ---------- Module under test (imported after mocks) ----------
const {
  loadCredentials,
  createSprint,
  moveIssuesToSprint,
  moveIssuesToBacklog,
  getIssuePoints,
  SPRINT_MOVE_BATCH_SIZE,
  validateCredentials,
  detectStoryPointsField,
  detectAcField,
  listBoardQuickFilters,
  listBoards,
  listSprints,
  listSprintIssues,
  listBacklogIssues,
  getIssue,
  updateStoryPoints,
  fetchAttachmentContent,
  uploadIssueAttachment,
  updateIssueFields,
  searchUsers,
  updateIssueAssignee,
} = await import("@/lib/jira/client");

// ---------- Shared test fixtures ----------
const OPTS = {
  email: "user@example.com",
  token: "my-token",
  baseUrl: "https://example.atlassian.net",
};

/** Helper to build a minimal Response-like mock. */
function makeResponse(
  body: unknown,
  {
    ok = true,
    status = 200,
    headers = {} as Record<string, string>,
  }: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
) {
  const headersMap = new Map(Object.entries(headers));
  return {
    ok,
    status,
    headers: {
      get: (key: string) => headersMap.get(key.toLowerCase()) ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode("bytes").buffer),
  };
}

// ---------- beforeEach ----------
beforeEach(() => {
  vi.clearAllMocks();
  // Reset Supabase chain stubs to pass-through defaults
  mockSingle.mockResolvedValue({ data: null, error: null });
  mockEq.mockReturnValue({ single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({ select: mockSelect });
});

// ==========================================================================
// loadCredentials
// ==========================================================================
describe("loadCredentials", () => {
  it("returns null when supabase returns an error", async () => {
    mockSingle.mockResolvedValue({ data: null, error: new Error("db error") });
    const result = await loadCredentials("user-1");
    expect(result).toBeNull();
  });

  it("returns null when data is null and no error", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const result = await loadCredentials("user-1");
    expect(result).toBeNull();
  });

  it("returns shaped credentials when data is present", async () => {
    mockSingle.mockResolvedValue({
      data: {
        email: "a@b.com",
        base_url: "https://x.atlassian.net",
        encrypted_token: "enc-tok",
        story_points_field: "customfield_10026",
        project_key: "PROJ",
        ac_field: "customfield_10113",
      },
      error: null,
    });
    const result = await loadCredentials("user-1");
    expect(result).toEqual({
      email: "a@b.com",
      baseUrl: "https://x.atlassian.net",
      token: "decrypted:enc-tok",
      storyPointsField: "customfield_10026",
      projectKey: "PROJ",
      acField: "customfield_10113",
    });
  });

  it("maps null project_key to undefined", async () => {
    mockSingle.mockResolvedValue({
      data: {
        email: "a@b.com",
        base_url: "https://x.atlassian.net",
        encrypted_token: "enc",
        story_points_field: "customfield_10026",
        project_key: null,
        ac_field: null,
      },
      error: null,
    });
    const result = await loadCredentials("user-1");
    expect(result!.projectKey).toBeUndefined();
    expect(result!.acField).toBeUndefined();
  });

  it("calls decrypt with the encrypted token", async () => {
    const { decrypt } = await import("@/lib/jira/encryption");
    mockSingle.mockResolvedValue({
      data: {
        email: "a@b.com",
        base_url: "https://x.atlassian.net",
        encrypted_token: "super-secret",
        story_points_field: "customfield_10026",
        project_key: null,
        ac_field: null,
      },
      error: null,
    });
    await loadCredentials("user-1");
    expect(decrypt).toHaveBeenCalledWith("super-secret");
  });

  it("queries the correct table with the user id", async () => {
    mockSingle.mockResolvedValue({
      data: {
        email: "a@b.com",
        base_url: "https://x.atlassian.net",
        encrypted_token: "enc",
        story_points_field: "customfield_10026",
        project_key: null,
        ac_field: null,
      },
      error: null,
    });
    await loadCredentials("user-42");
    expect(mockFrom).toHaveBeenCalledWith("jira_credentials");
    expect(mockEq).toHaveBeenCalledWith("user_id", "user-42");
  });
});

// ==========================================================================
// validateCredentials
// ==========================================================================
describe("validateCredentials", () => {
  it("calls jiraFetch with /rest/api/3/myself and returns the result", async () => {
    const user = { accountId: "abc", emailAddress: "a@b.com", displayName: "A", active: true };
    global.fetch = vi.fn().mockResolvedValue(makeResponse(user));
    const result = await validateCredentials(OPTS);
    expect(result).toEqual(user);
    expect(global.fetch).toHaveBeenCalledOnce();
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/api/3/myself");
  });

  it("throws when jira returns a non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse("Unauthorized", { ok: false, status: 401 }));
    await expect(validateCredentials(OPTS)).rejects.toThrow("Jira API 401");
  });
});

// ==========================================================================
// jiraFetch internals (via validateCredentials as a proxy)
// ==========================================================================
describe("jiraFetch internals", () => {
  it("returns undefined for 204 responses", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(undefined, { status: 204 }));
    const result = await validateCredentials(OPTS);
    expect(result).toBeUndefined();
  });

  it("returns undefined when content-length header is '0'", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse(undefined, { status: 200, headers: { "content-length": "0" } })
    );
    const result = await validateCredentials(OPTS);
    expect(result).toBeUndefined();
  });

  it("throws with status and text when response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse("Not Found", { ok: false, status: 404 })
    );
    await expect(validateCredentials(OPTS)).rejects.toThrow("Jira API 404: Not Found");
  });

  it("includes a Basic Authorization header", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ accountId: "x" }));
    await validateCredentials(OPTS);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const expected = Buffer.from(`${OPTS.email}:${OPTS.token}`).toString("base64");
    expect(init.headers.Authorization).toBe(`Basic ${expected}`);
  });
});

// ==========================================================================
// detectStoryPointsField
// ==========================================================================
describe("detectStoryPointsField", () => {
  it("returns a field key from createmeta when a 'story point' field is present", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse({
        fields: {
          customfield_10016: { name: "Story Points" },
          summary: { name: "Summary" },
        },
      })
    );
    const result = await detectStoryPointsField(OPTS);
    expect(result).toBe("customfield_10016");
  });

  it("returns a field key when name includes 'story point estimate'", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse({
        fields: {
          customfield_10028: { name: "Story point estimate" },
        },
      })
    );
    const result = await detectStoryPointsField(OPTS);
    expect(result).toBe("customfield_10028");
  });

  it("falls back to /rest/api/3/field when createmeta fails", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse("Error", { ok: false, status: 500 }))
      .mockResolvedValueOnce(
        makeResponse([
          { id: "customfield_10020", name: "Story Points" },
          { id: "customfield_10021", name: "Other field" },
        ])
      );
    const result = await detectStoryPointsField(OPTS);
    expect(result).toBe("customfield_10020");
  });

  it("returns 'customfield_10026' when both endpoints fail", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse("Error", { ok: false, status: 500 }))
      .mockResolvedValueOnce(makeResponse("Error", { ok: false, status: 500 }));
    const result = await detectStoryPointsField(OPTS);
    expect(result).toBe("customfield_10026");
  });

  it("returns 'customfield_10026' when createmeta has no matching field and /field also has none", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ fields: { summary: { name: "Summary" } } }))
      .mockResolvedValueOnce(makeResponse([{ id: "customfield_99", name: "Sprint" }]));
    const result = await detectStoryPointsField(OPTS);
    expect(result).toBe("customfield_10026");
  });
});

// ==========================================================================
// detectAcField
// ==========================================================================
describe("detectAcField", () => {
  it("returns the id of the acceptance criteria field", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse([
        { id: "customfield_10113", name: "Acceptance Criteria" },
        { id: "customfield_10020", name: "Story Points" },
      ])
    );
    const result = await detectAcField(OPTS);
    expect(result).toBe("customfield_10113");
  });

  it("is case-insensitive when matching 'acceptance criteria'", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse([{ id: "customfield_10114", name: "ACCEPTANCE CRITERIA" }])
    );
    const result = await detectAcField(OPTS);
    expect(result).toBe("customfield_10114");
  });

  it("returns null when no matching field is found", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse([{ id: "customfield_10020", name: "Story Points" }])
    );
    const result = await detectAcField(OPTS);
    expect(result).toBeNull();
  });

  it("returns null when the fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse("Error", { ok: false, status: 500 }));
    const result = await detectAcField(OPTS);
    expect(result).toBeNull();
  });
});

// ==========================================================================
// listBoardQuickFilters
// ==========================================================================
describe("listBoardQuickFilters", () => {
  it("returns quick filters from the board config", async () => {
    const filters = [{ id: 1, name: "My Issues", query: "assignee = currentUser()" }];
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ quickFilters: filters }));
    const result = await listBoardQuickFilters(OPTS, 42);
    expect(result).toEqual(filters);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/agile/1.0/board/42/configuration");
  });

  it("returns empty array when quickFilters is absent from config", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse({}));
    const result = await listBoardQuickFilters(OPTS, 42);
    expect(result).toEqual([]);
  });
});

// ==========================================================================
// listBoards
// ==========================================================================
describe("listBoards", () => {
  it("fetches boards without projectKey when not provided", async () => {
    const boards = [{ id: 1, name: "Board 1", type: "scrum" }];
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ values: boards }));
    const result = await listBoards(OPTS);
    expect(result).toEqual(boards);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("type=scrum");
    expect(url).not.toContain("projectKeyOrId");
  });

  it("includes projectKeyOrId param when projectKey is provided", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ values: [] }));
    await listBoards(OPTS, "PROJ");
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("projectKeyOrId=PROJ");
  });
});

// ==========================================================================
// listSprints
// ==========================================================================
describe("listSprints", () => {
  it("returns sprint values for a board", async () => {
    const sprints = [{ id: 10, name: "Sprint 1", state: "active" }];
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ values: sprints }));
    const result = await listSprints(OPTS, 5);
    expect(result).toEqual(sprints);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/agile/1.0/board/5/sprint");
  });
});

// ==========================================================================
// listSprintIssues
// ==========================================================================
describe("listSprintIssues", () => {
  it("returns issues for a sprint", async () => {
    const issues = [{ id: "1", key: "PROJ-1", fields: { summary: "Do thing" } }];
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ issues }));
    const result = await listSprintIssues(OPTS, 7, 99, "customfield_10026");
    expect(result).toEqual(issues);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/agile/1.0/board/7/sprint/99/issue");
    expect(url).toContain("customfield_10026");
  });

  it("scopes the request to the board so other boards' issues can't leak in", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ issues: [] }));
    await listSprintIssues(OPTS, 7, 99, "customfield_10026");
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // The unscoped /sprint/{id}/issue route returns every board's issues.
    expect(url).not.toMatch(/\/rest\/agile\/1\.0\/sprint\//);
  });
});

// ==========================================================================
// listBacklogIssues
// ==========================================================================
describe("listBacklogIssues", () => {
  it("returns backlog issues for a board", async () => {
    const issues = [{ id: "2", key: "PROJ-2", fields: { summary: "Backlog item" } }];
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ issues }));
    const result = await listBacklogIssues(OPTS, 7, "customfield_10026");
    expect(result).toEqual(issues);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/agile/1.0/board/7/backlog");
    expect(url).toContain("customfield_10026");
  });
});

// ==========================================================================
// getIssue
// ==========================================================================
describe("getIssue", () => {
  const issue = { id: "3", key: "PROJ-3", fields: { summary: "My issue" } };

  it("fetches an issue without acField in fields param", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(issue));
    const result = await getIssue(OPTS, "PROJ-3", "customfield_10026");
    expect(result).toEqual(issue);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/api/3/issue/PROJ-3");
    expect(url).toContain("customfield_10026");
    expect(url).not.toContain("customfield_10113");
  });

  it("includes acField in the fields param when provided", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(issue));
    await getIssue(OPTS, "PROJ-3", "customfield_10026", "customfield_10113");
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("customfield_10113");
  });
});

// ==========================================================================
// updateStoryPoints
// ==========================================================================
describe("updateStoryPoints", () => {
  it("sends a PUT request with the story points field in the body", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(null, { status: 204 }));
    await updateStoryPoints(OPTS, "PROJ-5", "customfield_10026", 8);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/api/3/issue/PROJ-5");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.fields["customfield_10026"]).toBe(8);
  });
});

// ==========================================================================
// fetchAttachmentContent
// ==========================================================================
describe("fetchAttachmentContent", () => {
  it("returns body and contentType from a successful response", async () => {
    const fakeBuffer = new TextEncoder().encode("image bytes").buffer;
    const res = {
      ok: true,
      status: 200,
      headers: { get: (key: string) => (key === "content-type" ? "image/png" : null) },
      arrayBuffer: vi.fn().mockResolvedValue(fakeBuffer),
      text: vi.fn(),
    };
    global.fetch = vi.fn().mockResolvedValue(res);
    const result = await fetchAttachmentContent(OPTS, "att-123");
    expect(result.contentType).toBe("image/png");
    expect(result.body).toBe(fakeBuffer);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/api/3/attachment/content/att-123");
  });

  it("uses fallback content-type 'application/octet-stream' when header is null", async () => {
    const res = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      text: vi.fn(),
    };
    global.fetch = vi.fn().mockResolvedValue(res);
    const result = await fetchAttachmentContent(OPTS, "att-456");
    expect(result.contentType).toBe("application/octet-stream");
  });

  it("throws on non-ok response", async () => {
    const res = {
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: vi.fn().mockResolvedValue("Not Found"),
      arrayBuffer: vi.fn(),
    };
    global.fetch = vi.fn().mockResolvedValue(res);
    await expect(fetchAttachmentContent(OPTS, "att-789")).rejects.toThrow("Jira API 404");
  });

  it("sets redirect: follow on the fetch call", async () => {
    const res = {
      ok: true,
      status: 200,
      headers: { get: () => "application/pdf" },
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      text: vi.fn(),
    };
    global.fetch = vi.fn().mockResolvedValue(res);
    await fetchAttachmentContent(OPTS, "att-001");
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.redirect).toBe("follow");
  });
});

// ==========================================================================
// uploadIssueAttachment
// ==========================================================================
describe("uploadIssueAttachment", () => {
  const file = new File(["hello"], "hello.png", { type: "image/png" });

  it("returns first element when response is an array", async () => {
    const attachment = { id: "10001", filename: "hello.png" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue([attachment]),
      text: vi.fn(),
    });
    const result = await uploadIssueAttachment(OPTS, "PROJ-1", file);
    expect(result).toEqual(attachment);
  });

  it("returns the data directly when response is not an array", async () => {
    const attachment = { id: "10002", filename: "hello.png" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue(attachment),
      text: vi.fn(),
    });
    const result = await uploadIssueAttachment(OPTS, "PROJ-1", file);
    expect(result).toEqual(attachment);
  });

  it("returns null when json() throws", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: vi.fn().mockRejectedValue(new Error("invalid json")),
      text: vi.fn(),
    });
    const result = await uploadIssueAttachment(OPTS, "PROJ-1", file);
    expect(result).toBeNull();
  });

  it("returns null when response is an empty array", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue([]),
      text: vi.fn(),
    });
    const result = await uploadIssueAttachment(OPTS, "PROJ-1", file);
    expect(result).toBeNull();
  });

  it("throws on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      headers: { get: () => null },
      text: vi.fn().mockResolvedValue("Request Entity Too Large"),
      json: vi.fn(),
    });
    await expect(uploadIssueAttachment(OPTS, "PROJ-1", file)).rejects.toThrow("Jira API 413");
  });

  it("sends FormData and X-Atlassian-Token header", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue([{ id: "1" }]),
      text: vi.fn(),
    });
    await uploadIssueAttachment(OPTS, "PROJ-10", file);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/api/3/issue/PROJ-10/attachments");
    expect(init.headers["X-Atlassian-Token"]).toBe("no-check");
    expect(init.body).toBeInstanceOf(FormData);
  });
});

// ==========================================================================
// updateIssueFields
// ==========================================================================
describe("updateIssueFields", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(null, { status: 204 }));
  });

  it("sends summary when provided", async () => {
    await updateIssueFields(OPTS, "PROJ-1", { summary: "New title" });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.fields.summary).toBe("New title");
  });

  it("converts description markdown to ADF", async () => {
    const { markdownToAdf } = await import("@/lib/jira/adf-markdown");
    await updateIssueFields(OPTS, "PROJ-1", { description: "## Heading" });
    expect(markdownToAdf).toHaveBeenCalledWith("## Heading");
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.fields.description).toMatchObject({ type: "doc", _md: "## Heading" });
  });

  it("converts AC value markdown to ADF and sets it under acField", async () => {
    const { markdownToAdf } = await import("@/lib/jira/adf-markdown");
    await updateIssueFields(OPTS, "PROJ-1", {
      acField: "customfield_10113",
      acValue: "Given something",
    });
    expect(markdownToAdf).toHaveBeenCalledWith("Given something");
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.fields["customfield_10113"]).toMatchObject({ _md: "Given something" });
  });

  it("omits description when not provided", async () => {
    await updateIssueFields(OPTS, "PROJ-1", { summary: "Only summary" });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.fields).not.toHaveProperty("description");
  });

  it("omits ac field when acField is undefined", async () => {
    await updateIssueFields(OPTS, "PROJ-1", { acValue: "some AC" });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(Object.keys(body.fields)).not.toContain(undefined);
    // body.fields should not have any AC-related key since acField is missing
    expect(Object.keys(body.fields).length).toBe(0);
  });

  it("sends a PUT to the correct issue endpoint", async () => {
    await updateIssueFields(OPTS, "PROJ-99", { summary: "x" });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/api/3/issue/PROJ-99");
    expect(init.method).toBe("PUT");
  });
});

// ==========================================================================
// createSprint
// ==========================================================================
describe("createSprint", () => {
  beforeEach(() => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse({ id: 42, name: "Sprint 42", state: "future" }));
  });

  it("POSTs to the agile sprint endpoint with the origin board", async () => {
    const sprint = await createSprint(OPTS, { boardId: 7, name: "Sprint 42" });

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/agile/1.0/sprint");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ originBoardId: 7, name: "Sprint 42" });
    expect(sprint.id).toBe(42);
  });

  it("includes optional dates and goal when provided", async () => {
    await createSprint(OPTS, {
      boardId: 7,
      name: "Sprint 42",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-14T00:00:00.000Z",
      goal: "Ship it",
    });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.startDate).toBe("2026-01-01T00:00:00.000Z");
    expect(body.endDate).toBe("2026-01-14T00:00:00.000Z");
    expect(body.goal).toBe("Ship it");
  });

  it("propagates Jira errors", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse("Forbidden", { ok: false, status: 403 }));
    await expect(createSprint(OPTS, { boardId: 7, name: "S" })).rejects.toThrow("Jira API 403");
  });
});

// ==========================================================================
// moveIssuesToSprint
// ==========================================================================
describe("moveIssuesToSprint", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(undefined, { status: 204 }));
  });

  it("moves all issues in a single request when under the batch limit", async () => {
    const result = await moveIssuesToSprint(OPTS, 9, ["PROJ-1", "PROJ-2"]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/agile/1.0/sprint/9/issue");
    expect(JSON.parse(init.body)).toEqual({ issues: ["PROJ-1", "PROJ-2"] });
    expect(result.moved).toEqual(["PROJ-1", "PROJ-2"]);
    expect(result.failed).toEqual([]);
  });

  it("chunks requests at the Jira batch limit", async () => {
    const keys = Array.from({ length: SPRINT_MOVE_BATCH_SIZE + 5 }, (_, i) => `PROJ-${i}`);
    const result = await moveIssuesToSprint(OPTS, 9, keys);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const first = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(first.issues).toHaveLength(SPRINT_MOVE_BATCH_SIZE);
    expect(result.moved).toHaveLength(keys.length);
  });

  it("reports a failed batch without discarding successful ones", async () => {
    const keys = Array.from({ length: SPRINT_MOVE_BATCH_SIZE + 2 }, (_, i) => `PROJ-${i}`);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(undefined, { status: 204 }))
      .mockResolvedValueOnce(makeResponse("Bad", { ok: false, status: 400 }));

    const result = await moveIssuesToSprint(OPTS, 9, keys);

    expect(result.moved).toHaveLength(SPRINT_MOVE_BATCH_SIZE);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].keys).toHaveLength(2);
    expect(result.failed[0].error).toContain("Jira API 400");
  });

  it("does nothing for an empty key list", async () => {
    const result = await moveIssuesToSprint(OPTS, 9, []);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: [], failed: [] });
  });
});

// ==========================================================================
// moveIssuesToBacklog
// ==========================================================================
describe("moveIssuesToBacklog", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(undefined, { status: 204 }));
  });

  it("posts the keys to the backlog endpoint", async () => {
    const result = await moveIssuesToBacklog(OPTS, ["PROJ-1", "PROJ-2"]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/agile/1.0/backlog/issue");
    expect(JSON.parse(init.body)).toEqual({ issues: ["PROJ-1", "PROJ-2"] });
    expect(result.removed).toEqual(["PROJ-1", "PROJ-2"]);
    expect(result.failed).toEqual([]);
  });

  it("chunks requests at the Jira batch limit", async () => {
    const keys = Array.from({ length: SPRINT_MOVE_BATCH_SIZE + 3 }, (_, i) => `PROJ-${i}`);
    const result = await moveIssuesToBacklog(OPTS, keys);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.removed).toHaveLength(keys.length);
  });

  it("reports a failed batch without discarding successful ones", async () => {
    const keys = Array.from({ length: SPRINT_MOVE_BATCH_SIZE + 2 }, (_, i) => `PROJ-${i}`);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(undefined, { status: 204 }))
      .mockResolvedValueOnce(makeResponse("Bad", { ok: false, status: 400 }));

    const result = await moveIssuesToBacklog(OPTS, keys);

    expect(result.removed).toHaveLength(SPRINT_MOVE_BATCH_SIZE);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("Jira API 400");
  });

  it("does nothing for an empty key list", async () => {
    const result = await moveIssuesToBacklog(OPTS, []);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ removed: [], failed: [] });
  });
});

// ==========================================================================
// getIssuePoints
// ==========================================================================
describe("getIssuePoints", () => {
  it("returns the summary and numeric story points", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse({ fields: { summary: "A ticket", customfield_10026: 5 } })
    );

    const result = await getIssuePoints(OPTS, "PROJ-1", "customfield_10026");

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain(
      "/rest/api/3/issue/PROJ-1?fields=summary,assignee,customfield_10026"
    );
    expect(result).toEqual({ summary: "A ticket", points: 5, assignee: null });
  });

  it("returns null points when the field is unset", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse({ fields: { summary: "A ticket", customfield_10026: null } })
    );
    const result = await getIssuePoints(OPTS, "PROJ-1", "customfield_10026");
    expect(result.points).toBeNull();
  });

  it("falls back to the issue key when the summary is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ fields: {} }));
    const result = await getIssuePoints(OPTS, "PROJ-7", "customfield_10026");
    expect(result).toEqual({ summary: "PROJ-7", points: null, assignee: null });
  });

  it("returns the Jira assignee so the plan can pre-fill it", async () => {
    const assignee = {
      accountId: "acc-1",
      displayName: "Ada Lovelace",
      emailAddress: "ada@example.com",
    };
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse({ fields: { summary: "A ticket", assignee } }));

    const result = await getIssuePoints(OPTS, "PROJ-1", "customfield_10026");
    expect(result.assignee).toEqual(assignee);
  });

  it("ignores an assignee with no accountId", async () => {
    // Jira can return a partial user for a deleted account; without an
    // accountId there is nothing the roster or a write-back can key on.
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse({ fields: { summary: "A ticket", assignee: { displayName: "Ghost" } } })
    );

    const result = await getIssuePoints(OPTS, "PROJ-1", "customfield_10026");
    expect(result.assignee).toBeNull();
  });

  it("URL-encodes the issue key", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse({ fields: { summary: "x" } }));
    await getIssuePoints(OPTS, "PROJ/1", "customfield_10026");
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("PROJ%2F1");
  });
});

describe("searchUsers", () => {
  it("queries the user-search endpoint with an encoded query", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse([]));
    await searchUsers(OPTS, "a b@c.com");
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/api/3/user/search?query=a%20b%40c.com");
    expect(url).toContain("maxResults=20");
  });

  it("returns matching users", async () => {
    const users = [
      { accountId: "acc-1", displayName: "Alice", emailAddress: "a@x.com", active: true },
    ];
    global.fetch = vi.fn().mockResolvedValue(makeResponse(users));
    await expect(searchUsers(OPTS, "alice")).resolves.toEqual(users);
  });

  it("filters out inactive accounts", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse([
        { accountId: "acc-1", displayName: "Alice", active: true },
        { accountId: "acc-2", displayName: "Ghost", active: false },
      ])
    );
    const result = await searchUsers(OPTS, "a");
    expect(result.map((u) => u.accountId)).toEqual(["acc-1"]);
  });

  it("returns an empty array when Jira sends no body", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(undefined, { status: 204 }));
    await expect(searchUsers(OPTS, "a")).resolves.toEqual([]);
  });

  it("throws on a Jira permission error", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse("Forbidden", { ok: false, status: 403 }));
    await expect(searchUsers(OPTS, "a")).rejects.toThrow("Jira API 403");
  });
});

describe("updateIssueAssignee", () => {
  it("PUTs the accountId to the issue", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(undefined, { status: 204 }));
    await updateIssueAssignee(OPTS, "PROJ-1", "acc-1");
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/rest/api/3/issue/PROJ-1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ fields: { assignee: { accountId: "acc-1" } } });
  });

  it("sends a null assignee to unassign", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(undefined, { status: 204 }));
    await updateIssueAssignee(OPTS, "PROJ-1", null);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ fields: { assignee: null } });
  });

  it("URL-encodes the issue key", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(undefined, { status: 204 }));
    await updateIssueAssignee(OPTS, "PROJ/1", "acc-1");
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("PROJ%2F1");
  });

  it("propagates Jira errors", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse("Nope", { ok: false, status: 400 }));
    await expect(updateIssueAssignee(OPTS, "PROJ-1", "acc-1")).rejects.toThrow("Jira API 400");
  });
});
