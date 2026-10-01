import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  teammateAddSchema,
  teammateUpdateSchema,
  teammateBulkSchema,
} from "@/lib/validation/schemas";
import {
  loadPlanState,
  broadcastPlanUpdate,
  requireFacilitatorSession,
} from "@/lib/session/plan";

/**
 * Sprint-plan teammate roster — facilitator only.
 *
 * POST   add or replace one teammate
 * PATCH  set one teammate's individual capacity
 * PUT    bulk-merge the host's locally-stored roster (idempotent rehydrate)
 *
 * All three return the full plan state and broadcast it, matching the rest of
 * the plan routes: Supabase does not echo a broadcast back to its sender, so
 * the host applies the HTTP response optimistically.
 */

async function readJson(request: NextRequest) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

export async function POST(
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

  const { body, error: jsonError } = await readJson(request);
  if (jsonError) return jsonError;

  const parsed = teammateAddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const serviceClient = createServiceClient();

  const { count } = await serviceClient
    .from("sprint_teammates")
    .select("id", { count: "exact", head: true })
    .eq("session_id", row.id);

  const { error: upsertError } = await serviceClient.from("sprint_teammates").upsert(
    {
      session_id: row.id,
      account_id: parsed.data.account_id,
      display_name: parsed.data.display_name,
      email: parsed.data.email ?? null,
      avatar_url: parsed.data.avatar_url ?? null,
      capacity_points: parsed.data.capacity_points ?? null,
      position: count ?? 0,
    },
    { onConflict: "session_id,account_id" }
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const state = await loadPlanState(serviceClient, row);
  await broadcastPlanUpdate(serviceClient, code, state);

  return NextResponse.json(state);
}

export async function PATCH(
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

  const { body, error: jsonError } = await readJson(request);
  if (jsonError) return jsonError;

  const parsed = teammateUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const serviceClient = createServiceClient();

  const { error: updateError } = await serviceClient
    .from("sprint_teammates")
    .update({ capacity_points: parsed.data.capacity_points })
    .eq("session_id", row.id)
    .eq("account_id", parsed.data.account_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const state = await loadPlanState(serviceClient, row);
  await broadcastPlanUpdate(serviceClient, code, state);

  return NextResponse.json(state);
}

/**
 * Merge the host's cross-session roster (from localStorage) into this session.
 * Upserts rather than replacing, so an existing roster — and, critically, the
 * assignments pointing at it — survive a rehydrate.
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

  const { body, error: jsonError } = await readJson(request);
  if (jsonError) return jsonError;

  const parsed = teammateBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const serviceClient = createServiceClient();

  if (parsed.data.teammates.length > 0) {
    const { error: upsertError } = await serviceClient.from("sprint_teammates").upsert(
      parsed.data.teammates.map((t, index) => ({
        session_id: row.id,
        account_id: t.account_id,
        display_name: t.display_name,
        email: t.email ?? null,
        avatar_url: t.avatar_url ?? null,
        capacity_points: t.capacity_points ?? null,
        position: index,
      })),
      { onConflict: "session_id,account_id" }
    );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  const state = await loadPlanState(serviceClient, row);
  await broadcastPlanUpdate(serviceClient, code, state);

  return NextResponse.json(state);
}
