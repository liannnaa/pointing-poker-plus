import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { toast } from "sonner";
import { IssuePanel } from "@/components/room/IssuePanel";
import type { JiraIssue, AdfNode } from "@/lib/jira/types";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeIssue(overrides?: Partial<JiraIssue["fields"]>): JiraIssue {
  return {
    id: "10001",
    key: "PROJ-1",
    fields: {
      summary: "Test story summary",
      status: { name: "To Do", statusCategory: { key: "new" } },
      issuetype: { name: "Story" },
      description: null,
      ...overrides,
    },
  };
}

function makeAdf(type: "paragraph" | "bulletList" | "orderedList", content: string[]): AdfNode {
  if (type === "paragraph") {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: content.map((text) => ({ type: "text", text })),
        },
      ],
    };
  }
  if (type === "bulletList") {
    return {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: content.map((text) => ({
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text }],
              },
            ],
          })),
        },
      ],
    };
  }
  // orderedList
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { order: 1 },
        content: content.map((text) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text }],
            },
          ],
        })),
      },
    ],
  };
}

const defaultProps = {
  sessionCode: "ABC123",
  isFacilitator: false,
  revealed: false,
  voteAverage: null,
  voteMedian: null,
};

describe("IssuePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders issue key and summary", () => {
    render(<IssuePanel issue={makeIssue()} {...defaultProps} />);
    expect(screen.getByText("PROJ-1")).toBeInTheDocument();
    expect(screen.getByText("Test story summary")).toBeInTheDocument();
  });

  it("renders issue type and status", () => {
    render(<IssuePanel issue={makeIssue()} {...defaultProps} />);
    expect(screen.getByText("Story")).toBeInTheDocument();
    expect(screen.getByText(/To Do/)).toBeInTheDocument();
  });

  it("renders assignee and priority when present", () => {
    const issue = makeIssue({
      assignee: { displayName: "Jane Doe" },
      priority: { name: "High" },
    });
    render(<IssuePanel issue={issue} {...defaultProps} />);
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    expect(screen.getByText(/High/)).toBeInTheDocument();
  });

  it("shows 'Open in Jira' link when jiraBaseUrl is provided", () => {
    render(
      <IssuePanel
        issue={makeIssue()}
        {...defaultProps}
        jiraBaseUrl="https://example.atlassian.net"
      />
    );
    const link = screen.getByRole("link", { name: /Open in Jira/i });
    expect(link).toHaveAttribute("href", "https://example.atlassian.net/browse/PROJ-1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("does not show Jira link when jiraBaseUrl is absent", () => {
    render(<IssuePanel issue={makeIssue()} {...defaultProps} />);
    expect(screen.queryByRole("link", { name: /Open in Jira/i })).not.toBeInTheDocument();
  });

  it("uploads an image to Jira when the facilitator clicks upload", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, attachment: { id: "att-1", filename: "screen.png" } }),
    });

    render(
      <IssuePanel
        issue={makeIssue()}
        {...defaultProps}
        isFacilitator={true}
      />
    );

    const file = new File(["abc"], "screen.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/jira/issue/PROJ-1/attachments?session_code=ABC123",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("shows a Refresh button for the facilitator and refetches the ticket on click", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, issue_key: "PROJ-1", issue: makeIssue() }),
    });

    render(
      <IssuePanel
        issue={makeIssue()}
        {...defaultProps}
        isFacilitator={true}
      />
    );

    const button = screen.getByRole("button", { name: /Refresh/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/jira/issue/PROJ-1/refresh",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ session_code: "ABC123" }),
        })
      );
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ticket refreshed from Jira"));
  });

  it("does not show a Refresh button for non-facilitators", () => {
    render(<IssuePanel issue={makeIssue()} {...defaultProps} isFacilitator={false} />);
    expect(screen.queryByRole("button", { name: /Refresh/i })).not.toBeInTheDocument();
  });

  it("shows toast.error when refresh fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Only the facilitator can refresh the ticket" }),
    });

    render(<IssuePanel issue={makeIssue()} {...defaultProps} isFacilitator={true} />);

    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only the facilitator can refresh the ticket")
    );
  });

  describe("ADF description rendering", () => {
    it("renders plain paragraph text", () => {
      const issue = makeIssue({ description: makeAdf("paragraph", ["This is the description"]) });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      expect(screen.getByText("This is the description")).toBeInTheDocument();
    });

    it("renders bullet list items", () => {
      const issue = makeIssue({
        description: makeAdf("bulletList", ["First bullet", "Second bullet"]),
      });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      expect(screen.getByText("First bullet")).toBeInTheDocument();
      expect(screen.getByText("Second bullet")).toBeInTheDocument();
      // Should render as <ul>
      const list = screen.getByRole("list");
      expect(list.tagName).toBe("UL");
    });

    it("renders ordered list items", () => {
      const issue = makeIssue({
        description: makeAdf("orderedList", ["Step one", "Step two"]),
      });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      expect(screen.getByText("Step one")).toBeInTheDocument();
      expect(screen.getByText("Step two")).toBeInTheDocument();
      const list = screen.getByRole("list");
      expect(list.tagName).toBe("OL");
    });

    it("renders bold text via strong mark", () => {
      const issue = makeIssue({
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "bold text",
                  marks: [{ type: "strong" }],
                },
              ],
            },
          ],
        },
      });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      const strong = document.querySelector("strong");
      expect(strong).toBeInTheDocument();
      expect(strong?.textContent).toBe("bold text");
    });

    it("renders italic text via em mark", () => {
      const issue = makeIssue({
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "italic text",
                  marks: [{ type: "em" }],
                },
              ],
            },
          ],
        },
      });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      const em = document.querySelector("em");
      expect(em).toBeInTheDocument();
      expect(em?.textContent).toBe("italic text");
    });

    it("renders inline code via code mark", () => {
      const issue = makeIssue({
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "myFunc()",
                  marks: [{ type: "code" }],
                },
              ],
            },
          ],
        },
      });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      const code = document.querySelector("code");
      expect(code).toBeInTheDocument();
      expect(code?.textContent).toBe("myFunc()");
    });

    it("renders link via link mark", () => {
      const issue = makeIssue({
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "click here",
                  marks: [{ type: "link", attrs: { href: "https://example.com" } }],
                },
              ],
            },
          ],
        },
      });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      const link = screen.getByRole("link", { name: "click here" });
      expect(link).toHaveAttribute("href", "https://example.com");
    });

    it("renders code block", () => {
      const issue = makeIssue({
        description: {
          type: "doc",
          content: [
            {
              type: "codeBlock",
              attrs: { language: "typescript" },
              content: [{ type: "text", text: "const x = 1;" }],
            },
          ],
        },
      });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      const pre = document.querySelector("pre");
      expect(pre).toBeInTheDocument();
      expect(pre?.textContent).toBe("const x = 1;");
    });

    it("renders blockquote", () => {
      const issue = makeIssue({
        description: {
          type: "doc",
          content: [
            {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "quoted text" }],
                },
              ],
            },
          ],
        },
      });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      const blockquote = document.querySelector("blockquote");
      expect(blockquote).toBeInTheDocument();
      expect(blockquote?.textContent).toContain("quoted text");
    });

    it("renders heading nodes", () => {
      const issue = makeIssue({
        description: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Section heading" }],
            },
          ],
        },
      });
      render(<IssuePanel issue={issue} {...defaultProps} />);
      expect(screen.getByText("Section heading")).toBeInTheDocument();
    });

    it("renders hard break as <br>", () => {
      const issue = makeIssue({
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "line one" },
                { type: "hardBreak" },
                { type: "text", text: "line two" },
              ],
            },
          ],
        },
      });
      const { container } = render(<IssuePanel issue={issue} {...defaultProps} />);
      expect(container.querySelector("br")).toBeInTheDocument();
      // text nodes are split by <br> so check the paragraph's full textContent
      const para = container.querySelector("p.text-sm");
      expect(para?.textContent).toContain("line one");
      expect(para?.textContent).toContain("line two");
    });

    it("skips media nodes silently", () => {
      const issue = makeIssue({
        description: {
          type: "doc",
          content: [
            { type: "mediaSingle", content: [{ type: "media", attrs: { id: "abc" } }] },
          ],
        },
      });
      // Should not throw and should render without media
      const { container } = render(<IssuePanel issue={issue} {...defaultProps} />);
      expect(container.querySelector("img")).not.toBeInTheDocument();
    });
  });

  describe("Acceptance Criteria section", () => {
    it("renders AC section when acField and matching field exist", () => {
      const issue: JiraIssue = {
        id: "10001",
        key: "PROJ-1",
        fields: {
          summary: "Test",
          status: { name: "To Do", statusCategory: { key: "new" } },
          issuetype: { name: "Story" },
          customfield_10113: makeAdf("paragraph", ["Must pass all tests"]),
        },
      };
      render(
        <IssuePanel
          issue={issue}
          {...defaultProps}
          acField="customfield_10113"
        />
      );
      expect(screen.getByText("Acceptance Criteria")).toBeInTheDocument();
      expect(screen.getByText("Must pass all tests")).toBeInTheDocument();
    });

    it("does not render AC section when acField is null", () => {
      render(<IssuePanel issue={makeIssue()} {...defaultProps} acField={null} />);
      expect(screen.queryByText("Acceptance Criteria")).not.toBeInTheDocument();
    });

    it("does not render AC section when the field is missing from the issue", () => {
      render(
        <IssuePanel
          issue={makeIssue()}
          {...defaultProps}
          acField="customfield_10113"
        />
      );
      expect(screen.queryByText("Acceptance Criteria")).not.toBeInTheDocument();
    });
  });

  describe("Points submission (facilitator only, after reveal)", () => {
    it("does not show submit UI for non-facilitator", () => {
      render(
        <IssuePanel
          issue={makeIssue()}
          sessionCode="ABC123"
          isFacilitator={false}
          revealed={true}
          voteAverage={3}
          voteMedian={3}
        />
      );
      expect(screen.queryByRole("button", { name: /Submit/i })).not.toBeInTheDocument();
    });

    it("does not show submit UI before reveal", () => {
      render(
        <IssuePanel
          issue={makeIssue()}
          sessionCode="ABC123"
          isFacilitator={true}
          revealed={false}
          voteAverage={null}
          voteMedian={null}
        />
      );
      expect(screen.queryByRole("button", { name: /Submit/i })).not.toBeInTheDocument();
    });

    it("shows submit UI for facilitator after reveal", () => {
      render(
        <IssuePanel
          issue={makeIssue()}
          sessionCode="ABC123"
          isFacilitator={true}
          revealed={true}
          voteAverage={3}
          voteMedian={3}
        />
      );
      expect(screen.getByRole("button", { name: /Submit/i })).toBeInTheDocument();
    });

    it("pre-fills points with snapped value from voteAverage", () => {
      render(
        <IssuePanel
          issue={makeIssue()}
          sessionCode="ABC123"
          isFacilitator={true}
          revealed={true}
          voteAverage={4}
          voteMedian={4}
        />
      );
      const input = screen.getByRole("spinbutton") as HTMLInputElement;
      // 4 snaps to 5 (next deck value >= 4)
      expect(input.value).toBe("5");
    });

    it("snaps average of 2.5 to 3", () => {
      render(
        <IssuePanel
          issue={makeIssue()}
          sessionCode="ABC123"
          isFacilitator={true}
          revealed={true}
          voteAverage={2.5}
          voteMedian={2.5}
        />
      );
      const input = screen.getByRole("spinbutton") as HTMLInputElement;
      expect(input.value).toBe("3");
    });

    it("calls fetch and shows success message on submit", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      });

      render(
        <IssuePanel
          issue={makeIssue()}
          sessionCode="ABC123"
          isFacilitator={true}
          revealed={true}
          voteAverage={3}
          voteMedian={3}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

      await waitFor(() => {
        expect(screen.getByText(/points submitted to Jira/i)).toBeInTheDocument();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/jira/issue/PROJ-1",
        expect.objectContaining({ method: "PUT" })
      );
    });
  });
});

describe("IssuePanel editing workflow (facilitator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enters edit mode when the Edit button is clicked", async () => {
    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    // After clicking Edit, the summary input should appear
    expect(screen.getByPlaceholderText("Summary")).toBeInTheDocument();
  });

  it("shows description textarea in edit mode", async () => {
    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    expect(screen.getByPlaceholderText("Description (plain text)")).toBeInTheDocument();
  });

  it("shows AC textarea in edit mode when acField is provided", async () => {
    const issue: JiraIssue = {
      id: "10001",
      key: "PROJ-1",
      fields: {
        summary: "Test",
        status: { name: "To Do", statusCategory: { key: "new" } },
        issuetype: { name: "Story" },
        customfield_10113: makeAdf("paragraph", ["Existing AC"]),
      },
    };
    render(
      <IssuePanel
        issue={issue}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
        acField="customfield_10113"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    expect(screen.getByPlaceholderText("Acceptance criteria (plain text)")).toBeInTheDocument();
  });

  it("cancels edit mode when Cancel is clicked", async () => {
    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    expect(screen.getByPlaceholderText("Summary")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    // Should return to read mode — summary heading should be visible
    expect(screen.queryByPlaceholderText("Summary")).not.toBeInTheDocument();
    expect(screen.getByText("Test story summary")).toBeInTheDocument();
  });

  it("saves edits to Jira when Save to Jira is clicked", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));

    const summaryInput = screen.getByPlaceholderText("Summary");
    fireEvent.change(summaryInput, { target: { value: "Updated summary" } });

    fireEvent.click(screen.getByRole("button", { name: /Save to Jira/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/jira/issue/PROJ-1",
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  it("closes edit mode without fetching when nothing changed", async () => {
    global.fetch = vi.fn();

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    // Don't change anything, just save
    fireEvent.click(screen.getByRole("button", { name: /Save to Jira/i }));

    await waitFor(() => {
      // Should exit edit mode
      expect(screen.queryByPlaceholderText("Summary")).not.toBeInTheDocument();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("IssuePanel Jira images", () => {
  const attachment = {
    id: "10101",
    filename: "screenshot.png",
    mimeType: "image/png",
    size: 1234,
  };

  const docWithMedia: AdfNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "See below" }] },
      {
        type: "mediaSingle",
        attrs: { layout: "center" },
        content: [
          { type: "media", attrs: { id: "uuid-1", type: "file", collection: "c1" } },
        ],
      },
    ],
  };

  const expectedSrc =
    "/api/jira/attachment/10101?session_code=ABC123";

  it("renders an inline image from the description via the proxy route", () => {
    const issue = makeIssue({ description: docWithMedia, attachment: [attachment] });
    render(<IssuePanel issue={issue} {...defaultProps} />);

    const img = screen.getByAltText("screenshot.png");
    expect(img).toHaveAttribute("src", expectedSrc);
  });

  it("matches an inline image by filename when alt is present", () => {
    const other = { ...attachment, id: "10102", filename: "other.png" };
    const doc: AdfNode = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          content: [
            { type: "media", attrs: { id: "uuid-9", type: "file", alt: "other.png" } },
          ],
        },
      ],
    };
    const issue = makeIssue({ description: doc, attachment: [attachment, other] });
    render(<IssuePanel issue={issue} {...defaultProps} />);

    expect(screen.getByAltText("other.png")).toHaveAttribute(
      "src",
      "/api/jira/attachment/10102?session_code=ABC123"
    );
  });

  it("skips media nodes when the issue has no image attachments", () => {
    const issue = makeIssue({ description: docWithMedia, attachment: [] });
    render(<IssuePanel issue={issue} {...defaultProps} />);

    expect(screen.queryByAltText("screenshot.png")).not.toBeInTheDocument();
    expect(screen.getByText("See below")).toBeInTheDocument();
  });

  it("ignores non-image attachments", () => {
    const issue = makeIssue({
      description: docWithMedia,
      attachment: [{ id: "9", filename: "spec.pdf", mimeType: "application/pdf", size: 1 }],
    });
    render(<IssuePanel issue={issue} {...defaultProps} />);

    expect(screen.queryByAltText("spec.pdf")).not.toBeInTheDocument();
  });

  it("does not duplicate an inline image in the attachment gallery", () => {
    const issue = makeIssue({ description: docWithMedia, attachment: [attachment] });
    render(<IssuePanel issue={issue} {...defaultProps} />);

    expect(screen.getAllByAltText("screenshot.png")).toHaveLength(1);
    expect(screen.queryByText(/Attachments \(/)).not.toBeInTheDocument();
  });

  it("shows an attachment gallery for images not referenced inline", () => {
    const issue = makeIssue({ description: null, attachment: [attachment] });
    render(<IssuePanel issue={issue} {...defaultProps} />);

    expect(screen.getByText(/Attachments \(1\)/)).toBeInTheDocument();
    expect(screen.getByAltText("screenshot.png")).toHaveAttribute("src", expectedSrc);
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: new tests
// ---------------------------------------------------------------------------

describe("IssuePanel ADF rule node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders <hr> for a rule ADF node (line 277)", () => {
    const issue = makeIssue({
      description: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "before" }] },
          { type: "rule" },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      },
    });
    const { container } = render(<IssuePanel issue={issue} {...defaultProps} />);
    expect(container.querySelector("hr")).toBeInTheDocument();
  });

  it("returns null for unknown ADF node with no children (line 302)", () => {
    const issue = makeIssue({
      description: {
        type: "doc",
        content: [
          // unknown type with no content — hits the default return null branch
          { type: "unknownType" },
          { type: "paragraph", content: [{ type: "text", text: "visible" }] },
        ],
      },
    });
    render(<IssuePanel issue={issue} {...defaultProps} />);
    expect(screen.getByText("visible")).toBeInTheDocument();
  });

  it("renders children for unknown ADF node with children (default case with children)", () => {
    const issue = makeIssue({
      description: {
        type: "doc",
        content: [
          {
            type: "unknownWrapper",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "nested text" }] },
            ],
          },
        ],
      },
    });
    render(<IssuePanel issue={issue} {...defaultProps} />);
    expect(screen.getByText("nested text")).toBeInTheDocument();
  });
});

describe("IssuePanel handleSaveEdit error (line 416)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls toast.error when PATCH returns not-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Server error" }),
    });

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));

    const summaryInput = screen.getByPlaceholderText("Summary");
    fireEvent.change(summaryInput, { target: { value: "Changed summary" } });

    fireEvent.click(screen.getByRole("button", { name: /Save to Jira/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Server error");
    });
  });
});

describe("IssuePanel handleUploadImage edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early when no file is selected (lines 427-429)", async () => {
    global.fetch = vi.fn();

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeInTheDocument();

    // Fire change with an empty files list
    fireEvent.change(input, { target: { files: [] } });

    // fetch should NOT be called
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows toast.error for non-image/pdf file (line 449)", async () => {
    global.fetch = vi.fn();

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const textFile = new File(["x"], "doc.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [textFile] } });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Please choose an image or PDF file");
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows toast.error when image upload fetch throws (lines 459-460)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const imgFile = new File(["img"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [imgFile] } });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network failure");
    });
  });
});

describe("IssuePanel handleSubmitPoints invalid input (line 477)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows toast.error for negative point value and does not fetch (line 477)", async () => {
    global.fetch = vi.fn();

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={true}
        voteAverage={null}
        voteMedian={null}
      />
    );

    // Use -1 — accepted by number input but fails numPoints < 0 check
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-1" } });

    // Wait for the input to reflect the change
    await waitFor(() => expect(input.value).toBe("-1"));

    fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Enter a valid point value");
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("IssuePanel uploading/saving state text (lines 557-632)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Uploading...' button text while image upload is in progress (non-edit mode)", async () => {
    // fetch returns a promise that never resolves — keeps uploadingImage=true
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const imgFile = new File(["img"], "photo.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(input, { target: { files: [imgFile] } });
    });

    expect(screen.getByRole("button", { name: "Uploading..." })).toBeInTheDocument();
  });

  it("shows 'Saving...' button text while save is in progress (edit mode)", async () => {
    // fetch returns a promise that never resolves — keeps saving=true
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));

    const summaryInput = screen.getByPlaceholderText("Summary");
    fireEvent.change(summaryInput, { target: { value: "Changed summary" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save to Jira/i }));
    });

    // While fetch is pending, "Saving..." should appear
    expect(screen.getByRole("button", { name: "Saving..." })).toBeInTheDocument();
  });

  it("shows 'Uploading...' inside edit mode while image upload is in progress", async () => {
    // fetch returns a promise that never resolves — keeps uploadingImage=true
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));

    // In edit mode there's a second file input inside the edit controls
    const inputs = document.querySelectorAll('input[type="file"]');
    // There should be at least one file input in edit mode
    expect(inputs.length).toBeGreaterThan(0);

    const imgFile = new File(["img"], "photo.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(inputs[inputs.length - 1], { target: { files: [imgFile] } });
    });

    expect(screen.getByRole("button", { name: "Uploading..." })).toBeInTheDocument();
  });

  it("upload image button in edit mode is present and clicking does not crash", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));

    // "Upload file" button should be present in edit mode
    const uploadButtons = screen.getAllByRole("button", { name: /Upload file/i });
    expect(uploadButtons.length).toBeGreaterThan(0);

    // Clicking should not throw
    fireEvent.click(uploadButtons[uploadButtons.length - 1]);
  });
});

describe("IssuePanel submitted state (line 715)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'points submitted to Jira' after successful submit", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={true}
        voteAverage={3}
        voteMedian={3}
      />
    );

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    // Wait for the useEffect to set the value
    await waitFor(() => expect(input.value).not.toBe(""));

    fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

    await waitFor(() => {
      expect(screen.getByText(/points submitted to Jira/i)).toBeInTheDocument();
    });
  });
});

describe("IssuePanel handleSubmitPoints catch (line 477)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows toast.error when points submit fetch returns not-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Points update failed" }),
    });

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={true}
        voteAverage={3}
        voteMedian={3}
      />
    );

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    await waitFor(() => expect(input.value).not.toBe(""));

    fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Points update failed");
    });
  });

  it("shows toast.error when points submit fetch throws network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network down"));

    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={true}
        voteAverage={3}
        voteMedian={3}
      />
    );

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    await waitFor(() => expect(input.value).not.toBe(""));

    fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network down");
    });
  });
});

describe("IssuePanel edit mode textarea onChange handlers (lines 557-614)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates description text via onChange in edit mode", () => {
    render(
      <IssuePanel
        issue={makeIssue()}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));

    const descTextarea = screen.getByPlaceholderText("Description (plain text)") as HTMLTextAreaElement;
    fireEvent.change(descTextarea, { target: { value: "New description text" } });
    expect(descTextarea.value).toBe("New description text");
  });

  it("updates AC text via onChange in edit mode when acField is provided", () => {
    const issue: JiraIssue = {
      id: "10001",
      key: "PROJ-1",
      fields: {
        summary: "Test",
        status: { name: "To Do", statusCategory: { key: "new" } },
        issuetype: { name: "Story" },
        customfield_10113: makeAdf("paragraph", ["Original AC"]),
      },
    };

    render(
      <IssuePanel
        issue={issue}
        sessionCode="ABC123"
        isFacilitator={true}
        revealed={false}
        voteAverage={null}
        voteMedian={null}
        acField="customfield_10113"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));

    const acTextarea = screen.getByPlaceholderText("Acceptance criteria (plain text)") as HTMLTextAreaElement;
    fireEvent.change(acTextarea, { target: { value: "Updated AC text" } });
    expect(acTextarea.value).toBe("Updated AC text");
  });
});

describe("IssuePanel ADF inline node coverage (lines 172-189)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders inlineCard as a link", () => {
    const issue = makeIssue({
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "inlineCard", attrs: { url: "https://example.com/ticket/1" } },
            ],
          },
        ],
      },
    });
    render(<IssuePanel issue={issue} {...defaultProps} />);
    const link = screen.getByRole("link", { name: "https://example.com/ticket/1" });
    expect(link).toHaveAttribute("href", "https://example.com/ticket/1");
  });

  it("renders inlineCard without url gracefully (no link)", () => {
    const issue = makeIssue({
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "inlineCard", attrs: {} },
            ],
          },
        ],
      },
    });
    // Should not throw
    const { container } = render(<IssuePanel issue={issue} {...defaultProps} />);
    expect(container).toBeInTheDocument();
  });

  it("renders mention node with text", () => {
    const issue = makeIssue({
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { text: "@john.doe" } },
            ],
          },
        ],
      },
    });
    render(<IssuePanel issue={issue} {...defaultProps} />);
    expect(screen.getByText("@john.doe")).toBeInTheDocument();
  });

  it("renders mention node without text using fallback @mention", () => {
    const issue = makeIssue({
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: {} },
            ],
          },
        ],
      },
    });
    render(<IssuePanel issue={issue} {...defaultProps} />);
    expect(screen.getByText("@mention")).toBeInTheDocument();
  });

  it("handles unknown inline node with content by rendering children", () => {
    const issue = makeIssue({
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "unknownInlineWrapper",
                content: [{ type: "text", text: "wrapped text" }],
              },
            ],
          },
        ],
      },
    });
    render(<IssuePanel issue={issue} {...defaultProps} />);
    expect(screen.getByText("wrapped text")).toBeInTheDocument();
  });

  it("renders isImageAttachment as false for attachment with undefined mimeType", () => {
    // Tests the (a.mimeType ?? "") branch when mimeType is missing
    const issue = makeIssue({
      description: null,
      attachment: [{ id: "no-mime", filename: "file.bin", mimeType: undefined as unknown as string, size: 1 }],
    });
    const { container } = render(<IssuePanel issue={issue} {...defaultProps} />);
    // Should not render as an image in gallery (not an image type)
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders a PDF attachment as a file-card link in the gallery, not an <img>", () => {
    const issue = makeIssue({
      description: null,
      attachment: [
        { id: "pdf-1", filename: "spec.pdf", mimeType: "application/pdf", size: 42 },
      ],
    });
    const { container } = render(<IssuePanel issue={issue} {...defaultProps} />);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    const link = screen.getByTitle("spec.pdf");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("/api/jira/attachment/pdf-1")
    );
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
  });
});

describe("IssuePanel — sprint plan action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the action when onAddToPlan is not provided", () => {
    render(<IssuePanel issue={makeIssue()} {...defaultProps} isFacilitator={true} />);
    expect(
      screen.queryByRole("button", { name: "Add to sprint plan" })
    ).not.toBeInTheDocument();
  });

  it("hides the action from non-facilitators", () => {
    render(
      <IssuePanel issue={makeIssue()} {...defaultProps} onAddToPlan={vi.fn()} />
    );
    expect(
      screen.queryByRole("button", { name: "Add to sprint plan" })
    ).not.toBeInTheDocument();
  });

  it("calls onAddToPlan with the issue key", async () => {
    const onAddToPlan = vi.fn().mockResolvedValue(undefined);
    render(
      <IssuePanel
        issue={makeIssue()}
        {...defaultProps}
        isFacilitator={true}
        onAddToPlan={onAddToPlan}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to sprint plan" }));

    await waitFor(() => expect(onAddToPlan).toHaveBeenCalledWith("PROJ-1"));
  });

  it("shows a disabled in-plan state when the ticket is already queued", () => {
    render(
      <IssuePanel
        issue={makeIssue()}
        {...defaultProps}
        isFacilitator={true}
        onAddToPlan={vi.fn()}
        inSprintPlan={true}
      />
    );

    const btn = screen.getByRole("button", { name: "In sprint plan" });
    expect(btn).toBeDisabled();
  });

  it("re-enables the action after a failed add", async () => {
    const onAddToPlan = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <IssuePanel
        issue={makeIssue()}
        {...defaultProps}
        isFacilitator={true}
        onAddToPlan={onAddToPlan}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to sprint plan" }));

    await waitFor(() => expect(onAddToPlan).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add to sprint plan" })).not.toBeDisabled()
    );
  });

  it("allows removing a queued ticket when onRemoveFromPlan is provided", async () => {
    const onAddToPlan = vi.fn();
    const onRemoveFromPlan = vi.fn().mockResolvedValue(undefined);
    render(
      <IssuePanel
        issue={makeIssue()}
        {...defaultProps}
        isFacilitator={true}
        onAddToPlan={onAddToPlan}
        onRemoveFromPlan={onRemoveFromPlan}
        inSprintPlan={true}
      />
    );

    const btn = screen.getByRole("button", { name: "In sprint plan ✕" });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    await waitFor(() => expect(onRemoveFromPlan).toHaveBeenCalledWith("PROJ-1"));
    expect(onAddToPlan).not.toHaveBeenCalled();
  });
});
