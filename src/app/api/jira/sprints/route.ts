import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCredentials, listBoards, listSprints } from "@/lib/jira/client";

export async function GET(request: NextRequest) {
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
    // If boardId is provided, list sprints for that board
    const boardId = request.nextUrl.searchParams.get("boardId");
    if (boardId) {
      const sprints = await listSprints(opts, parseInt(boardId, 10));
      return NextResponse.json({ sprints });
    }

    // Otherwise list boards first (scoped to project if configured)
    const boards = await listBoards(opts, creds.projectKey);
    return NextResponse.json({ boards });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch from Jira" },
      { status: 502 }
    );
  }
}
