import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCredentials, getIssuePoints } from "@/lib/jira/client";
import type { JiraIssueAssignee } from "@/lib/jira/types";
import { planAddSchema, planUpdateSchema } from "@/lib/validation/schemas";
import {
  loadPlanState,
  broadcastPlanUpdate,
  PLAN_SESSION_COLUMNS,
  type PlanSessionRow,
} from "@/lib/session/plan";

type SessionRow = PlanSessionRow;

/** Returns the sprint plan for the session — used to hydrate late joiners. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select(PLAN_SESSION_COLUMNS)
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const row = session as SessionRow;

  try {
    const state = await loadPlanState(supabase, row);
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load sprint plan" },
      { status: 500 }
    );
  }
}

/** Add a ticket to the sprint plan — facilitator only. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = planAddSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { issue_key } = parsed.data;

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select(PLAN_SESSION_COLUMNS)
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const row = session as SessionRow;

  if (row.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can change the sprint plan" },
      { status: 403 }
    );
  }

  const creds = await loadCredentials(user.id);
  if (!creds) {
    return NextResponse.json({ error: "Jira not connected" }, { status: 400 });
  }

  // Always read points straight from Jira — the client-side issue list can be
  // stale for anything pointed earlier in the session. The assignee comes
  // along so a ticket that's already assigned in Jira doesn't land in the plan
  // looking unassigned.
  let summary: string;
  let points: number | null;
  let jiraAssignee: JiraIssueAssignee | null;
  try {
    const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };
    const fetched = await getIssuePoints(opts, issue_key, creds.storyPointsField);
    summary = fetched.summary;
    points = fetched.points;
    jiraAssignee = fetched.assignee;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch issue from Jira" },
      { status: 502 }
    );
  }

  const serviceClient = createServiceClient();

  const { data: existing } = await serviceClient
    .from("sprint_plan_items")
    .select("id, assignee_account_id")
    .eq("session_id", row.id)
    .eq("issue_key", issue_key)
    .maybeSingle();

  const existingRow = existing as { id: string; assignee_account_id: string | null } | null;

  // Only a roster member may be written as the assignee — the commit route
  // pushes this accountId back to Jira, so it has to be someone the host chose.
  const jiraAccountId = jiraAssignee?.accountId ?? null;
  let onRoster = false;
  if (jiraAccountId) {
    const { count } = await serviceClient
      .from("sprint_teammates")
      .select("id", { count: "exact", head: true })
      .eq("session_id", row.id)
      .eq("account_id", jiraAccountId);
    onRoster = (count ?? 0) > 0;
  }

  // Jira's assignee seeds the plan but never overrides a choice the host has
  // already made in this session — the plan is the source of truth once set.
  const seededAssignee = onRoster ? jiraAccountId : null;

  // An add on a ticket already in the plan must not rewrite its origin — a
  // sprint-origin ticket stays sprint-origin — and it un-stages a pending
  // removal, so the inline toggle in the issue list is a true undo.
  const writeError = existingRow
    ? (
        await serviceClient
          .from("sprint_plan_items")
          .update({
            summary,
            points,
            removed: false,
            ...((existingRow.assignee_account_id ?? null) === null && seededAssignee
              ? { assignee_account_id: seededAssignee }
              : {}),
          })
          .eq("id", existingRow.id)
      ).error
    : await (async () => {
        const { count } = await serviceClient
          .from("sprint_plan_items")
          .select("id", { count: "exact", head: true })
          .eq("session_id", row.id);

        const { error } = await serviceClient.from("sprint_plan_items").insert({
          session_id: row.id,
          issue_key,
          summary,
          points,
          position: count ?? 0,
          added_by: user.id,
          origin: "added",
          removed: false,
          assignee_account_id: seededAssignee,
        });
        return error;
      })();

  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 500 });
  }

  const state = await loadPlanState(serviceClient, row);
  await broadcastPlanUpdate(serviceClient, code, state);

  // The ticket is assigned in Jira to someone who isn't on the roster. We
  // can't silently assign them (the roster is the host's deliberate team), so
  // hand the host everything needed to add them in one click.
  const suggested_teammate =
    jiraAccountId && !onRoster
      ? {
          issue_key,
          account_id: jiraAccountId,
          display_name: jiraAssignee?.displayName ?? jiraAccountId,
          email: jiraAssignee?.emailAddress ?? null,
          avatar_url: jiraAssignee?.avatarUrls?.["48x48"] ?? null,
        }
      : null;

  return NextResponse.json({ ...state, suggested_teammate });
}

/** Set the capacity target and/or refresh points from Jira — facilitator only. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = planUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { capacity_points, refresh } = parsed.data;

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select(PLAN_SESSION_COLUMNS)
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const row = session as SessionRow;

  if (row.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can change the sprint plan" },
      { status: 403 }
    );
  }

  const serviceClient = createServiceClient();
  let context = row;

  if (capacity_points !== undefined) {
    const { error: updateError } = await serviceClient
      .from("sessions")
      .update({ capacity_points })
      .eq("id", row.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    context = { ...row, capacity_points: capacity_points ?? null };
  }

  if (refresh) {
    const creds = await loadCredentials(user.id);
    if (!creds) {
      return NextResponse.json({ error: "Jira not connected" }, { status: 400 });
    }

    const current = await loadPlanState(serviceClient, context);
    const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };
    const onRoster = new Set(current.teammates.map((t) => t.account_id));

    for (const item of current.items) {
      try {
        const fetched = await getIssuePoints(opts, item.issue_key, creds.storyPointsField);
        // Same rule as the add path: Jira's assignee only fills a gap, it never
        // overrides an assignment the host made in this session.
        const jiraAccountId = fetched.assignee?.accountId ?? null;
        const seed =
          item.assignee_account_id === null && jiraAccountId && onRoster.has(jiraAccountId)
            ? { assignee_account_id: jiraAccountId }
            : {};

        await serviceClient
          .from("sprint_plan_items")
          .update({ summary: fetched.summary, points: fetched.points, ...seed })
          .eq("session_id", row.id)
          .eq("issue_key", item.issue_key);
      } catch {
        // Non-fatal — keep the stored value for this ticket and carry on.
      }
    }
  }

  const state = await loadPlanState(serviceClient, context);
  await broadcastPlanUpdate(serviceClient, code, state);

  return NextResponse.json(state);
}
