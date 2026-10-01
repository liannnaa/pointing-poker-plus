import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCredentials, searchUsers } from "@/lib/jira/client";

/**
 * Search Jira users for the sprint-plan teammate roster.
 *
 * Credential-gated: only a user with their own stored Jira credentials (i.e.
 * the host) can call this. Guests never have credentials, so this can't be used
 * to enumerate the host's Jira instance.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (query === "") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const creds = await loadCredentials(user.id);
  if (!creds) {
    return NextResponse.json({ error: "Jira not connected" }, { status: 400 });
  }

  try {
    const users = await searchUsers(
      { email: creds.email, token: creds.token, baseUrl: creds.baseUrl },
      query
    );
    return NextResponse.json({ users });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to search Jira users";
    // Jira returns 403 when the account lacks the "Browse users and groups"
    // global permission — surface that as something the host can act on rather
    // than a raw API error string.
    if (message.includes("403")) {
      return NextResponse.json(
        {
          error:
            "Your Jira account lacks the 'Browse users and groups' permission, so user search is unavailable.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
