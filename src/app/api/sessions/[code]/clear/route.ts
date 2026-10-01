import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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

  // Find the session and verify facilitator
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, facilitator_id, current_issue_key")
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can clear votes" },
      { status: 403 }
    );
  }

  const issueKey = session.current_issue_key ?? "round-1";
  const serviceClient = createServiceClient();

  // Delete votes for the current issue
  const { error: deleteError } = await serviceClient
    .from("votes")
    .delete()
    .eq("session_id", session.id)
    .eq("issue_key", issueKey);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // Increment the round (for non-Jira sessions)
  let nextIssueKey = issueKey;
  if (issueKey.startsWith("round-")) {
    const num = parseInt(issueKey.split("-")[1], 10);
    nextIssueKey = `round-${num + 1}`;
  }

  // Reset session state to voting
  const { error: updateError } = await supabase
    .from("sessions")
    .update({ state: "voting", current_issue_key: nextIssueKey })
    .eq("id", session.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Broadcast clear event
  const channel = serviceClient.channel(`room:${code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "clear",
    payload: { next_issue_key: nextIssueKey },
  });
  await serviceClient.removeChannel(channel);

  return NextResponse.json({ ok: true, next_issue_key: nextIssueKey });
}
