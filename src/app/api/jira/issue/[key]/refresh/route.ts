import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCredentials, getIssue } from "@/lib/jira/client";
import { refreshIssueSchema } from "@/lib/validation/schemas";

/**
 * Re-fetches the latest issue state from Jira and broadcasts it to the room.
 * Used to pick up edits made directly in Jira (outside this app) and after
 * image uploads, since Jira's attachment list isn't returned by the upload
 * call itself.
 */
export async function POST(
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

  const parsed = refreshIssueSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { session_code } = parsed.data;

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
      { error: "Only the facilitator can refresh the ticket" },
      { status: 403 }
    );
  }

  const creds = await loadCredentials(user.id);
  if (!creds) {
    return NextResponse.json({ error: "Jira not connected" }, { status: 400 });
  }

  const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };

  let issue;
  try {
    issue = await getIssue(opts, key, creds.storyPointsField, creds.acField);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch issue" },
      { status: 502 }
    );
  }

  // Broadcast issue:updated so all clients see the latest revision
  const serviceClient = createServiceClient();
  const channel = serviceClient.channel(`room:${session_code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "issue:updated",
    payload: {
      issue_key: key,
      issue,
    },
  });
  await serviceClient.removeChannel(channel);

  return NextResponse.json({ ok: true, issue_key: key, issue });
}
