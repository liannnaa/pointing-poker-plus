import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, facilitator_id")
    .eq("code", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can kick participants" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { user_id } = body as { user_id: string };

  if (!user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  if (user_id === session.facilitator_id) {
    return NextResponse.json(
      { error: "Cannot kick the facilitator" },
      { status: 400 }
    );
  }

  const serviceClient = createServiceClient();

  // Broadcast the kick event before removing from DB so the user's client
  // receives it while still subscribed to the channel.
  const channel = serviceClient.channel(`room:${code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "kick",
    payload: { user_id },
  });
  await serviceClient.removeChannel(channel);

  // Remove participant and their votes from the session
  await serviceClient
    .from("votes")
    .delete()
    .eq("session_id", session.id)
    .eq("user_id", user_id);

  await serviceClient
    .from("participants")
    .delete()
    .eq("session_id", session.id)
    .eq("user_id", user_id);

  return NextResponse.json({ ok: true });
}
