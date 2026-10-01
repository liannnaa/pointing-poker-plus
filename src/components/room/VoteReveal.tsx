"use client";

import type { RevealPayload } from "@/lib/session/realtime";

type VoteRevealProps = {
  reveal: RevealPayload;
  participants: { user_id: string; display_name: string }[];
};

export function VoteReveal({ reveal, participants }: VoteRevealProps) {
  const { tally, average, votes } = reveal;

  const tallyEntries = Object.entries(tally)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => a.value - b.value);

  const maxCount = Math.max(...tallyEntries.map((e) => e.count), 1);
  const nameMap = new Map(participants.map((p) => [p.user_id, p.display_name]));

  return (
    <div className="space-y-5 max-w-lg">
      {/* Average */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-foreground tabular-nums">
          {average.toFixed(1)}
        </span>
        <span className="text-xs text-muted-foreground">average</span>
      </div>

      {/* Bar chart */}
      <div className="space-y-1.5">
        {tallyEntries.map(({ value, count }) => (
          <div key={value} className="flex items-center gap-3">
            <span className="w-5 text-right text-xs font-mono text-muted-foreground shrink-0">
              {value}
            </span>
            <div className="flex-1 h-6 bg-muted rounded-sm overflow-hidden">
              <div
                className="h-full bg-primary/70 rounded-sm flex items-center px-2 transition-all"
                style={{ width: `${(count / maxCount) * 100}%` }}
              >
                <span className="text-xs font-medium text-primary-foreground">
                  {count}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Individual votes */}
      <div className="border-t border-border pt-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Individual Votes
        </p>
        <div className="grid grid-cols-2 gap-1">
          {votes.map((v) => (
            <div
              key={v.user_id}
              className="flex justify-between items-center px-2 py-1.5 rounded-sm bg-muted/50"
            >
              <span className="text-xs truncate text-foreground">
                {nameMap.get(v.user_id) ?? "Unknown"}
              </span>
              <span className="text-xs font-mono font-semibold text-primary ml-2 shrink-0">
                {v.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
