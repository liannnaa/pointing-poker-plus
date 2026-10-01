import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCredentials, listBoardQuickFilters } from "@/lib/jira/client";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const boardId = request.nextUrl.searchParams.get("boardId");
  if (!boardId) {
    return NextResponse.json(
      { error: "boardId query parameter is required" },
      { status: 400 }
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
    const quickFilters = await listBoardQuickFilters(opts, parseInt(boardId, 10));
    return NextResponse.json({ quickFilters });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch board configuration" },
      { status: 502 }
    );
  }
}
