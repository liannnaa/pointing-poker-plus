"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  async function ensureAuth() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return user;

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error("Failed to authenticate");
    return data.user;
  }

  async function handleNewSession() {
    setCreating(true);
    setError("");
    try {
      await ensureAuth();
      const res = await fetch("/api/sessions", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/session/${data.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setCreating(false);
    }
  }

  async function handleJoinSession(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError("Session code must be 6 characters");
      return;
    }
    setJoining(true);
    setError("");
    try {
      await ensureAuth();
      const res = await fetch(`/api/sessions/${code}`);
      if (!res.ok) {
        throw new Error("Session not found");
      }
      router.push(`/session/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setJoining(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm space-y-4">
        {/* Logo / wordmark */}
        <div className="relative text-center space-y-1 pb-2">
          <div className="absolute right-0 top-0">
            <ThemeToggle />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            Pointing Poker Plus
          </h1>
          <p className="text-sm text-muted-foreground">
            Real-time sprint estimation with Jira integration
          </p>
        </div>

        {error && (
          <div className="rounded-sm bg-[#3D1F1D] border border-[#F87168]/30 px-3 py-2 text-sm text-[#F87168]">
            {error}
          </div>
        )}

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">New Session</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Create a session and invite your team
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full h-8 text-sm font-medium"
              onClick={handleNewSession}
              disabled={creating}
            >
              {creating ? "Creating..." : "Create Session"}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Join Session</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Enter a 6-character session code
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleJoinSession} className="flex gap-2">
              <Input
                placeholder="ABC123"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                className="font-mono text-center tracking-widest text-sm h-8"
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={joining}
                className="h-8 shrink-0 border border-border"
              >
                {joining ? "Joining..." : "Join"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
