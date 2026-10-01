import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { voteSchema } from "@/lib/validation/schemas";
import { computeTally } from "@/lib/session/tally";

/** Returns the list of user_ids who have voted in the current round (facilitator only). */
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
    .select("id, facilitator_id, current_issue_key")
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.facilitator_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const issueKey = session.current_issue_key ?? "round-1";
  const serviceClient = createServiceClient();

  const { data: votes, error: votesError } = await serviceClient
    .from("votes")
    .select("user_id")
    .eq("session_id", session.id)
    .eq("issue_key", issueKey);

  if (votesError) {
    return NextResponse.json({ error: votesError.message }, { status: 500 });
  }

  return NextResponse.json({ voted_user_ids: (votes ?? []).map((v) => v.user_id) });
}

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

  const body = await request.json();
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const { value, issue_key } = parsed.data;

  // Find the session
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, state, facilitator_id")
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Votes may still change after reveal (discussion in progress) — only a
  // facilitator "lock" freezes further changes.
  if (session.state === "locked") {
    return NextResponse.json(
      { error: "Votes are locked" },
      { status: 400 }
    );
  }

  // Upsert vote (unique constraint on session_id, issue_key, user_id)
  const { error: voteError } = await supabase.from("votes").upsert(
    {
      session_id: session.id,
      issue_key,
      user_id: user.id,
      value,
    },
    { onConflict: "session_id,issue_key,user_id" }
  );

  if (voteError) {
    return NextResponse.json({ error: voteError.message }, { status: 500 });
  }

  // If votes are already revealed, this is a live adjustment during
  // discussion — recompute the tally and re-broadcast so every client's
  // chart (and consensus check) updates immediately.
  if (session.state === "revealed") {
    const serviceClient = createServiceClient();

    const { data: votes, error: votesError } = await serviceClient
      .from("votes")
      .select("user_id, value")
      .eq("session_id", session.id)
      .eq("issue_key", issue_key)
      .neq("user_id", session.facilitator_id);

    if (!votesError) {
      const { tally, average, median } = computeTally(votes);
      const channel = serviceClient.channel(`room:${code.toUpperCase()}`);
      await channel.send({
        type: "broadcast",
        event: "reveal",
        payload: { tally, average, median, votes },
      });
      await serviceClient.removeChannel(channel);
    }
  }

  return NextResponse.json({ ok: true });
}
