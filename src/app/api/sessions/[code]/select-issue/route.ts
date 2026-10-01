import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCredentials, getIssue } from "@/lib/jira/client";
import { selectIssueSchema } from "@/lib/validation/schemas";

/** Returns the current issue for late joiners (any session state). */
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

  const issueKey = session.current_issue_key;
  if (!issueKey || issueKey.startsWith("round-")) {
    return NextResponse.json({ issue: null, jira_base_url: null, ac_field: null });
  }

  const creds = await loadCredentials(session.facilitator_id);
  if (!creds) {
    return NextResponse.json({ issue: null, jira_base_url: null, ac_field: null });
  }

  let issue = null;
  try {
    const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };
    issue = await getIssue(opts, issueKey, creds.storyPointsField, creds.acField);
  } catch {
    // Non-fatal
  }

  return NextResponse.json({
    issue,
    jira_base_url: creds.baseUrl,
    ac_field: creds.acField ?? null,
  });
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

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = selectIssueSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { issue_key } = parsed.data;

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
      { error: "Only the facilitator can select issues" },
      { status: 403 }
    );
  }

  const serviceClient = createServiceClient();

  // Clear votes for the outgoing issue so the new round starts clean
  if (session.current_issue_key) {
    await serviceClient
      .from("votes")
      .delete()
      .eq("session_id", session.id)
      .eq("issue_key", session.current_issue_key);
  }

  // Reset session state and update current issue
  const { error: updateError } = await supabase
    .from("sessions")
    .update({ state: "voting", current_issue_key: issue_key })
    .eq("id", session.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Fetch issue detail to broadcast to all participants (including non-facilitators)
  let issueData = null;
  let jiraBaseUrl: string | null = null;
  let acField: string | null = null;
  const creds = await loadCredentials(user.id);
  if (creds) {
    jiraBaseUrl = creds.baseUrl;
    acField = creds.acField ?? null;
    try {
      const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };
      issueData = await getIssue(opts, issue_key, creds.storyPointsField, creds.acField);
    } catch {
      // Non-fatal — participants will still see the issue key
    }
  }

  // Broadcast to all clients
  const channel = serviceClient.channel(`room:${code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "issue-select",
    payload: { issue_key, issue: issueData, jira_base_url: jiraBaseUrl, ac_field: acField },
  });
  await serviceClient.removeChannel(channel);

  return NextResponse.json({ ok: true, issue_key, issue: issueData, jira_base_url: jiraBaseUrl, ac_field: acField });
}
