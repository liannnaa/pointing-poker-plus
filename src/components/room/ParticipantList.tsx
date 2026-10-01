"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { Participant } from "@/lib/session/realtime";

type ParticipantListProps = {
  participants: Participant[];
  facilitatorId: string;
  currentUserId?: string;
  onKick?: (userId: string) => void;
  onNudge?: (userId: string) => void;
};

export function ParticipantList({
  participants,
  facilitatorId,
  currentUserId,
  onKick,
  onNudge,
}: ParticipantListProps) {
  const voters = participants.filter((p) => !p.is_facilitator);
  const votedCount = voters.filter((p) => p.has_voted).length;
  const isHost = currentUserId === facilitatorId;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Participants
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {votedCount}/{voters.length}
        </span>
      </div>
      <ul className="space-y-1">
        {participants.map((p) => {
          const isFacilitator = p.user_id === facilitatorId;
          return (
            <li key={p.user_id} className="group flex items-center gap-2 py-1">
              <Avatar className="h-6 w-6 shrink-0 bg-primary/20">
                <AvatarFallback className="text-xs bg-primary/20 text-primary font-medium">
                  {p.avatar_emoji || p.display_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs flex-1 truncate text-foreground">
                {p.display_name}
              </span>
              {isHost && !isFacilitator && (onKick || onNudge) ? (
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  {onNudge && !p.has_voted && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 text-muted-foreground hover:text-amber-500 shrink-0"
                      onClick={() => onNudge(p.user_id)}
                      title={`Nudge ${p.display_name}`}
                    >
                      !
                    </Button>
                  )}
                  {onKick && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onKick(p.user_id)}
                      title={`Kick ${p.display_name}`}
                    >
                      ×
                    </Button>
                  )}
                </span>
              ) : isFacilitator ? (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  host
                </span>
              ) : p.has_voted ? (
                <span className="h-1.5 w-1.5 rounded-full bg-[#4BCE97] shrink-0" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-border shrink-0" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
