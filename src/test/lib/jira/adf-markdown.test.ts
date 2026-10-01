import { describe, it, expect } from "vitest";
import { adfToMarkdown, markdownToAdf } from "@/lib/jira/adf-markdown";
import type { AdfNode } from "@/lib/jira/types";

// ─────────────────────────────────────────────────────────────────────────────
// adfToMarkdown
// ─────────────────────────────────────────────────────────────────────────────

describe("adfToMarkdown", () => {
  it("returns empty string for null/undefined", () => {
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown(undefined)).toBe("");
  });

  it("converts a simple paragraph", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };
    expect(adfToMarkdown(adf)).toBe("Hello world");
  });

  it("converts headings", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Sub" }] },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("# Title\n\n### Sub");
  });

  it("converts inline marks", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "strong" }] },
            { type: "text", text: " " },
            { type: "text", text: "italic", marks: [{ type: "em" }] },
            { type: "text", text: " " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
            { type: "text", text: " " },
            { type: "text", text: "strike", marks: [{ type: "strike" }] },
            { type: "text", text: " " },
            { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("**bold** *italic* `code` ~~strike~~ [link](https://example.com)");
  });

  it("converts bullet list", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item A" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item B" }] }] },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("- Item A\n- Item B");
  });

  it("converts ordered list", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { order: 1 },
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }] },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("1. First\n2. Second");
  });

  it("converts code block with language", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("```typescript\nconst x = 1;\n```");
  });

  it("converts blockquote", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("> quoted");
  });

  it("converts horizontal rule", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "above" }] },
        { type: "rule" },
        { type: "paragraph", content: [{ type: "text", text: "below" }] },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("above\n\n---\n\nbelow");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markdownToAdf
// ─────────────────────────────────────────────────────────────────────────────

describe("markdownToAdf", () => {
  it("produces a valid ADF envelope", () => {
    const result = markdownToAdf("hello");
    expect(result.type).toBe("doc");
    expect(result.version).toBe(1);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("converts a paragraph", () => {
    const result = markdownToAdf("Hello world");
    expect(result.content[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "Hello world" }],
    });
  });

  it("converts a heading", () => {
    const result = markdownToAdf("## Section");
    expect(result.content[0]).toMatchObject({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Section" }],
    });
  });

  it("converts bold and italic inline", () => {
    const result = markdownToAdf("**bold** and *italic*");
    const para = result.content[0];
    expect(para.type).toBe("paragraph");
    expect(para.content).toContainEqual({ type: "text", text: "bold", marks: [{ type: "strong" }] });
    expect(para.content).toContainEqual({ type: "text", text: "italic", marks: [{ type: "em" }] });
  });

  it("converts inline code", () => {
    const result = markdownToAdf("`foo`");
    expect(result.content[0].content).toContainEqual({
      type: "text", text: "foo", marks: [{ type: "code" }],
    });
  });

  it("converts a link", () => {
    const result = markdownToAdf("[click here](https://example.com)");
    expect(result.content[0].content).toContainEqual({
      type: "text",
      text: "click here",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    });
  });

  it("converts a bullet list", () => {
    const result = markdownToAdf("- alpha\n- beta");
    expect(result.content[0]).toMatchObject({
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "beta" }] }] },
      ],
    });
  });

  it("converts an ordered list", () => {
    const result = markdownToAdf("1. first\n2. second");
    expect(result.content[0]).toMatchObject({
      type: "orderedList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
      ],
    });
  });

  it("converts a fenced code block", () => {
    const result = markdownToAdf("```js\nconsole.log('hi');\n```");
    expect(result.content[0]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "js" },
      content: [{ type: "text", text: "console.log('hi');" }],
    });
  });

  it("converts a blockquote", () => {
    const result = markdownToAdf("> noted");
    expect(result.content[0]).toMatchObject({
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "noted" }] }],
    });
  });

  it("converts a horizontal rule", () => {
    const result = markdownToAdf("---");
    expect(result.content[0]).toMatchObject({ type: "rule" });
  });

  it("converts strikethrough inline", () => {
    const result = markdownToAdf("~~strike~~");
    expect(result.content[0].content).toContainEqual({
      type: "text",
      text: "strike",
      marks: [{ type: "strike" }],
    });
  });

  it("converts underline inline", () => {
    const result = markdownToAdf("<u>under</u>");
    expect(result.content[0].content).toContainEqual({
      type: "text",
      text: "under",
      marks: [{ type: "underline" }],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: adfToMarkdown → markdownToAdf preserves structure
// ─────────────────────────────────────────────────────────────────────────────

describe("round-trip", () => {
  it("preserves a bullet list", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
          ],
        },
      ],
    };
    const md = adfToMarkdown(adf);
    const result = markdownToAdf(md);
    expect(result.content[0].type).toBe("bulletList");
    expect(result.content[0].content?.length).toBe(2);
  });

  it("preserves a code block", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "python" },
          content: [{ type: "text", text: "print('hello')" }],
        },
      ],
    };
    const md = adfToMarkdown(adf);
    const result = markdownToAdf(md);
    expect(result.content[0].type).toBe("codeBlock");
    expect(result.content[0].attrs?.language).toBe("python");
    expect(result.content[0].content?.[0].text).toBe("print('hello')");
  });

  it("preserves a link", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "docs",
              marks: [{ type: "link", attrs: { href: "https://example.com/docs" } }],
            },
          ],
        },
      ],
    };
    const md = adfToMarkdown(adf);
    const result = markdownToAdf(md);
    const inline = result.content[0].content?.[0];
    expect(inline?.marks?.[0]).toMatchObject({ type: "link", attrs: { href: "https://example.com/docs" } });
  });

  it("round-trips an inline image so editing does not drop attachments", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [
            {
              type: "media",
              attrs: {
                id: "abc-123",
                type: "file",
                collection: "jira-issue-attachments-1",
                alt: "screenshot.png",
              },
            },
          ],
        },
      ],
    };

    const md = adfToMarkdown(adf);
    expect(md).toBe("![screenshot.png](jira-media:abc-123#jira-issue-attachments-1)");

    const result = markdownToAdf(md);
    const media = result.content[0].content?.[0];
    expect(result.content[0].type).toBe("mediaSingle");
    expect(media).toMatchObject({
      type: "media",
      attrs: {
        id: "abc-123",
        type: "file",
        collection: "jira-issue-attachments-1",
        alt: "screenshot.png",
      },
    });
  });

  it("round-trips an image with no collection", () => {
    const md = adfToMarkdown({
      type: "doc",
      content: [
        { type: "mediaGroup", content: [{ type: "media", attrs: { id: "xyz", alt: "a.png" } }] },
      ],
    });
    expect(md).toBe("![a.png](jira-media:xyz)");
    const media = markdownToAdf(md).content[0].content?.[0];
    expect(media?.attrs).toMatchObject({ id: "xyz", alt: "a.png" });
    expect(media?.attrs?.collection).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inlineNodeToMd — uncovered branches
// ─────────────────────────────────────────────────────────────────────────────

describe("adfToMarkdown — underline mark", () => {
  it("converts underline mark to <u> tags", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "underlined", marks: [{ type: "underline" }] },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("<u>underlined</u>");
  });

  it("link mark with no href is a no-op", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain", marks: [{ type: "link", attrs: {} }] },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("plain");
  });
});

describe("inlineNodeToMd edge cases (via adfToMarkdown)", () => {
  it("inlineCard with no URL returns empty string", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "inlineCard", attrs: {} },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("");
  });

  it("mention with no attrs.text falls back to @mention", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: {} },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("@mention");
  });

  it("non-text non-special node with content children recurses into them", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "unknownInlineWrapper",
              content: [
                { type: "text", text: "nested" },
              ],
            },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("nested");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listItemToMd — continuation paragraph and nested lists
// ─────────────────────────────────────────────────────────────────────────────

describe("listItemToMd edge cases (via adfToMarkdown)", () => {
  it("continuation paragraph in a list item is indented", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "First para" }] },
                { type: "paragraph", content: [{ type: "text", text: "Continuation" }] },
              ],
            },
          ],
        },
      ],
    };
    const md = adfToMarkdown(adf);
    expect(md).toContain("- First para");
    expect(md).toContain("Continuation");
    // continuation paragraph must appear on a new line after the bullet text
    expect(md.indexOf("Continuation")).toBeGreaterThan(md.indexOf("First para"));
  });

  it("list item containing a nested bulletList renders the nested list", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Child" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = adfToMarkdown(adf);
    expect(md).toContain("- Parent");
    expect(md).toContain("Child");
  });

  it("list item containing a nested orderedList renders the nested list", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Top" }] },
                {
                  type: "orderedList",
                  attrs: { order: 1 },
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Sub-1" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = adfToMarkdown(adf);
    expect(md).toContain("- Top");
    expect(md).toContain("Sub-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// blockNodeToMd — media / unknown node edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("blockNodeToMd edge cases (via adfToMarkdown)", () => {
  it("media node with no id returns empty string (filtered out)", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [
            { type: "media", attrs: { type: "file", collection: "col" } },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("");
  });

  it("media node falls back to __fileName when alt is absent", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [
            {
              type: "media",
              attrs: {
                id: "file-id-123",
                type: "file",
                collection: "col",
                __fileName: "photo.jpg",
              },
            },
          ],
        },
      ],
    };
    const md = adfToMarkdown(adf);
    expect(md).toBe("![photo.jpg](jira-media:file-id-123#col)");
  });

  it("unknown node type with content recurses into children", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        {
          type: "unknownBlock",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "inner text" }] },
          ],
        },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("inner text");
  });

  it("unknown node type with no content returns empty string", () => {
    const adf: AdfNode = {
      type: "doc",
      content: [
        { type: "totallyUnknown" },
      ],
    };
    expect(adfToMarkdown(adf)).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markdownToAdf — empty string and blank-line-separated list
// ─────────────────────────────────────────────────────────────────────────────

describe("markdownToAdf edge cases", () => {
  it("empty string produces a default paragraph node", () => {
    const result = markdownToAdf("");
    expect(result.type).toBe("doc");
    expect(result.version).toBe(1);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "paragraph", content: [] });
  });

  it("list with a blank line between items is still a single list node", () => {
    const result = markdownToAdf("- alpha\n\n- beta");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("bulletList");
    expect(result.content[0].content).toHaveLength(2);
  });

  it("a nested bullet list in markdown produces nested listItem structure", () => {
    const result = markdownToAdf("- parent\n  - child");
    expect(result.content[0].type).toBe("bulletList");
    // The parent list item should contain a nested list
    const parentItem = result.content[0].content?.[0];
    expect(parentItem?.type).toBe("listItem");
    const nested = parentItem?.content?.find((c: AdfNode) => c.type === "bulletList");
    expect(nested).toBeDefined();
    expect(nested?.content?.[0]?.content?.[0]?.content?.[0]).toMatchObject({
      type: "text",
      text: "child",
    });
  });

  it("list is terminated when followed by a non-blank, non-list line", () => {
    const result = markdownToAdf("- item one\nNot a list line");
    // Should produce both a bulletList and a paragraph
    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(result.content[0].type).toBe("bulletList");
    expect(result.content[1].type).toBe("paragraph");
  });

  it("media node with no collection produces a URL without fragment", () => {
    const md = "![img.png](jira-media:some-id)";
    const result = markdownToAdf(md);
    const media = result.content[0].content?.[0];
    expect(media?.type).toBe("media");
    expect(media?.attrs?.collection).toBeUndefined();
    expect(media?.attrs?.id).toBe("some-id");
  });
});
