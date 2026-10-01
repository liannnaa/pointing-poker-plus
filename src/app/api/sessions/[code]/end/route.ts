import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(
  _request: NextRequest,
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
    // Already deleted — treat as success so sendBeacon retries don't error
    return NextResponse.json({ ok: true });
  }

  if (session.facilitator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the facilitator can end the session" },
      { status: 403 }
    );
  }

  const serviceClient = createServiceClient();

  // Broadcast before deletion so listeners on the channel still receive it
  const channel = serviceClient.channel(`room:${code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "session:ended",
    payload: {},
  });
  await serviceClient.removeChannel(channel);

  // Cascade deletes participants and votes
  const { error: deleteError } = await supabase
    .from("sessions")
    .delete()
    .eq("id", session.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
