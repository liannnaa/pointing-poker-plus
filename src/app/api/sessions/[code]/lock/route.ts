import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { computeTally } from "@/lib/session/tally";

/**
 * Freezes further vote changes once the facilitator is satisfied with
 * discussion/consensus, without yet advancing to the next round. This is a
 * separate step from reveal (which starts out live-editable) and from
 * clear/next-round (which resets for a new issue).
 */
export async function POST(
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
    .select("id, facilitator_id, state, current_issue_key")
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can lock votes" },
      { status: 403 }
    );
  }

  if (session.state !== "revealed") {
    return NextResponse.json(
      { error: "Votes must be revealed before they can be locked" },
      { status: 400 }
    );
  }

  const issueKey = session.current_issue_key ?? "round-1";
  const serviceClient = createServiceClient();

  const { data: votes, error: votesError } = await serviceClient
    .from("votes")
    .select("user_id, value")
    .eq("session_id", session.id)
    .eq("issue_key", issueKey)
    .neq("user_id", session.facilitator_id);

  if (votesError) {
    return NextResponse.json({ error: votesError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("sessions")
    .update({ state: "locked" })
    .eq("id", session.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { tally, average, median } = computeTally(votes);

  const channel = serviceClient.channel(`room:${code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "locked",
    payload: { tally, average, median, votes },
  });
  await serviceClient.removeChannel(channel);

  return NextResponse.json({ tally, average, median, votes });
}
