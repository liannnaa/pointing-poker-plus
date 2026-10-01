import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCredentials, listSprintIssues } from "@/lib/jira/client";
import { planDestinationSchema } from "@/lib/validation/schemas";
import {
  loadPlanState,
  broadcastPlanUpdate,
  requireFacilitatorSession,
} from "@/lib/session/plan";
import type { JiraIssue } from "@/lib/jira/types";

/**
 * Set the sprint the plan is destined for — facilitator only.
 *
 * Selecting an existing sprint pulls its current issues into the plan as
 * `origin='sprint'` tickets, so the capacity read-out accounts for work that is
 * already committed. Switching destination drops the previous sprint's tickets
 * (including any staged removals, which belonged to that sprint) and leaves
 * every host-added ticket untouched.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const supabase = await createClient();

  const guard = await requireFacilitatorSession(supabase, code);
  if (guard.response) {
    return NextResponse.json({ error: guard.response.error }, { status: guard.response.status });
  }
  const row = guard.row;
  const userId = guard.userId;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = planDestinationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { board_id, sprint_id } = parsed.data;
  const sprint_name = parsed.data.sprint_name ?? null;

  const serviceClient = createServiceClient();

  // Fetch the new sprint's issues *before* touching any state, so a Jira
  // failure leaves the existing destination and plan exactly as they were.
  let sprintIssues: JiraIssue[] = [];
  let storyPointsField = "";

  if (sprint_id !== null && board_id !== null) {
    const creds = await loadCredentials(userId);
    if (!creds) {
      return NextResponse.json({ error: "Jira not connected" }, { status: 400 });
    }
    storyPointsField = creds.storyPointsField;

    try {
      sprintIssues = await listSprintIssues(
        { email: creds.email, token: creds.token, baseUrl: creds.baseUrl },
        board_id,
        sprint_id,
        creds.storyPointsField
      );
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Failed to load sprint issues from Jira" },
        { status: 502 }
      );
    }
  }

  const { error: sessionError } = await serviceClient
    .from("sessions")
    .update({
      target_board_id: board_id,
      target_sprint_id: sprint_id,
      target_sprint_name: sprint_name,
    })
    .eq("id", row.id);

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  // Remember the assignees the host has already set — a ticket that is both
  // host-added and present in the sprint keeps its planned assignee rather than
  // being reset to whatever Jira currently says.
  const { data: existingRows } = await serviceClient
    .from("sprint_plan_items")
    .select("issue_key, assignee_account_id, origin")
    .eq("session_id", row.id);

  const existing = (existingRows ?? []) as {
    issue_key: string;
    assignee_account_id: string | null;
    origin: string;
  }[];
  const plannedAssignee = new Map(
    existing
      .filter((r) => r.assignee_account_id !== null)
      .map((r) => [r.issue_key, r.assignee_account_id as string])
  );

  const { error: clearError } = await serviceClient
    .from("sprint_plan_items")
    .delete()
    .eq("session_id", row.id)
    .eq("origin", "sprint");

  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  if (sprintIssues.length > 0) {
    // Only roster members may be pre-assigned — the commit route pushes these
    // accountIds back to Jira, so they must be values the host chose.
    const { data: roster } = await serviceClient
      .from("sprint_teammates")
      .select("account_id")
      .eq("session_id", row.id);

    const onRoster = new Set(
      ((roster ?? []) as { account_id: string }[]).map((t) => t.account_id)
    );

    const addedKeys = new Set(
      existing.filter((r) => r.origin === "added").map((r) => r.issue_key)
    );

    // Sprint tickets lead the list; host-added work reads as appended to it.
    const rows = sprintIssues.map((issue, index) => {
      const raw = (issue.fields as Record<string, unknown>)[storyPointsField];
      const jiraAssignee = issue.fields.assignee?.accountId ?? null;
      const assignee =
        plannedAssignee.get(issue.key) ??
        (jiraAssignee && onRoster.has(jiraAssignee) ? jiraAssignee : null);

      return {
        session_id: row.id,
        issue_key: issue.key,
        summary: issue.fields.summary,
        points: typeof raw === "number" ? raw : null,
        position: index,
        added_by: userId,
        origin: "sprint",
        removed: false,
        assignee_account_id: assignee,
      };
    });

    // A ticket the host added earlier that turns out to be in the sprint
    // already collapses into the sprint-origin row (unique session_id+key).
    const collapsing = rows.filter((r) => addedKeys.has(r.issue_key)).map((r) => r.issue_key);
    if (collapsing.length > 0) {
      await serviceClient
        .from("sprint_plan_items")
        .delete()
        .eq("session_id", row.id)
        .in("issue_key", collapsing);
    }

    const { error: insertError } = await serviceClient
      .from("sprint_plan_items")
      .insert(rows);

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  const context = {
    ...row,
    target_board_id: board_id,
    target_sprint_id: sprint_id,
    target_sprint_name: sprint_name,
  };

  const state = await loadPlanState(serviceClient, context);
  await broadcastPlanUpdate(serviceClient, code, state);

  return NextResponse.json(state);
}
