import { decrypt } from "./encryption";
import { markdownToAdf } from "./adf-markdown";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  JiraUser,
  JiraSprint,
  JiraSprintsResponse,
  JiraBoardsResponse,
  JiraIssue,
  JiraIssueAssignee,
  JiraSearchResponse,
  JiraBoardConfig,
  JiraQuickFilter,
} from "./types";

type JiraRequestOptions = {
  email: string;
  token: string;
  baseUrl: string;
};

async function jiraFetch<T>(
  opts: JiraRequestOptions,
  path: string,
  init?: RequestInit
): Promise<T> {
  const auth = Buffer.from(`${opts.email}:${opts.token}`).toString("base64");
  const url = `${opts.baseUrl.replace(/\/$/, "")}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text}`);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

/**
 * Loads decrypted credentials for a given user_id from the jira_credentials table.
 * Returns null if no credentials exist.
 */
export async function loadCredentials(userId: string) {
  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("jira_credentials")
    .select("email, base_url, encrypted_token, story_points_field, project_key, ac_field")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;

  return {
    email: data.email,
    baseUrl: data.base_url,
    token: decrypt(data.encrypted_token),
    storyPointsField: data.story_points_field,
    projectKey: data.project_key ?? undefined,
    acField: data.ac_field ?? undefined,
  };
}

/** Validate credentials by calling /rest/api/3/myself */
export async function validateCredentials(
  opts: JiraRequestOptions
): Promise<JiraUser> {
  return jiraFetch<JiraUser>(opts, "/rest/api/3/myself");
}

/**
 * Auto-detect the story points field by inspecting issue create metadata.
 * Falls back to customfield_10016 if detection fails.
 */
export async function detectStoryPointsField(
  opts: JiraRequestOptions
): Promise<string> {
  try {
    const res = await jiraFetch<{ fields: Record<string, { name: string }> }>(
      opts,
      "/rest/api/3/issue/createmeta?expand=projects.issuetypes.fields"
    );
    // Look for a field named "Story Points" or "Story point estimate"
    for (const [key, field] of Object.entries(res.fields ?? {})) {
      if (
        field.name.toLowerCase().includes("story point") ||
        field.name.toLowerCase() === "story points"
      ) {
        return key;
      }
    }
  } catch {
    // Detection failed, use default
  }

  // Try the field endpoint as fallback
  try {
    const fields = await jiraFetch<{ id: string; name: string }[]>(
      opts,
      "/rest/api/3/field"
    );
    for (const field of fields) {
      if (
        field.name.toLowerCase().includes("story point") ||
        field.name.toLowerCase() === "story points"
      ) {
        return field.id;
      }
    }
  } catch {
    // Fall through to default
  }

  return "customfield_10026";
}

/**
 * Auto-detect the Acceptance Criteria custom field by searching for a field
 * whose name contains "acceptance criteria" (case-insensitive).
 * Returns null if not found so callers can decide not to store anything.
 */
export async function detectAcField(
  opts: JiraRequestOptions
): Promise<string | null> {
  try {
    const fields = await jiraFetch<{ id: string; name: string }[]>(
      opts,
      "/rest/api/3/field"
    );
    for (const field of fields) {
      if (field.name.toLowerCase().includes("acceptance criteria")) {
        return field.id;
      }
    }
  } catch {
    // Detection failed
  }
  return null;
}

/** Fetch quick filters configured on a board; returns empty array if none */
export async function listBoardQuickFilters(
  opts: JiraRequestOptions,
  boardId: number
): Promise<JiraQuickFilter[]> {
  const config = await jiraFetch<JiraBoardConfig>(
    opts,
    `/rest/agile/1.0/board/${boardId}/configuration`
  );
  return config.quickFilters ?? [];
}

/** List Scrum boards accessible to the user, optionally scoped to a project */
export async function listBoards(opts: JiraRequestOptions, projectKey?: string) {
  const params = new URLSearchParams({ type: "scrum", maxResults: "50" });
  if (projectKey) params.set("projectKeyOrId", projectKey);
  const res = await jiraFetch<JiraBoardsResponse>(
    opts,
    `/rest/agile/1.0/board?${params}`
  );
  return res.values;
}

/** List active and future sprints for a given board */
export async function listSprints(
  opts: JiraRequestOptions,
  boardId: number
): Promise<JiraSprint[]> {
  const res = await jiraFetch<JiraSprintsResponse>(
    opts,
    `/rest/agile/1.0/board/${boardId}/sprint?state=active,future&maxResults=50`
  );
  return res.values;
}

/** Create a new sprint on a board */
export async function createSprint(
  opts: JiraRequestOptions,
  params: {
    boardId: number;
    name: string;
    startDate?: string;
    endDate?: string;
    goal?: string;
  }
): Promise<JiraSprint> {
  const body: Record<string, unknown> = {
    originBoardId: params.boardId,
    name: params.name,
  };
  if (params.startDate) body.startDate = params.startDate;
  if (params.endDate) body.endDate = params.endDate;
  if (params.goal) body.goal = params.goal;

  return jiraFetch<JiraSprint>(opts, "/rest/agile/1.0/sprint", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Jira accepts at most 50 issues per sprint-move request. */
export const SPRINT_MOVE_BATCH_SIZE = 50;

/**
 * Move issues into a sprint. Jira caps each request at 50 issues, so the list
 * is chunked. Each batch is attempted independently: a failure in one batch
 * does not discard the ones that already succeeded.
 */
export async function moveIssuesToSprint(
  opts: JiraRequestOptions,
  sprintId: number,
  issueKeys: string[]
): Promise<{ moved: string[]; failed: { keys: string[]; error: string }[] }> {
  const moved: string[] = [];
  const failed: { keys: string[]; error: string }[] = [];

  for (let i = 0; i < issueKeys.length; i += SPRINT_MOVE_BATCH_SIZE) {
    const batch = issueKeys.slice(i, i + SPRINT_MOVE_BATCH_SIZE);
    try {
      await jiraFetch<void>(opts, `/rest/agile/1.0/sprint/${sprintId}/issue`, {
        method: "POST",
        body: JSON.stringify({ issues: batch }),
      });
      moved.push(...batch);
    } catch (e) {
      failed.push({
        keys: batch,
        error: e instanceof Error ? e.message : "Failed to move issues",
      });
    }
  }

  return { moved, failed };
}

/**
 * Move issues out of whatever sprint they are in and back onto the backlog.
 * Same batching and partial-failure contract as `moveIssuesToSprint` — a host
 * staging removals must never lose the ones that succeeded because a later
 * batch was rejected.
 */
export async function moveIssuesToBacklog(
  opts: JiraRequestOptions,
  issueKeys: string[]
): Promise<{ removed: string[]; failed: { keys: string[]; error: string }[] }> {
  const removed: string[] = [];
  const failed: { keys: string[]; error: string }[] = [];

  for (let i = 0; i < issueKeys.length; i += SPRINT_MOVE_BATCH_SIZE) {
    const batch = issueKeys.slice(i, i + SPRINT_MOVE_BATCH_SIZE);
    try {
      await jiraFetch<void>(opts, "/rest/agile/1.0/backlog/issue", {
        method: "POST",
        body: JSON.stringify({ issues: batch }),
      });
      removed.push(...batch);
    } catch (e) {
      failed.push({
        keys: batch,
        error: e instanceof Error ? e.message : "Failed to move issues to backlog",
      });
    }
  }

  return { removed, failed };
}

/**
 * Fetch just the summary and current story-point value for an issue.
 * Used by the sprint plan so the tally always reflects Jira, not a stale
 * client-side cache.
 */
export async function getIssuePoints(
  opts: JiraRequestOptions,
  issueKey: string,
  storyPointsField: string
): Promise<{ summary: string; points: number | null; assignee: JiraIssueAssignee | null }> {
  const res = await jiraFetch<JiraIssue>(
    opts,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,assignee,${storyPointsField}`
  );
  const raw = res.fields?.[storyPointsField];
  const assignee = res.fields?.assignee;
  return {
    summary: res.fields?.summary ?? issueKey,
    points: typeof raw === "number" ? raw : null,
    // Only an assignee Jira can actually identify is useful — the roster and
    // every write-back are keyed on accountId.
    assignee: assignee?.accountId ? assignee : null,
  };
}

/**
 * Search assignable Jira users by name or email.
 *
 * Requires the *Browse users and groups* global permission — hosts without it
 * get a 403 from Jira, which the calling route translates into an actionable
 * message. Inactive accounts are filtered out so they can't be added to a
 * sprint roster.
 */
export async function searchUsers(
  opts: JiraRequestOptions,
  query: string
): Promise<JiraUser[]> {
  const res = await jiraFetch<JiraUser[]>(
    opts,
    `/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=20`
  );
  return (res ?? []).filter((u) => u.active !== false);
}

/**
 * Set (or clear, with `null`) the assignee on an issue.
 * Separate from updateIssueFields so a sprint commit can write assignees
 * ticket-by-ticket and tolerate per-ticket permission failures.
 */
export async function updateIssueAssignee(
  opts: JiraRequestOptions,
  issueKey: string,
  accountId: string | null
): Promise<void> {
  await jiraFetch<void>(opts, `/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    body: JSON.stringify({
      fields: { assignee: accountId === null ? null : { accountId } },
    }),
  });
}

/**
 * List a sprint's issues **as that board sees them**.
 *
 * Deliberately the board-scoped endpoint, not `/sprint/{id}/issue`: a sprint
 * can hold issues from several boards/projects, and the unscoped route returns
 * all of them. That leaked tickets from an unrelated board into both the issue
 * list and the sprint plan. `/board/{id}/sprint/{id}/issue` applies the board's
 * own filter, so callers get exactly what the board shows.
 */
export async function listSprintIssues(
  opts: JiraRequestOptions,
  boardId: number,
  sprintId: number,
  storyPointsField: string
): Promise<JiraIssue[]> {
  const fields = `summary,status,issuetype,priority,assignee,${storyPointsField}`;
  const res = await jiraFetch<JiraSearchResponse>(
    opts,
    `/rest/agile/1.0/board/${boardId}/sprint/${sprintId}/issue?maxResults=100&fields=${fields}`
  );
  return res.issues;
}

/** List backlog issues for a board (issues not assigned to any sprint) */
export async function listBacklogIssues(
  opts: JiraRequestOptions,
  boardId: number,
  storyPointsField: string
): Promise<JiraIssue[]> {
  const fields = `summary,status,issuetype,priority,assignee,${storyPointsField}`;
  const res = await jiraFetch<JiraSearchResponse>(
    opts,
    `/rest/agile/1.0/board/${boardId}/backlog?maxResults=100&fields=${fields}`
  );
  return res.issues;
}

/** Get a single issue by key */
export async function getIssue(
  opts: JiraRequestOptions,
  issueKey: string,
  storyPointsField: string,
  acField?: string
): Promise<JiraIssue> {
  const fields = [
    "summary",
    "description",
    "status",
    "issuetype",
    "priority",
    "assignee",
    "attachment",
    storyPointsField,
    ...(acField ? [acField] : []),
  ].join(",");
  return jiraFetch<JiraIssue>(
    opts,
    `/rest/api/3/issue/${issueKey}?fields=${fields}`
  );
}

/** Write story points to an issue */
export async function updateStoryPoints(
  opts: JiraRequestOptions,
  issueKey: string,
  storyPointsField: string,
  points: number
): Promise<void> {
  await jiraFetch<void>(opts, `/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({
      fields: {
        [storyPointsField]: points,
      },
    }),
  });
}

/**
 * Fetch the raw binary content of a Jira attachment.
 * Jira redirects to a pre-signed media URL; fetch follows it automatically.
 */
export async function fetchAttachmentContent(
  opts: JiraRequestOptions,
  attachmentId: string
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const auth = Buffer.from(`${opts.email}:${opts.token}`).toString("base64");
  const res = await fetch(
    `${opts.baseUrl.replace(/\/$/, "")}/rest/api/3/attachment/content/${encodeURIComponent(attachmentId)}`,
    {
      headers: { Authorization: `Basic ${auth}` },
      redirect: "follow",
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jira API ${res.status}: ${text}`);
  }

  return {
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Upload an image attachment to a Jira issue. */
export async function uploadIssueAttachment(
  opts: JiraRequestOptions,
  issueKey: string,
  file: File
): Promise<Record<string, unknown> | null> {
  const auth = Buffer.from(`${opts.email}:${opts.token}`).toString("base64");
  const formData = new FormData();
  formData.append("file", file, file.name);

  const res = await fetch(
    `${opts.baseUrl.replace(/\/$/, "")}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Atlassian-Token": "no-check",
      },
      body: formData,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text}`);
  }

  const data = await res.json().catch(() => null);
  if (Array.isArray(data)) {
    return data[0] ?? null;
  }
  return data ?? null;
}

/**
 * Write summary, description, and/or AC back to a Jira issue.
 * Each field is only included if non-null/non-undefined.
 * Description and AC are sent as plain-text ADF documents.
 */
export async function updateIssueFields(
  opts: JiraRequestOptions,
  issueKey: string,
  fields: {
    summary?: string;
    description?: string;
    acField?: string;
    acValue?: string;
  }
): Promise<void> {
  const body: Record<string, unknown> = {};

  if (fields.summary !== undefined) {
    body.summary = fields.summary;
  }

  if (fields.description !== undefined) {
    body.description = markdownToAdf(fields.description);
  }

  if (fields.acField && fields.acValue !== undefined) {
    body[fields.acField] = markdownToAdf(fields.acValue);
  }

  await jiraFetch<void>(opts, `/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields: body }),
  });
}

