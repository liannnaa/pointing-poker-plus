/**
 * Round-trip conversion between Atlassian Document Format (ADF) and Markdown.
 *
 * Used in the facilitator ticket-editing flow:
 *   - adfToMarkdown: pre-fills the edit textarea from the live ADF stored in Jira
 *   - markdownToAdf: converts the edited text back to ADF before writing to Jira
 *
 * Supported subset (covers typical Jira story content):
 *   Blocks  — paragraph, heading (h1–h6), bulletList, orderedList, blockquote,
 *             codeBlock, rule, media (images)
 *   Inline  — bold (**), italic (*), inline code (`), link ([text](url)),
 *             strikethrough (~~), underline (<u>), hardBreak, inlineCard, mention
 *
 * Images are round-tripped through a placeholder of the form
 * `![alt](jira-media:<id>#<collection>)` so that editing a description in
 * Markdown does not strip attachments out of the Jira ticket.
 *
 * Nodes not in this list (e.g. table) are silently skipped on the
 * ADF→Markdown path and cannot be produced by the Markdown→ADF parser.
 */

import type { AdfNode } from "./types";

/** URL scheme used to round-trip ADF media nodes through Markdown. */
export const MEDIA_SCHEME = "jira-media:";

const MEDIA_LINE_RE = /^!\[([^\]]*)\]\(jira-media:([^)#\s]+)(?:#([^)\s]*))?\)$/;

// ─────────────────────────────────────────────────────────────────────────────
// ADF → Markdown
// ─────────────────────────────────────────────────────────────────────────────

function inlineNodeToMd(node: AdfNode): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "inlineCard") {
    const url = node.attrs?.url as string | undefined;
    return url ? `[${url}](${url})` : "";
  }
  if (node.type === "mention") {
    return (node.attrs?.text as string | undefined) ?? "@mention";
  }
  if (node.type !== "text") {
    return node.content ? node.content.map(inlineNodeToMd).join("") : "";
  }

  let text = node.text ?? "";
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "strong":
        text = `**${text}**`;
        break;
      case "em":
        text = `*${text}*`;
        break;
      case "code":
        text = `\`${text}\``;
        break;
      case "strike":
        text = `~~${text}~~`;
        break;
      case "underline":
        text = `<u>${text}</u>`;
        break;
      case "link": {
        const href = mark.attrs?.href as string | undefined;
        if (href) text = `[${text}](${href})`;
        break;
      }
    }
  }
  return text;
}

function inlineToMd(nodes: AdfNode[]): string {
  return nodes.map(inlineNodeToMd).join("");
}

function listItemToMd(item: AdfNode, prefix: string, depth: number): string {
  const parts: string[] = [];
  let first = true;
  for (const child of item.content ?? []) {
    if (child.type === "paragraph") {
      if (first) {
        parts.push(prefix + inlineToMd(child.content ?? []));
        first = false;
      } else {
        // continuation paragraph — indent under the bullet
        parts.push("  ".repeat(depth + 1) + inlineToMd(child.content ?? []));
      }
    } else if (child.type === "bulletList" || child.type === "orderedList") {
      parts.push(blockNodeToMd(child, depth + 1));
    }
  }
  return parts.join("\n");
}

function blockNodeToMd(node: AdfNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  switch (node.type) {
    case "paragraph":
      return inlineToMd(node.content ?? []);

    case "heading": {
      const lvl = (node.attrs?.level as number) ?? 3;
      return "#".repeat(lvl) + " " + inlineToMd(node.content ?? []);
    }

    case "bulletList":
      return (node.content ?? [])
        .map((item) => listItemToMd(item, indent + "- ", depth))
        .join("\n");

    case "orderedList": {
      const start = (node.attrs?.order as number) ?? 1;
      return (node.content ?? [])
        .map((item, i) => listItemToMd(item, indent + `${start + i}. `, depth))
        .join("\n");
    }

    case "blockquote": {
      const inner = (node.content ?? [])
        .map((c) => blockNodeToMd(c))
        .join("\n\n");
      return inner
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    }

    case "codeBlock": {
      const lang = (node.attrs?.language as string | undefined) ?? "";
      const text = (node.content ?? []).map((c) => c.text ?? "").join("");
      return "```" + lang + "\n" + text + "\n```";
    }

    case "rule":
      return "---";

    case "mediaSingle":
    case "mediaGroup":
      return (node.content ?? [])
        .map((c) => blockNodeToMd(c))
        .filter(Boolean)
        .join("\n\n");

    case "media": {
      const id = (node.attrs?.id as string | undefined) ?? "";
      if (!id) return "";
      const alt =
        (node.attrs?.alt as string | undefined) ??
        (node.attrs?.__fileName as string | undefined) ??
        "image";
      const collection = (node.attrs?.collection as string | undefined) ?? "";
      return `![${alt}](${MEDIA_SCHEME}${id}${collection ? `#${collection}` : ""})`;
    }

    case "doc":
      return (node.content ?? [])
        .map((c) => blockNodeToMd(c))
        .filter(Boolean)
        .join("\n\n");

    default:
      if (node.content) {
        return node.content.map((c) => blockNodeToMd(c)).join("\n\n");
      }
      return "";
  }
}

export function adfToMarkdown(node: AdfNode | null | undefined): string {
  if (!node) return "";
  return blockNodeToMd(node);
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown → ADF
// ─────────────────────────────────────────────────────────────────────────────

/** Parse inline Markdown within a single text span into ADF inline nodes. */
function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  // Bold before italic to avoid *** ambiguity; code before everything else
  const re =
    /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]+)\)|~~([^~\n]+)~~|<u>([^<\n]+)<\/u>/g;
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) {
      nodes.push({ type: "text", text: text.slice(cursor, m.index) });
    }
    if (m[1] !== undefined) {
      nodes.push({ type: "text", text: m[1], marks: [{ type: "strong" }] });
    } else if (m[2] !== undefined) {
      nodes.push({ type: "text", text: m[2], marks: [{ type: "em" }] });
    } else if (m[3] !== undefined) {
      nodes.push({ type: "text", text: m[3], marks: [{ type: "code" }] });
    } else if (m[4] !== undefined && m[5] !== undefined) {
      nodes.push({
        type: "text",
        text: m[4],
        marks: [{ type: "link", attrs: { href: m[5] } }],
      });
    } else if (m[6] !== undefined) {
      nodes.push({ type: "text", text: m[6], marks: [{ type: "strike" }] });
    } else if (m[7] !== undefined) {
      nodes.push({ type: "text", text: m[7], marks: [{ type: "underline" }] });
    }
    cursor = re.lastIndex;
  }

  if (cursor < text.length) {
    nodes.push({ type: "text", text: text.slice(cursor) });
  }

  return nodes;
}

// ── List parser ────────────────────────────────────────────────────────────

type RawListItem = {
  depth: number;
  bullet: boolean;
  num: number;
  text: string;
};

function parseRawListItem(line: string): RawListItem | null {
  const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
  if (bulletMatch) {
    return {
      depth: Math.floor(bulletMatch[1].length / 2),
      bullet: true,
      num: 1,
      text: bulletMatch[2],
    };
  }
  const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
  if (orderedMatch) {
    return {
      depth: Math.floor(orderedMatch[1].length / 2),
      bullet: false,
      num: parseInt(orderedMatch[2], 10),
      text: orderedMatch[3],
    };
  }
  return null;
}

function buildListNode(items: RawListItem[], start: number): { node: AdfNode; next: number } {
  const depth = items[start].depth;
  const isBullet = items[start].bullet;
  const listItems: AdfNode[] = [];
  let i = start;

  while (i < items.length && items[i].depth === depth) {
    const item = items[i];
    const itemContent: AdfNode[] = [
      { type: "paragraph", content: parseInline(item.text) },
    ];
    i++;

    // Collect deeper-nested children
    while (i < items.length && items[i].depth > depth) {
      const { node: nested, next } = buildListNode(items, i);
      itemContent.push(nested);
      i = next;
    }

    listItems.push({ type: "listItem", content: itemContent });
  }

  const node: AdfNode = {
    type: isBullet ? "bulletList" : "orderedList",
    content: listItems,
    ...((!isBullet && items[start]) ? { attrs: { order: items[start].num } } : {}),
  };

  return { node, next: i };
}

function parseListBlock(listLines: string[]): AdfNode[] {
  const raw: RawListItem[] = listLines
    .map(parseRawListItem)
    .filter((x): x is RawListItem => x !== null);
  if (raw.length === 0) return [];
  const minDepth = Math.min(...raw.map((r) => r.depth));
  const normalised = raw.map((r) => ({ ...r, depth: r.depth - minDepth }));
  const { node } = buildListNode(normalised, 0);
  return [node];
}

// ── Main parser ───────────────────────────────────────────────────────────

export function markdownToAdf(md: string): { type: string; version: number; content: AdfNode[] } {
  const content: AdfNode[] = [];
  const lines = md.split("\n");
  let i = 0;
  let paraLines: string[] = [];

  function flushParagraph() {
    if (paraLines.length === 0) return;
    const text = paraLines.join(" ").trim();
    if (text) {
      content.push({ type: "paragraph", content: parseInline(text) });
    }
    paraLines = [];
  }

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ────────────────────────────────────────────────
    const fenceMatch = line.match(/^(`{3,})([\w-]*)$/);
    if (fenceMatch) {
      flushParagraph();
      const lang = fenceMatch[2];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^`{3,}$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      content.push({
        type: "codeBlock",
        attrs: { language: lang },
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // ── Inline image placeholder (round-tripped media node) ──────────────
    const mediaMatch = line.trim().match(MEDIA_LINE_RE);
    if (mediaMatch) {
      flushParagraph();
      const attrs: Record<string, unknown> = {
        id: mediaMatch[2],
        type: "file",
        alt: mediaMatch[1],
      };
      if (mediaMatch[3]) attrs.collection = mediaMatch[3];
      content.push({
        type: "mediaSingle",
        attrs: { layout: "center" },
        content: [{ type: "media", attrs }],
      });
      i++;
      continue;
    }

    // ── Horizontal rule ──────────────────────────────────────────────────
    if (line.trim().match(/^(-{3,}|\*{3,}|_{3,})$/)) {
      flushParagraph();
      content.push({ type: "rule" });
      i++;
      continue;
    }

    // ── Heading ──────────────────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      flushParagraph();
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // ── List (bullet or ordered) ─────────────────────────────────────────
    if (line.match(/^\s*[-*+]\s+/) || line.match(/^\s*\d+\.\s+/)) {
      flushParagraph();
      const listLines: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.match(/^\s*[-*+]\s+/) || l.match(/^\s*\d+\.\s+/)) {
          listLines.push(l);
          i++;
        } else if (
          l.trim() === "" &&
          i + 1 < lines.length &&
          (lines[i + 1].match(/^\s*[-*+]\s+/) || lines[i + 1].match(/^\s*\d+\.\s+/))
        ) {
          // blank line between list items — skip and continue collecting
          i++;
        } else {
          break;
        }
      }
      content.push(...parseListBlock(listLines));
      continue;
    }

    // ── Blockquote ───────────────────────────────────────────────────────
    if (line.match(/^>\s?/)) {
      flushParagraph();
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].match(/^>\s?/)) {
        bqLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const inner = markdownToAdf(bqLines.join("\n"));
      content.push({ type: "blockquote", content: inner.content });
      continue;
    }

    // ── Blank line ───────────────────────────────────────────────────────
    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }

    // ── Regular paragraph text ───────────────────────────────────────────
    paraLines.push(line);
    i++;
  }

  flushParagraph();

  return {
    type: "doc",
    version: 1,
    content: content.length > 0 ? content : [{ type: "paragraph", content: [] }],
  };
}
