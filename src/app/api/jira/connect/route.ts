import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { encrypt } from "@/lib/jira/encryption";
import { validateCredentials, detectAcField } from "@/lib/jira/client";
import { jiraConnectSchema } from "@/lib/validation/schemas";

export async function POST(request: NextRequest) {
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

  const parsed = jiraConnectSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { email, token, base_url, project_key } = parsed.data;

  // Validate credentials against Jira
  try {
    await validateCredentials({ email, token, baseUrl: base_url });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "Failed to authenticate with Jira. Check your email and API token.",
        details: e instanceof Error ? e.message : undefined,
      },
      { status: 401 }
    );
  }

  const storyPointsField = "customfield_10026";

  // Auto-detect AC field (non-fatal if it fails)
  const opts = { email, token, baseUrl: base_url };
  const acField = await detectAcField(opts);

  // Encrypt token and store credentials
  const encryptedToken = encrypt(token);
  const serviceClient = createServiceClient();

  const { error: upsertError } = await serviceClient
    .from("jira_credentials")
    .upsert(
      {
        user_id: user.id,
        email,
        base_url,
        encrypted_token: encryptedToken,
        story_points_field: storyPointsField,
        project_key: project_key ?? null,
        ac_field: acField ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    return NextResponse.json(
      { error: "Failed to store credentials" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      connected: true,
      email,
      base_url,
      story_points_field: storyPointsField,
      project_key: project_key ?? null,
    },
    { status: 200 }
  );
}

/** Check if the current user has stored Jira credentials */
export async function GET(_request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { data } = await serviceClient
    .from("jira_credentials")
    .select("email, base_url, story_points_field, project_key, ac_field")
    .eq("user_id", user.id)
    .single();

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    email: data.email,
    base_url: data.base_url,
    story_points_field: data.story_points_field,
    project_key: data.project_key ?? null,
    ac_field: data.ac_field ?? null,
  });
}

/** Disconnect (delete stored credentials) */
export async function DELETE(_request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  await serviceClient
    .from("jira_credentials")
    .delete()
    .eq("user_id", user.id);

  return NextResponse.json({ connected: false });
}
