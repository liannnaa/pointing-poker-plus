import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCredentials, listSprintIssues, listBacklogIssues } from "@/lib/jira/client";

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
  const backlog = request.nextUrl.searchParams.get("backlog");
  const boardId = request.nextUrl.searchParams.get("boardId");
  const sprintId = request.nextUrl.searchParams.get("sprintId");

  try {
    if (backlog === "true") {
      if (!boardId) {
        return NextResponse.json(
          { error: "boardId query parameter is required for backlog" },
          { status: 400 }
        );
      }
      const issues = await listBacklogIssues(opts, parseInt(boardId, 10), creds.storyPointsField);
      return NextResponse.json({ issues });
    }

    if (!sprintId) {
      return NextResponse.json(
        { error: "sprintId or backlog=true query parameter is required" },
        { status: 400 }
      );
    }
    // Board scope is required, not optional: sprint names repeat across boards
    // and an unscoped sprint fetch returns every board's issues.
    if (!boardId) {
      return NextResponse.json(
        { error: "boardId query parameter is required" },
        { status: 400 }
      );
    }
    const issues = await listSprintIssues(
      opts,
      parseInt(boardId, 10),
      parseInt(sprintId, 10),
      creds.storyPointsField
    );
    return NextResponse.json({ issues });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch issues" },
      { status: 502 }
    );
  }
}
