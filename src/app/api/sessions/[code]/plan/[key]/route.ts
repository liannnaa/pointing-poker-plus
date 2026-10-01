import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  loadPlanState,
  broadcastPlanUpdate,
  requireFacilitatorSession,
} from "@/lib/session/plan";
import { planAssignSchema } from "@/lib/validation/schemas";

/** Assign (or unassign) a planned ticket to a teammate — facilitator only. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; key: string }> }
) {
  const { code, key } = await params;
  const supabase = await createClient();

  const guard = await requireFacilitatorSession(supabase, code);
  if (guard.response) {
    return NextResponse.json({ error: guard.response.error }, { status: guard.response.status });
  }
  const row = guard.row;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = planAssignSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { assignee_account_id, removed } = parsed.data;
  const serviceClient = createServiceClient();

  // Only someone actually on this session's roster may be assigned — otherwise
  // the client could write an arbitrary accountId that later gets pushed to
  // Jira as an assignee on commit.
  if (assignee_account_id !== undefined && assignee_account_id !== null) {
    const { count } = await serviceClient
      .from("sprint_teammates")
      .select("id", { count: "exact", head: true })
      .eq("session_id", row.id)
      .eq("account_id", assignee_account_id);

    if (!count) {
      return NextResponse.json(
        { error: "Assignee is not on the sprint roster" },
        { status: 400 }
      );
    }
  }

  const patch: { assignee_account_id?: string | null; removed?: boolean } = {};
  if (assignee_account_id !== undefined) patch.assignee_account_id = assignee_account_id;
  // `removed` is schema-constrained to false: this is the undo for a staged
  // removal. Staging itself goes through DELETE.
  if (removed !== undefined) patch.removed = removed;

  const { error: updateError } = await serviceClient
    .from("sprint_plan_items")
    .update(patch)
    .eq("session_id", row.id)
    .eq("issue_key", decodeURIComponent(key));

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const state = await loadPlanState(serviceClient, row);
  await broadcastPlanUpdate(serviceClient, code, state);

  return NextResponse.json(state);
}

/**
 * Remove a ticket from the sprint plan — facilitator only.
 *
 * A host-added ticket is simply deleted. A ticket that is already in the
 * destination sprint is *staged*: the row is flagged `removed` so the host can
 * undo, and so commit knows to push the key back to the Jira backlog.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string; key: string }> }
) {
  const { code, key } = await params;
  const supabase = await createClient();

  const guard = await requireFacilitatorSession(supabase, code);
  if (guard.response) {
    return NextResponse.json({ error: guard.response.error }, { status: guard.response.status });
  }
  const row = guard.row;

  const serviceClient = createServiceClient();
  const issueKey = decodeURIComponent(key);

  const { data: existing } = await serviceClient
    .from("sprint_plan_items")
    .select("id, origin")
    .eq("session_id", row.id)
    .eq("issue_key", issueKey)
    .maybeSingle();

  const target = existing as { id: string; origin: string } | null;

  const writeError =
    target?.origin === "sprint"
      ? (
          await serviceClient
            .from("sprint_plan_items")
            .update({ removed: true })
            .eq("id", target.id)
        ).error
      : (
          await serviceClient
            .from("sprint_plan_items")
            .delete()
            .eq("session_id", row.id)
            .eq("issue_key", issueKey)
        ).error;

  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 500 });
  }

  const state = await loadPlanState(serviceClient, row);
  await broadcastPlanUpdate(serviceClient, code, state);

  return NextResponse.json(state);
}
