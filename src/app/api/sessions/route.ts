import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateSessionCode } from "@/lib/session/codes";

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Generate a unique session code (retry on collision)
  let code: string;
  let attempts = 0;
  while (true) {
    code = generateSessionCode();
    const { error } = await supabase.from("sessions").insert({
      code,
      facilitator_id: user.id,
    });

    if (!error) break;

    // Unique constraint violation — retry with new code
    if (error.code === "23505") {
      attempts++;
      if (attempts >= 5) {
        return NextResponse.json(
          { error: "Failed to generate unique session code" },
          { status: 500 }
        );
      }
      continue;
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ code }, { status: 201 });
}
