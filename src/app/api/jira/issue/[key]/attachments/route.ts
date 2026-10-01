import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCredentials, uploadIssueAttachment, getIssue } from "@/lib/jira/client";

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

  const sessionCode = request.nextUrl.searchParams.get("session_code");
  if (!sessionCode) {
    return NextResponse.json(
      { error: "session_code query parameter is required" },
      { status: 400 }
    );
  }

  const { data: session } = await supabase
    .from("sessions")
    .select("id, facilitator_id")
    .eq("code", sessionCode.toUpperCase())
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can upload files to Jira" },
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const rawFile = formData.get("file");
  const isFileLike =
    rawFile !== null &&
    typeof rawFile === "object" &&
    "size" in rawFile &&
    typeof (rawFile as { size?: number }).size === "number" &&
    "type" in rawFile &&
    typeof (rawFile as { type?: string }).type === "string";

  if (!isFileLike || (rawFile as File).size === 0) {
    return NextResponse.json(
      { error: "A valid image or PDF file is required" },
      { status: 400 }
    );
  }

  const uploadFile =
    rawFile instanceof File
      ? rawFile
      : new File([rawFile as Blob], "upload", {
          type: (rawFile as File).type || "application/octet-stream",
        });

  if (!uploadFile.type.startsWith("image/") && uploadFile.type !== "application/pdf") {
    return NextResponse.json(
      { error: "Only image or PDF files can be uploaded to Jira" },
      { status: 400 }
    );
  }

  const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };

  let attachment;
  try {
    attachment = await uploadIssueAttachment(opts, key, uploadFile);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to upload file" },
      { status: 502 }
    );
  }

  // Re-fetch the issue (now including the new attachment) and broadcast it so
  // every participant's view refreshes without a manual reload.
  try {
    const updatedIssue = await getIssue(opts, key, creds.storyPointsField, creds.acField);
    const serviceClient = createServiceClient();
    const channel = serviceClient.channel(`room:${sessionCode.toUpperCase()}`);
    await channel.send({
      type: "broadcast",
      event: "issue:updated",
      payload: { issue_key: key, issue: updatedIssue },
    });
    await serviceClient.removeChannel(channel);
  } catch {
    // Non-fatal — the upload itself succeeded even if the refresh broadcast failed
  }

  return NextResponse.json({ ok: true, attachment });
}
