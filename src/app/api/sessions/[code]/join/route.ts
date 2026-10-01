import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { joinSessionSchema } from "@/lib/validation/schemas";

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

  const body = await request.json();
  const parsed = joinSessionSchema.safeParse({
    display_name: typeof body.display_name === "string" ? body.display_name.trim() : body.display_name,
    avatar_emoji: body.avatar_emoji ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const displayName = parsed.data.display_name;
  const avatarEmoji = parsed.data.avatar_emoji ?? null;

  // Find the session by code
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id")
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Upsert participant (allows re-joining with updated name)
  const { error: insertError } = await supabase.from("participants").upsert(
    {
      session_id: session.id,
      user_id: user.id,
      display_name: displayName as string,
      avatar_emoji: avatarEmoji,
    },
    { onConflict: "session_id,user_id" }
  );

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
