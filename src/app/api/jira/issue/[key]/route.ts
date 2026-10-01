import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCredentials, getIssue, updateStoryPoints, updateIssueFields } from "@/lib/jira/client";
import { pointsSubmitSchema, issueUpdateSchema } from "@/lib/validation/schemas";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const creds = await loadCredentials(user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "Jira not connected" },
      { status: 400 }
    );
  }

  const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };

  try {
    const issue = await getIssue(opts, key, creds.storyPointsField);
    return NextResponse.json({
      issue,
      story_points_field: creds.storyPointsField,
      current_points: issue.fields[creds.storyPointsField] as number | null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch issue" },
      { status: 502 }
    );
  }
}

/** Write story points to a Jira issue — facilitator only */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
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

  const parsed = pointsSubmitSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { points, session_code } = parsed.data;

  // Verify user is facilitator of this session
  const { data: session } = await supabase
    .from("sessions")
    .select("id, facilitator_id")
    .eq("code", session_code.toUpperCase())
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can submit points to Jira" },
      { status: 403 }
    );
  }

  const creds = await loadCredentials(user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "Jira not connected" },
      { status: 400 }
    );
  }

  const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };

  try {
    await updateStoryPoints(opts, key, creds.storyPointsField, points);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update Jira" },
      { status: 502 }
    );
  }

  // Broadcast points:submitted to all room participants
  const serviceClient = createServiceClient();
  const channel = serviceClient.channel(`room:${session_code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "points:submitted",
    payload: { issue_key: key, points },
  });
  await serviceClient.removeChannel(channel);

  return NextResponse.json({ ok: true, issue_key: key, points });
}

/** Edit ticket fields (summary, description, AC) — facilitator only */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
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

  const parsed = issueUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { session_code, summary, description, ac } = parsed.data;

  // Verify user is facilitator of this session
  const { data: session } = await supabase
    .from("sessions")
    .select("id, facilitator_id")
    .eq("code", session_code.toUpperCase())
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can edit ticket fields" },
      { status: 403 }
    );
  }

  const creds = await loadCredentials(user.id);
  if (!creds) {
    return NextResponse.json({ error: "Jira not connected" }, { status: 400 });
  }

  const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };

  try {
    await updateIssueFields(opts, key, {
      summary,
      description,
      acField: creds.acField,
      acValue: ac,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update Jira" },
      { status: 502 }
    );
  }

  // Fetch updated issue to broadcast to all participants
  let updatedIssue = null;
  try {
    updatedIssue = await getIssue(opts, key, creds.storyPointsField, creds.acField);
  } catch {
    // Non-fatal — we still succeeded in updating Jira
  }

  // Broadcast issue:updated so all clients see the revision
  const serviceClient = createServiceClient();
  const channel = serviceClient.channel(`room:${session_code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "issue:updated",
    payload: {
      issue_key: key,
      issue: updatedIssue,
    },
  });
  await serviceClient.removeChannel(channel);

  return NextResponse.json({ ok: true, issue_key: key });
}
