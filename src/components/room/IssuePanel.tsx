"use client";

import { useState, Fragment, useRef, useMemo, createContext, useContext } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { JiraIssue, AdfNode, AdfMark, JiraAttachment } from "@/lib/jira/types";
import { adfToMarkdown } from "@/lib/jira/adf-markdown";
import { cn } from "@/lib/utils";

type IssuePanelProps = {
  issue: JiraIssue;
  sessionCode: string;
  isFacilitator: boolean;
  revealed: boolean;
  voteAverage: number | null;
  voteMedian: number | null;
  jiraBaseUrl?: string | null;
  acField?: string | null;
  /** Adds the active ticket to the sprint plan. Omit to hide the action. */
  onAddToPlan?: (issueKey: string) => void | Promise<void>;
  /** Removes the active ticket from the sprint plan. Omit to disable un-checking. */
  onRemoveFromPlan?: (issueKey: string) => void | Promise<void>;
  /** True when this ticket is already in the sprint plan. */
  inSprintPlan?: boolean;
};

// ---------------------------------------------------------------------------
// Jira attachment / inline media helpers
// ---------------------------------------------------------------------------

export function isImageAttachment(a: JiraAttachment): boolean {
  return (a.mimeType ?? "").startsWith("image/");
}

export function isPdfAttachment(a: JiraAttachment): boolean {
  return (a.mimeType ?? "") === "application/pdf";
}

/** URL of our authenticated proxy for a Jira attachment. */
export function attachmentUrl(attachmentId: string, sessionCode: string): string {
  return `/api/jira/attachment/${encodeURIComponent(attachmentId)}?session_code=${encodeURIComponent(sessionCode)}`;
}

/** Collects ADF media nodes in document order. */
export function collectMediaNodes(node: AdfNode, acc: AdfNode[] = []): AdfNode[] {
  if (node.type === "media") acc.push(node);
  for (const child of node.content ?? []) collectMediaNodes(child, acc);
  return acc;
}

/**
 * Resolves an ADF media node to the issue attachment it refers to.
 *
 * Media nodes reference Jira's media service by UUID, which the REST
 * attachment list does not expose, so we resolve in three passes:
 *   1. filename recorded on the node (alt / __fileName)
 *   2. the node id matching an attachment id directly
 *   3. document order — the nth inline image maps to the nth image attachment
 */
export function resolveMediaAttachment(
  node: AdfNode,
  mediaIndex: number,
  attachments: JiraAttachment[]
): JiraAttachment | null {
  const images = attachments.filter(isImageAttachment);
  if (images.length === 0) return null;

  const fileName =
    (node.attrs?.alt as string | undefined) ??
    (node.attrs?.__fileName as string | undefined);
  if (fileName) {
    const byName = images.find((a) => a.filename === fileName);
    if (byName) return byName;
  }

  const id = node.attrs?.id;
  if (typeof id === "string") {
    const byId = images.find((a) => a.id === id);
    if (byId) return byId;
  }

  return images[mediaIndex] ?? null;
}

type MediaContextValue = {
  sessionCode: string;
  resolve: (node: AdfNode) => JiraAttachment | null;
};

const MediaContext = createContext<MediaContextValue>({
  sessionCode: "",
  resolve: () => null,
});

function AdfMedia({ node }: { node: AdfNode }) {
  const { sessionCode, resolve } = useContext(MediaContext);
  const attachment = resolve(node);

  if (!attachment) return null;

  return (
    <a
      href={attachmentUrl(attachment.id, sessionCode)}
      target="_blank"
      rel="noopener noreferrer"
      title={attachment.filename}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachmentUrl(attachment.id, sessionCode)}
        alt={attachment.filename}
        className="max-w-full h-auto max-h-80 rounded-sm border border-border my-1"
        loading="lazy"
      />
    </a>
  );
}

// ---------------------------------------------------------------------------
// ADF → React renderer
// ---------------------------------------------------------------------------

function applyMarks(text: string, marks: AdfMark[], key: string, jiraBaseUrl?: string | null): React.ReactNode {
  let node: React.ReactNode = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "strong":
        node = <strong key={key}>{node}</strong>;
        break;
      case "em":
        node = <em key={key}>{node}</em>;
        break;
      case "underline":
        node = <u key={key}>{node}</u>;
        break;
      case "strike":
        node = <s key={key}>{node}</s>;
        break;
      case "code":
        node = (
          <code key={key} className="px-1 py-0.5 rounded-sm bg-muted font-mono text-xs">
            {node}
          </code>
        );
        break;
      case "link": {
        const href = mark.attrs?.href as string | undefined;
        if (href) {
          node = (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-blue-700 dark:hover:text-[#85B8FF] hover:underline"
            >
              {node}
            </a>
          );
        }
        break;
      }
    }
  }
  return node;
}

function renderInline(nodes: AdfNode[], keyPrefix: string, jiraBaseUrl?: string | null): React.ReactNode {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === "text") {
      const text = node.text ?? "";
      if (node.marks && node.marks.length > 0) {
        return applyMarks(text, node.marks, key, jiraBaseUrl);
      }
      return <Fragment key={key}>{text}</Fragment>;
    }
    if (node.type === "hardBreak") {
      return <br key={key} />;
    }
    if (node.type === "inlineCard") {
      const url = node.attrs?.url as string | undefined;
      if (url) {
        return (
          <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-blue-700 dark:hover:text-[#85B8FF] hover:underline break-all">
            {url}
          </a>
        );
      }
    }
    if (node.type === "mention") {
      const name = (node.attrs?.text as string | undefined) ?? "@mention";
      return <span key={key} className="text-primary">{name}</span>;
    }
    if (node.content) {
      return <Fragment key={key}>{renderInline(node.content, key, jiraBaseUrl)}</Fragment>;
    }
    return null;
  });
}

function renderBlock(node: AdfNode, keyPrefix: string, listCounters: number[], jiraBaseUrl?: string | null): React.ReactNode {
  const key = keyPrefix;
  const children = node.content ?? [];

  switch (node.type) {
    case "doc":
      return (
        <div key={key} className="space-y-1.5">
          {children.map((child, i) =>
            renderBlock(child, `${key}-${i}`, [], jiraBaseUrl)
          )}
        </div>
      );

    case "paragraph": {
      const inline = renderInline(children, key, jiraBaseUrl);
      return (
        <p key={key} className="text-sm leading-relaxed text-foreground break-words">
          {inline}
        </p>
      );
    }

    case "heading": {
      const level = (node.attrs?.level as number | undefined) ?? 3;
      const inline = renderInline(children, key, jiraBaseUrl);
      const cls = cn(
        "font-semibold",
        level === 1 ? "text-sm text-foreground" :
        level === 2 ? "text-xs text-foreground" :
        "text-xs text-muted-foreground"
      );
      return <p key={key} className={cls}>{inline}</p>;
    }

    case "bulletList":
      return (
        <ul key={key} className="list-disc pl-5 space-y-0.5 text-sm text-foreground">
          {children.map((child, i) =>
            renderBlock(child, `${key}-${i}`, [], jiraBaseUrl)
          )}
        </ul>
      );

    case "orderedList": {
      const start = (node.attrs?.order as number | undefined) ?? 1;
      return (
        <ol key={key} className="list-decimal pl-5 space-y-0.5 text-sm text-foreground" start={start}>
          {children.map((child, i) =>
            renderBlock(child, `${key}-${i}`, [], jiraBaseUrl)
          )}
        </ol>
      );
    }

    case "listItem":
      return (
        <li key={key} className="leading-relaxed">
          {children.map((child, i) =>
            renderBlock(child, `${key}-${i}`, [], jiraBaseUrl)
          )}
        </li>
      );

    case "blockquote":
      return (
        <blockquote key={key} className="border-l-2 border-border pl-3 text-sm text-muted-foreground italic">
          {children.map((child, i) =>
            renderBlock(child, `${key}-${i}`, [], jiraBaseUrl)
          )}
        </blockquote>
      );

    case "codeBlock": {
      const lang = node.attrs?.language as string | undefined;
      const text = children.map((c) => c.text ?? "").join("");
      return (
        <pre key={key} className="rounded-sm bg-muted px-3 py-2 text-xs font-mono overflow-x-auto">
          <code data-lang={lang}>{text}</code>
        </pre>
      );
    }

    case "rule":
      return <hr key={key} className="border-border my-1" />;

    case "mediaGroup":
    case "mediaSingle":
      return (
        <div key={key} className="flex flex-wrap gap-2 my-2">
          {children.map((child, i) =>
            renderBlock(child, `${key}-${i}`, [], jiraBaseUrl)
          )}
        </div>
      );

    case "media":
      return <AdfMedia key={key} node={node} />;

    default:
      if (children.length > 0) {
        return (
          <div key={key}>
            {children.map((child, i) =>
              renderBlock(child, `${key}-${i}`, [], jiraBaseUrl)
            )}
          </div>
        );
      }
      return null;
  }
}

function AdfRenderer({
  node,
  jiraBaseUrl,
  sessionCode = "",
  attachments,
}: {
  node: AdfNode;
  jiraBaseUrl?: string | null;
  sessionCode?: string;
  attachments?: JiraAttachment[];
}) {
  const ctx = useMemo<MediaContextValue>(() => {
    const list = attachments ?? [];
    const order = new Map<AdfNode, number>();
    collectMediaNodes(node).forEach((media, i) => order.set(media, i));
    return {
      sessionCode,
      resolve: (media: AdfNode) =>
        resolveMediaAttachment(media, order.get(media) ?? 0, list),
    };
  }, [node, sessionCode, attachments]);

  return (
    <MediaContext.Provider value={ctx}>
      {renderBlock(node, "root", [], jiraBaseUrl)}
    </MediaContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// IssuePanel component
// ---------------------------------------------------------------------------

// Sentinel used by IssuePanel's render-time "adjust state on prop change"
// derivations below — distinguishes "not yet synced" from any real value
// (including `null`/`false`) so the derivation also applies on first mount.
const UNSET = Symbol("unset");

export function IssuePanel({
  issue,
  sessionCode,
  isFacilitator,
  revealed,
  voteAverage,
  voteMedian,
  jiraBaseUrl,
  acField,
  onAddToPlan,
  onRemoveFromPlan,
  inSprintPlan = false,
}: IssuePanelProps) {
  const [points, setPoints] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [addingToPlan, setAddingToPlan] = useState(false);
  const [removingFromPlan, setRemovingFromPlan] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAc, setEditAc] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The three derivations below run during render (not in effects), per
  // React's "adjusting state when a prop changes" pattern — each tracks the
  // previous value of its trigger and updates state only when it changes.
  // `UNSET` sentinels ensure the initial mount (where the "previous" value
  // would otherwise equal the first prop value) still applies the effect.
  const [prevVoteMedian, setPrevVoteMedian] = useState<number | null | typeof UNSET>(UNSET);
  if (voteMedian !== prevVoteMedian) {
    setPrevVoteMedian(voteMedian);
    if (voteMedian !== null) {
      const DECK = [1, 2, 3, 5];
      const snapped = DECK.find((v) => v >= voteMedian) ?? 5;
      setPoints(String(snapped));
    }
  }

  const [prevIssueKey, setPrevIssueKey] = useState<string | typeof UNSET>(UNSET);
  if (issue.key !== prevIssueKey) {
    setPrevIssueKey(issue.key);
    setSubmitted(false);
    setEditing(false);
  }

  // Reset submitted when going back to voting (same issue re-selected after pointing)
  const [prevRevealed, setPrevRevealed] = useState<boolean | typeof UNSET>(UNSET);
  if (revealed !== prevRevealed) {
    setPrevRevealed(revealed);
    if (!revealed) setSubmitted(false);
  }

  function handleStartEdit() {
    const descNode = issue.fields.description ?? null;
    const acNode = acField && issue.fields[acField] ? (issue.fields[acField] as AdfNode) : null;
    setEditSummary(issue.fields.summary);
    setEditDescription(adfToMarkdown(descNode));
    setEditAc(adfToMarkdown(acNode));
    setEditing(true);
  }

  /**
   * Re-fetches the issue from Jira and broadcasts it to the room — picks up
   * edits made directly in Jira (outside this app) that we'd otherwise never
   * see since we only hold a snapshot from when the issue was selected.
   */
  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/jira/issue/${issue.key}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_code: sessionCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Ticket refreshed from Jira");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh ticket");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveEdit() {
    setSaving(true);
    try {
      const body: Record<string, string> = { session_code: sessionCode };
      if (editSummary !== issue.fields.summary) body.summary = editSummary;

      const origDesc = adfToMarkdown(issue.fields.description ?? null);
      if (editDescription !== origDesc) body.description = editDescription;

      const origAc = adfToMarkdown(
        acField && issue.fields[acField] ? (issue.fields[acField] as AdfNode) : null
      );
      if (editAc !== origAc) body.ac = editAc;

      if (Object.keys(body).length === 1) {
        setEditing(false);
        return;
      }

      const res = await fetch(`/api/jira/issue/${issue.key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Ticket updated in Jira");
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update ticket");
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error("Please choose an image or PDF file");
      event.target.value = "";
      return;
    }

    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(
        `/api/jira/issue/${issue.key}/attachments?session_code=${encodeURIComponent(sessionCode)}`,
        {
          method: "POST",
          body: formData,
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload file");

      toast.success(`${file.name} uploaded to Jira`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload file");
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
  }

  async function handleSubmitPoints() {
    const numPoints = parseFloat(points);
    if (isNaN(numPoints) || numPoints < 0) {
      toast.error("Enter a valid point value");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/jira/issue/${issue.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: numPoints, session_code: sessionCode }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success(`${issue.key} → ${numPoints} points saved to Jira`);
      setSubmitted(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit points");
    } finally {
      setSubmitting(false);
    }
  }

  const description = issue.fields.description ?? null;
  const acNode = acField && issue.fields[acField] ? (issue.fields[acField] as AdfNode) : null;
  const attachments = useMemo(
    () => issue.fields.attachment ?? [],
    [issue.fields.attachment]
  );
  /** Images already shown inline in the description/AC are excluded from the gallery. */
  const galleryAttachments = useMemo(() => {
    const inlineIds = new Set<string>();
    for (const doc of [description, acNode]) {
      if (!doc) continue;
      collectMediaNodes(doc).forEach((media, i) => {
        const match = resolveMediaAttachment(media, i, attachments);
        if (match) inlineIds.add(match.id);
      });
    }
    return attachments.filter((a) => (isImageAttachment(a) || isPdfAttachment(a)) && !inlineIds.has(a.id));
  }, [description, acNode, attachments]);

  const jiraLink = jiraBaseUrl
    ? `${jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.key}`
    : null;

  return (
    <div className="bg-card border border-border rounded-sm p-4 space-y-3">
      {/* Issue header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm shrink-0">
              {issue.key}
            </span>
            <span className="text-xs text-muted-foreground">
              {issue.fields.issuetype.name}
            </span>
            {jiraLink && (
              <a
                href={jiraLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:text-blue-700 dark:hover:text-[#85B8FF] hover:underline"
              >
                Open in Jira ↗
              </a>
            )}
          </div>
          {editing ? (
            <Input
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              className="text-sm font-semibold h-8 mt-1"
              placeholder="Summary"
            />
          ) : (
            <h2 className="text-sm font-semibold text-foreground leading-snug">
              {issue.fields.summary}
            </h2>
          )}
        </div>
        {isFacilitator && (
          <div className="flex items-center gap-2 shrink-0">
            {!editing && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleUploadImage}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 px-2 text-muted-foreground hover:text-foreground"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  {refreshing ? "Refreshing..." : "Refresh"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                >
                  {uploadingImage ? "Uploading..." : "Upload file"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 px-2 text-muted-foreground hover:text-foreground"
                  onClick={handleStartEdit}
                >
                  Edit
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground/60">Status</span>
          <span className="text-foreground">{issue.fields.status.name}</span>
        </span>
        {issue.fields.assignee && (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/60">Assignee</span>
            <span className="text-foreground">{issue.fields.assignee.displayName}</span>
          </span>
        )}
        {issue.fields.priority && (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/60">Priority</span>
            <span className="text-foreground">{issue.fields.priority.name}</span>
          </span>
        )}
      </div>

      {/* Description / AC — edit or read mode */}
      {editing ? (
        <>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Description</p>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
              placeholder="Description (plain text)"
              className="text-sm"
            />
          </div>
          {acField && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Acceptance Criteria</p>
              <Textarea
                value={editAc}
                onChange={(e) => setEditAc(e.target.value)}
                rows={4}
                placeholder="Acceptance criteria (plain text)"
                className="text-sm"
              />
            </div>
          )}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleUploadImage}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage || saving}
              className="h-7 text-xs"
            >
              {uploadingImage ? "Uploading..." : "Upload file"}
            </Button>
            <Button size="sm" onClick={handleSaveEdit} disabled={saving} className="h-7 text-xs">
              {saving ? "Saving..." : "Save to Jira"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          {description && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Description</p>
              <AdfRenderer
                node={description}
                jiraBaseUrl={jiraBaseUrl}
                sessionCode={sessionCode}
                attachments={attachments}
              />
            </div>
          )}

          {acNode && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Acceptance Criteria</p>
              <AdfRenderer
                node={acNode}
                jiraBaseUrl={jiraBaseUrl}
                sessionCode={sessionCode}
                attachments={attachments}
              />
            </div>
          )}

          {galleryAttachments.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Attachments ({galleryAttachments.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {galleryAttachments.map((a) =>
                  isPdfAttachment(a) ? (
                    <a
                      key={a.id}
                      href={attachmentUrl(a.id, sessionCode)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={a.filename}
                      className="flex flex-col items-center justify-center gap-1 h-24 w-24 rounded-sm border border-border hover:border-primary transition-colors p-1.5 text-center"
                    >
                      <span className="text-xs font-semibold text-muted-foreground">PDF</span>
                      <span className="text-[10px] leading-tight text-muted-foreground break-all line-clamp-2">
                        {a.filename}
                      </span>
                    </a>
                  ) : (
                    <a
                      key={a.id}
                      href={attachmentUrl(a.id, sessionCode)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={a.filename}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachmentUrl(a.id, sessionCode)}
                        alt={a.filename}
                        className="h-24 w-24 object-cover rounded-sm border border-border hover:border-primary transition-colors"
                        loading="lazy"
                      />
                    </a>
                  )
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Points submission */}
      {isFacilitator && revealed && !submitted && !editing && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Input
            type="number"
            min="0"
            step="1"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="w-20 h-7 text-sm"
            placeholder="Pts"
          />
          <Button
            size="sm"
            onClick={handleSubmitPoints}
            disabled={submitting || !points}
            className="h-7 text-xs"
          >
            {submitting ? "Saving..." : "Confirm & Submit"}
          </Button>
        </div>
      )}

      {submitted && (
        <p className="text-xs text-emerald-700 dark:text-[#4BCE97] font-medium pt-2 border-t border-border">
          {points} points submitted to Jira
        </p>
      )}

      {isFacilitator && onAddToPlan && !editing && (
        <div className="pt-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={
              (inSprintPlan && !onRemoveFromPlan) ||
              addingToPlan ||
              removingFromPlan
            }
            onClick={async () => {
              if (inSprintPlan) {
                if (!onRemoveFromPlan) return;
                setRemovingFromPlan(true);
                try {
                  await onRemoveFromPlan(issue.key);
                } catch {
                  // The caller is responsible for surfacing the failure.
                } finally {
                  setRemovingFromPlan(false);
                }
                return;
              }
              setAddingToPlan(true);
              try {
                await onAddToPlan(issue.key);
              } catch {
                // The caller is responsible for surfacing the failure.
              } finally {
                setAddingToPlan(false);
              }
            }}
          >
            {inSprintPlan
              ? removingFromPlan
                ? "Removing…"
                : "In sprint plan" + (onRemoveFromPlan ? " ✕" : "")
              : addingToPlan
                ? "Adding…"
                : "Add to sprint plan"}
          </Button>
        </div>
      )}
    </div>
  );
}
