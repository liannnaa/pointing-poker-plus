import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCredentials, fetchAttachmentContent, getIssue } from "@/lib/jira/client";

/**
 * Content types we are willing to reflect back to the browser (rendered
 * inline instead of forced as a download).
 *
 * Anything else (HTML, SVG, ...) is served as an opaque download so an
 * attacker-supplied Jira attachment cannot execute script on our origin.
 * PDFs are safe to render inline: the response's own restrictive CSP still
 * applies to that document, and a PDF cannot execute script on our origin.
 */
const ALLOWED_INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

/**
 * Streams a Jira attachment's binary content to the browser.
 *
 * Jira attachment URLs require authentication, so images embedded in a ticket
 * description cannot be loaded directly by the browser. This route proxies them
 * using the session facilitator's credentials, so every participant sees the
 * images without needing their own Jira connection.
 *
 * Because it borrows the facilitator's Jira token, access is deliberately
 * narrow. The caller must:
 *   1. be authenticated,
 *   2. have joined the session (be a row in `participants`), and
 *   3. request an attachment belonging to the issue that session is currently
 *      estimating.
 * Without (3) the route would be a confused deputy: any caller could walk
 * sequential Jira attachment ids and read the facilitator's whole instance.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    .select("id, facilitator_id, current_issue_key")
    .eq("code", sessionCode.toUpperCase())
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Only people who actually joined the room may pull Jira content.
  if (user.id !== session.facilitator_id) {
    const serviceClient = createServiceClient();
    const { data: participant } = await serviceClient
      .from("participants")
      .select("user_id")
      .eq("session_id", session.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!participant) {
      return NextResponse.json(
        { error: "You have not joined this session" },
        { status: 403 }
      );
    }
  }

  const issueKey = session.current_issue_key;
  if (!issueKey || issueKey.startsWith("round-")) {
    return NextResponse.json(
      { error: "No Jira issue is currently selected" },
      { status: 404 }
    );
  }

  const creds = await loadCredentials(session.facilitator_id);
  if (!creds) {
    return NextResponse.json({ error: "Jira not connected" }, { status: 400 });
  }

  const opts = { email: creds.email, token: creds.token, baseUrl: creds.baseUrl };

  // Scope the facilitator's credentials to the issue under estimation: the
  // requested attachment must be one of that issue's own attachments.
  let attachment;
  try {
    const issue = await getIssue(opts, issueKey, creds.storyPointsField, creds.acField);
    attachment = (issue.fields.attachment ?? []).find((a) => a.id === id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load issue" },
      { status: 502 }
    );
  }

  if (!attachment) {
    return NextResponse.json(
      { error: "Attachment does not belong to the current issue" },
      { status: 403 }
    );
  }

  try {
    const { body, contentType } = await fetchAttachmentContent(opts, id);

    const declaredType = attachment.mimeType || contentType;
    const isDisplayableInline = ALLOWED_INLINE_TYPES.has(
      declaredType.split(";")[0].trim().toLowerCase()
    );
    const safeFilename = attachment.filename.replace(/[^\w.\- ]/g, "_");

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": isDisplayableInline ? declaredType : "application/octet-stream",
        "Content-Disposition": `${isDisplayableInline ? "inline" : "attachment"}; filename="${safeFilename}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load attachment" },
      { status: 502 }
    );
  }
}
