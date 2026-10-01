"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { capacityStatus } from "@/components/room/SprintPlanChip";
import type { SprintTeammate, TeammateTotals } from "@/lib/session/plan";
import type { JiraUser } from "@/lib/jira/types";

export type TeammateRosterProps = {
  teammates: SprintTeammate[];
  /** Per-person workload, keyed by Jira accountId. */
  totals: Record<string, TeammateTotals>;
  readOnly?: boolean;
  onAdd?: (user: JiraUser) => Promise<void> | void;
  onRemove?: (accountId: string) => Promise<void> | void;
  onCapacityChange?: (accountId: string, capacity: number | null) => Promise<void> | void;
};

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The host's roster of people working the next sprint.
 *
 * Read-only mode (guests) renders names and totals only and never touches
 * `/api/jira/users` — guests have no Jira credentials, so searching would just
 * produce errors.
 */
export function TeammateRoster({
  teammates,
  totals,
  readOnly = false,
  onAdd,
  onRemove,
  onCapacityChange,
}: TeammateRosterProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JiraUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [capacityDrafts, setCapacityDrafts] = useState<Record<string, string>>({});
  // Capacity values that have been submitted but whose round-trip hasn't landed
  // yet, so the row can show the new number instead of briefly reverting.
  const [capacityPending, setCapacityPending] = useState<Record<string, number | null>>({});
  // Guards against an earlier, slower search overwriting a later one.
  const requestId = useRef(0);

  useEffect(() => {
    if (readOnly) return;
    const trimmed = query.trim();
    // Clearing is handled by the input's onChange, so the effect only ever
    // needs to handle the "there is something to search for" case.
    if (trimmed === "") return;

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/jira/users?query=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (id === requestId.current) setResults(data.users ?? []);
      } catch (e) {
        if (id === requestId.current) {
          setResults([]);
          toast.error(e instanceof Error ? e.message : "Failed to search Jira users");
        }
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, readOnly]);

  const onRoster = new Set(teammates.map((t) => t.account_id));
  // Stale results from a previous query must never outlive an emptied input.
  const visibleResults = query.trim() === "" ? [] : results;

  async function handleAdd(user: JiraUser) {
    setAdding(user.accountId);
    try {
      await onAdd?.(user);
      setQuery("");
      setResults([]);
    } finally {
      setAdding(null);
    }
  }

  async function handleRemove(accountId: string) {
    setRemoving(accountId);
    try {
      await onRemove?.(accountId);
    } finally {
      setRemoving(null);
    }
  }

  function commitCapacity(accountId: string) {
    const raw = capacityDrafts[accountId];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      toast.error("Capacity must be a non-negative number");
      return;
    }
    // Hold the typed value on screen until the round-trip settles. Clearing the
    // draft up front makes the row fall back to the stale prop for the duration
    // of the request, so the number visibly blanks out and then reappears.
    setCapacityPending((prev) => ({ ...prev, [accountId]: value }));
    void (async () => {
      try {
        await onCapacityChange?.(accountId, value);
      } finally {
        // Drop the draft and the pending value together, by which point the
        // refreshed plan state already carries the new capacity.
        setCapacityDrafts((prev) => {
          const next = { ...prev };
          delete next[accountId];
          return next;
        });
        setCapacityPending((prev) => {
          const next = { ...prev };
          delete next[accountId];
          return next;
        });
      }
    })();
  }

  return (
    <section
      className="mx-3 my-3 rounded-md border-2 border-border overflow-hidden bg-card shadow-sm"
      data-testid="teammate-roster"
    >
      <p className="px-3 py-2 border-b-2 border-border bg-muted/40 text-xs font-semibold tracking-wide">
        Teammates
      </p>

      <div className="px-3 py-3 space-y-2">
      {teammates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {readOnly
            ? "The host hasn't added any teammates yet."
            : "No teammates yet. Search for people in Jira to build the sprint roster."}
        </p>
      ) : (
        <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
          {teammates.map((t) => {
            const total = totals[t.account_id] ?? {
              assigned_points: 0,
              assigned_count: 0,
              unpointed_count: 0,
            };
            // An in-flight capacity edit wins over the prop so the badge and the
            // input agree for the whole round-trip.
            const capacity =
              t.account_id in capacityPending
                ? capacityPending[t.account_id]
                : t.capacity_points;
            const status = capacityStatus(total.assigned_points, capacity);
            const draft = capacityDrafts[t.account_id];

            return (
              <li
                key={t.account_id}
                className="flex items-center gap-2 px-2 py-1.5"
                data-testid={`teammate-${t.account_id}`}
              >
                <span className="text-xs truncate flex-1 min-w-0" title={t.email ?? undefined}>
                  {t.display_name}
                </span>

                <span
                  className={cn(
                    "text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-sm shrink-0",
                    status === "over"
                      ? "bg-red-100 text-red-800 dark:bg-[#3D1F1D] dark:text-[#F87168]"
                      : status === "at"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-[#1C3A2A] dark:text-[#4BCE97]"
                        : "bg-blue-100 text-blue-800 dark:bg-[#1C2B41] dark:text-[#579DFF]"
                  )}
                >
                  {capacity !== null
                    ? `${total.assigned_points}/${capacity} pts`
                    : `${total.assigned_points} pts`}
                </span>

                {!readOnly && (
                  <>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      className="h-6 text-xs w-16 shrink-0"
                      aria-label={`Capacity for ${t.display_name}`}
                      placeholder="cap"
                      value={
                        draft !== undefined
                          ? draft
                          : capacity === null
                            ? ""
                            : String(capacity)
                      }
                      onChange={(e) =>
                        setCapacityDrafts((prev) => ({
                          ...prev,
                          [t.account_id]: e.target.value,
                        }))
                      }
                      onBlur={() => commitCapacity(t.account_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCapacity(t.account_id);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs shrink-0 px-1.5"
                      aria-label={`Remove ${t.display_name} from sprint roster`}
                      onClick={() => handleRemove(t.account_id)}
                      disabled={removing === t.account_id}
                    >
                      ✕
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <div className="space-y-1">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim() === "") setResults([]);
            }}
            placeholder="Search Jira users…"
            aria-label="Search Jira users"
            className="h-7 text-xs"
          />

          {searching && <p className="text-[11px] text-muted-foreground">Searching…</p>}

          {!searching && query.trim() !== "" && visibleResults.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No matching Jira users.</p>
          )}

          {visibleResults.length > 0 && (
            <ul className="border border-border rounded-sm divide-y divide-border">
              {visibleResults.map((u) => (
                <li key={u.accountId}>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                    onClick={() => handleAdd(u)}
                    disabled={onRoster.has(u.accountId) || adding === u.accountId}
                  >
                    <span className="font-medium">{u.displayName}</span>
                    {u.emailAddress && (
                      <span className="text-muted-foreground ml-1.5">{u.emailAddress}</span>
                    )}
                    {onRoster.has(u.accountId) && (
                      <span className="text-muted-foreground ml-1.5">· on roster</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </div>
    </section>
  );
}
