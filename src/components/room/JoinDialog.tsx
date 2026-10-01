"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ALLOWED_AVATARS } from "@/lib/validation/schemas";
import { cn } from "@/lib/utils";

type JoinDialogProps = {
  open: boolean;
  onJoin: (displayName: string, avatarEmoji: string | null) => void;
  loading: boolean;
  isHost?: boolean;
};

export function JoinDialog({ open, onJoin, loading, isHost = false }: JoinDialogProps) {
  const [name, setName] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("pp_display_name") ?? "";
    }
    return "";
  });
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("pp_avatar_emoji") || null;
    }
    return null;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    localStorage.setItem("pp_display_name", trimmed);
    if (avatarEmoji) {
      localStorage.setItem("pp_avatar_emoji", avatarEmoji);
    } else {
      localStorage.removeItem("pp_avatar_emoji");
    }
    onJoin(trimmed, avatarEmoji);
  }

  function toggleAvatar(emoji: string) {
    setAvatarEmoji((prev) => (prev === emoji ? null : emoji));
  }

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-xs bg-card border-border" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {isHost ? "Start Session" : "Join Session"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isHost
              ? "Enter your display name to start the estimation session."
              : "Enter your display name to join the estimation session."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            autoFocus
            className="h-8 text-sm"
          />
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Avatar (optional)
            </span>
            <div className="grid grid-cols-6 gap-1.5">
              {ALLOWED_AVATARS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Select avatar ${emoji}`}
                  aria-pressed={avatarEmoji === emoji}
                  onClick={() => toggleAvatar(emoji)}
                  className={cn(
                    "flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-xl transition-colors hover:bg-accent",
                    avatarEmoji === emoji && "bg-primary/20 ring-1 ring-primary"
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <Button
            type="submit"
            className="w-full h-8 text-sm"
            disabled={!name.trim() || loading}
          >
            {loading ? "Joining..." : isHost ? "Start" : "Join"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
