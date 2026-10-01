import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCredentials, getIssue } from "@/lib/jira/client";
import { computeTally } from "@/lib/session/tally";

/** Returns current tally + issue for an already-revealed session (for late joiners). */
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
    .select("id, facilitator_id, state, current_issue_key")
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.state !== "revealed" && session.state !== "locked") {
    return NextResponse.json({ error: "Votes not yet revealed" }, { status: 400 });
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

  const { tally, average, median } = computeTally(votes);

  let issue = null;
  let jiraBaseUrl: string | null = null;
  let acField: string | null = null;

  const creds = await loadCredentials(session.facilitator_id);
  if (creds) {
    jiraBaseUrl = creds.baseUrl;
    acField = creds.acField ?? null;
    try {
      const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };
      issue = await getIssue(opts, issueKey, creds.storyPointsField, creds.acField);
    } catch {
      // Non-fatal — late joiners still see tally without issue details
    }
  }

  return NextResponse.json({ tally, average, median, votes, issue, jira_base_url: jiraBaseUrl, ac_field: acField });
}

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
    .select("id, facilitator_id, state, current_issue_key")
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can reveal votes" },
      { status: 403 }
    );
  }

  if (session.state === "revealed") {
    return NextResponse.json(
      { error: "Votes already revealed" },
      { status: 400 }
    );
  }

  const issueKey = session.current_issue_key ?? "round-1";

  // Use service client to read votes (RLS blocks anon pre-reveal)
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

  // Transition session state to revealed
  const { error: updateError } = await supabase
    .from("sessions")
    .update({ state: "revealed" })
    .eq("id", session.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Compute tally
  const { tally, average, median } = computeTally(votes);

  // Broadcast reveal event to all clients in the room
  const channel = serviceClient.channel(`room:${code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "reveal",
    payload: { tally, average, median, votes },
  });
  await serviceClient.removeChannel(channel);

  return NextResponse.json({ tally, average, median, votes });
}
