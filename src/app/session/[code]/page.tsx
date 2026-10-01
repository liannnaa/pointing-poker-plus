import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoomClient } from "./RoomClient";

type Props = {
  params: Promise<{ code: string }>;
};

export default async function SessionPage({ params }: Props) {
  const { code } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("code", code.toUpperCase())
    .single();

  if (!session) {
    redirect("/");
  }

  return <RoomClient session={session} />;
}
