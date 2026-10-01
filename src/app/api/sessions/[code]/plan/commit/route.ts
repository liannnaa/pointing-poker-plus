import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  loadCredentials,
  createSprint,
  moveIssuesToSprint,
  moveIssuesToBacklog,
  updateIssueAssignee,
} from "@/lib/jira/client";
import { planCommitSchema } from "@/lib/validation/schemas";
import { loadPlanState, PLAN_SESSION_COLUMNS, type PlanSessionRow } from "@/lib/session/plan";

/**
 * Move every ticket in the sprint plan into a sprint — facilitator only.
 * The sprint is either an existing one (`sprint_id`) or created on the fly
 * (`board_id` + `name`).
 */
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

  const parsed = planCommitSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { sprint_id, board_id, name, start_date, end_date, goal } = parsed.data;

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select(PLAN_SESSION_COLUMNS)
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const row = session as PlanSessionRow;

  if (row.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can commit the sprint plan" },
      { status: 403 }
    );
  }

  const creds = await loadCredentials(user.id);
  if (!creds) {
    return NextResponse.json({ error: "Jira not connected" }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const state = await loadPlanState(serviceClient, row);

  // The plan splits three ways: work to move in, work already in the sprint
  // (nothing to move, but assignees may still have changed), and staged
  // removals to push back to the backlog.
  const toMove = state.items.filter((i) => i.origin === "added");
  const alreadyInSprint = state.items.filter((i) => i.origin === "sprint");
  const toBacklog = state.pending_removals;

  if (toMove.length === 0 && toBacklog.length === 0 && alreadyInSprint.length === 0) {
    return NextResponse.json({ error: "Sprint plan is empty" }, { status: 400 });
  }

  const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };

  let targetSprintId: number;
  let targetSprintName: string;
  let createdBoardId: number | null = null;

  try {
    if (sprint_id !== undefined) {
      targetSprintId = sprint_id;
      targetSprintName = name ?? row.target_sprint_name ?? `Sprint ${sprint_id}`;
    } else {
      const created = await createSprint(opts, {
        boardId: board_id as number,
        name: name as string,
        startDate: start_date,
        endDate: end_date,
        goal,
      });
      targetSprintId = created.id;
      targetSprintName = created.name;
      createdBoardId = board_id as number;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create sprint" },
      { status: 502 }
    );
  }

  const { moved, failed } = await moveIssuesToSprint(
    opts,
    targetSprintId,
    toMove.map((i) => i.issue_key)
  );

  // Staged removals are pushed out of the sprint. Treated exactly like a failed
  // move: a rejection keeps the row staged for retry and never fails the commit.
  const { removed, failed: removeFailed } =
    toBacklog.length > 0
      ? await moveIssuesToBacklog(
          opts,
          toBacklog.map((i) => i.issue_key)
        )
      : { removed: [] as string[], failed: [] as { keys: string[]; error: string }[] };

  // Write assignees for everything that is now in the sprint — including
  // tickets that were already there, so a re-assignment made during planning
  // actually reaches Jira. Deliberately non-fatal: the sprint move is the
  // primary outcome and must not be undone because a host lacks the Assign
  // Issues permission, or because a teammate isn't assignable on that project.
  const movedSet = new Set(moved);
  const assigned: string[] = [];
  const assignFailed: string[] = [];

  for (const item of [...toMove, ...alreadyInSprint]) {
    if (!item.assignee_account_id) continue;
    if (item.origin === "added" && !movedSet.has(item.issue_key)) continue;
    try {
      await updateIssueAssignee(opts, item.issue_key, item.assignee_account_id);
      assigned.push(item.issue_key);
    } catch {
      assignFailed.push(item.issue_key);
    }
  }

  // Moved tickets are now part of the sprint, so they stay in the plan and flip
  // to sprint-origin — the panel keeps mirroring the sprint's real contents.
  // Failures stay as they were, ready for a retry.
  if (moved.length > 0) {
    await serviceClient
      .from("sprint_plan_items")
      .update({ origin: "sprint" })
      .eq("session_id", row.id)
      .in("issue_key", moved);
  }

  if (removed.length > 0) {
    await serviceClient
      .from("sprint_plan_items")
      .delete()
      .eq("session_id", row.id)
      .in("issue_key", removed);
  }

  // A sprint created on the fly becomes the plan's destination, so the panel
  // stays a live view of it rather than pointing at the old target.
  const context = {
    ...row,
    target_sprint_id: targetSprintId,
    target_sprint_name: targetSprintName,
    target_board_id: createdBoardId ?? row.target_board_id,
  };

  await serviceClient
    .from("sessions")
    .update({
      target_sprint_id: context.target_sprint_id,
      target_sprint_name: context.target_sprint_name,
      target_board_id: context.target_board_id,
    })
    .eq("id", row.id);

  const failedKeys = failed.flatMap((f) => f.keys);
  const removeFailedKeys = removeFailed.flatMap((f) => f.keys);
  const remaining = await loadPlanState(serviceClient, context);

  const payload = {
    sprint_id: targetSprintId,
    sprint_name: targetSprintName,
    moved,
    failed: failedKeys,
    removed,
    remove_failed: removeFailedKeys,
    assigned,
    assign_failed: assignFailed,
    plan: remaining,
  };

  const channel = serviceClient.channel(`room:${code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "plan:committed",
    payload,
  });
  await serviceClient.removeChannel(channel);

  return NextResponse.json({
    ...payload,
    errors: [...failed, ...removeFailed].map((f) => f.error),
  });
}
