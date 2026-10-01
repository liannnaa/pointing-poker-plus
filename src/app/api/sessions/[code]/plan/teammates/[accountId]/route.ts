import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  loadPlanState,
  broadcastPlanUpdate,
  requireFacilitatorSession,
} from "@/lib/session/plan";

/**
 * Remove a teammate from the sprint plan roster — facilitator only.
 *
 * Their tickets stay in the plan and fall back to unassigned; removing a person
 * must never delete work.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string; accountId: string }> }
) {
  const { code, accountId } = await params;
  const supabase = await createClient();

  const guard = await requireFacilitatorSession(supabase, code);
  if (guard.response) {
    return NextResponse.json({ error: guard.response.error }, { status: guard.response.status });
  }
  const row = guard.row;

  const serviceClient = createServiceClient();
  const decodedId = decodeURIComponent(accountId);

  const { error: deleteError } = await serviceClient
    .from("sprint_teammates")
    .delete()
    .eq("session_id", row.id)
    .eq("account_id", decodedId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { error: unassignError } = await serviceClient
    .from("sprint_plan_items")
    .update({ assignee_account_id: null })
    .eq("session_id", row.id)
    .eq("assignee_account_id", decodedId);

  if (unassignError) {
    return NextResponse.json({ error: unassignError.message }, { status: 500 });
  }

  const state = await loadPlanState(serviceClient, row);
  await broadcastPlanUpdate(serviceClient, code, state);

  return NextResponse.json(state);
}
