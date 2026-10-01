"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { JiraIssue } from "@/lib/jira/types";
import type { SprintPlanState } from "@/lib/session/plan";

export type Participant = {
  user_id: string;
  display_name: string;
  has_voted: boolean;
  is_facilitator?: boolean;
  avatar_emoji?: string | null;
};

// Presence only carries identity — never updated after the initial join so
// channel.track() is called exactly once per user, eliminating the
// LEAVE+JOIN+SYNC churn that caused participants to flicker out.
type PresencePayload = {
  user_id: string;
  display_name: string;
  is_facilitator: boolean;
  avatar_emoji?: string | null;
};

export type RevealPayload = {
  tally: Record<number, number>;
  average: number;
  median: number;
  votes: { user_id: string; value: number }[];
};

export type PointsSubmittedPayload = {
  issue_key: string;
  points: number;
};

export type IssueSelectPayload = {
  issueKey: string;
  issue: JiraIssue | null;
  jiraBaseUrl: string | null;
  acField: string | null;
};

export type IssueUpdatedPayload = {
  issueKey: string;
  issue: JiraIssue | null;
};

export type SprintPlanPayload = SprintPlanState;

export type PlanCommittedPayload = {
  sprint_id: number;
  sprint_name: string;
  moved: string[];
  failed: string[];
  /** Staged removals successfully pushed back to the backlog. */
  removed?: string[];
  remove_failed?: string[];
  assigned?: string[];
  assign_failed?: string[];
  plan: SprintPlanPayload;
};

export type UseSessionChannelOptions = {
  code: string;
  userId: string;
  displayName: string;
  avatarEmoji?: string | null;
  isFacilitator: boolean;
  facilitatorId: string;
  onReveal: (payload: RevealPayload) => void;
  onClear: (nextIssueKey: string) => void;
  onLocked?: (payload: RevealPayload) => void;
  onIssueSelect?: (payload: IssueSelectPayload) => void;
  onPointsSubmitted?: (payload: PointsSubmittedPayload) => void;
  onIssueUpdated?: (payload: IssueUpdatedPayload) => void;
  onPlanUpdated?: (payload: SprintPlanPayload) => void;
  onPlanCommitted?: (payload: PlanCommittedPayload) => void;
  /** Host opened/closed the sprint plan sheet — mirrors a read-only view to guests. */
  onPlanVisibility?: (open: boolean) => void;
  onHostLeft?: () => void;
  onKicked?: () => void;
  onNudged?: () => void;
};

export function useSessionChannel({
  code,
  userId,
  displayName,
  avatarEmoji,
  isFacilitator,
  facilitatorId,
  onReveal,
  onClear,
  onLocked,
  onIssueSelect,
  onPointsSubmitted,
  onIssueUpdated,
  onPlanUpdated,
  onPlanCommitted,
  onPlanVisibility,
  onHostLeft,
  onKicked,
  onNudged,
}: UseSessionChannelOptions) {
  const [presenceList, setPresenceList] = useState<PresencePayload[]>([]);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());

  const channelRef = useRef<RealtimeChannel | null>(null);
  const onRevealRef = useRef(onReveal);
  const onClearRef = useRef(onClear);
  const onLockedRef = useRef(onLocked);
  const onIssueSelectRef = useRef(onIssueSelect);
  const onPointsSubmittedRef = useRef(onPointsSubmitted);
  const onIssueUpdatedRef = useRef(onIssueUpdated);
  const onPlanUpdatedRef = useRef(onPlanUpdated);
  const onPlanCommittedRef = useRef(onPlanCommitted);
  const onPlanVisibilityRef = useRef(onPlanVisibility);
  const onHostLeftRef = useRef(onHostLeft);
  const onKickedRef = useRef(onKicked);
  const onNudgedRef = useRef(onNudged);
  const hostWasPresent = useRef(false);
  const hostLeftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the "latest callback" refs fresh after every render (not during
  // render itself) so the long-lived channel subscription below always
  // invokes the current callbacks without needing to resubscribe.
  useEffect(() => {
    onRevealRef.current = onReveal;
    onClearRef.current = onClear;
    onLockedRef.current = onLocked;
    onIssueSelectRef.current = onIssueSelect;
    onPointsSubmittedRef.current = onPointsSubmitted;
    onIssueUpdatedRef.current = onIssueUpdated;
    onPlanUpdatedRef.current = onPlanUpdated;
    onPlanCommittedRef.current = onPlanCommitted;
    onPlanVisibilityRef.current = onPlanVisibility;
    onHostLeftRef.current = onHostLeft;
    onKickedRef.current = onKicked;
    onNudgedRef.current = onNudged;
  });

  // Derive the full participant list by merging presence + voted state.
  // This is a pure derivation — no extra state, no extra renders.
  const participants: Participant[] = presenceList.map((p) => ({
    ...p,
    has_voted: votedIds.has(p.user_id),
  }));

  const markVoted = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    // Update own state immediately — the sender doesn't receive its own broadcast.
    setVotedIds((prev) => new Set(prev).add(userId));
    // Broadcast to all other clients in the room.
    channel.send({ type: "broadcast", event: "voted", payload: { user_id: userId } });
  }, [userId]);

  const hydrateVotedIds = useCallback((userIds: string[]) => {
    setVotedIds(new Set(userIds));
  }, []);

  /**
   * Host-only: mirror the sprint plan sheet's open state to every guest so they
   * get a read-only view of the same list. Purely presentational, so a client
   * broadcast is fine here — the plan data itself still only comes from the
   * server-emitted `plan:updated` event.
   */
  const broadcastPlanVisibility = useCallback((open: boolean) => {
    const channel = channelRef.current;
    if (!channel) return;
    channel.send({ type: "broadcast", event: "plan:visibility", payload: { open } });
  }, []);

  // No-op: voted state is reset inside the "clear" / "issue-select" broadcast
  // handlers below. Keeping the function so call sites in RoomClient don't break.
  const resetVote = useCallback(() => {}, []);

  useEffect(() => {
    hostWasPresent.current = false;

    const supabase = createClient();
    const channel = supabase.channel(`room:${code}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresencePayload>();
        const list: PresencePayload[] = [];
        for (const key in state) {
          const presences = state[key];
          if (presences && presences.length > 0) {
            list.push(presences[0]);
          }
        }
        setPresenceList(list);

        // Presence-based host-left detection (fallback for crashes/closed tabs).
        // Use a grace period so a refresh (brief disconnect) doesn't falsely
        // trigger "host left" for participants.
        if (!isFacilitator) {
          const hostPresent = list.some((p) => p.user_id === facilitatorId);
          if (hostWasPresent.current && !hostPresent) {
            // Host disappeared — wait before firing in case it's just a refresh.
            if (!hostLeftTimerRef.current) {
              hostLeftTimerRef.current = setTimeout(() => {
                hostLeftTimerRef.current = null;
                onHostLeftRef.current?.();
              }, 8000);
            }
          } else if (hostPresent && hostLeftTimerRef.current) {
            // Host came back within the grace period — cancel the timer.
            clearTimeout(hostLeftTimerRef.current);
            hostLeftTimerRef.current = null;
          }
          hostWasPresent.current = hostPresent;
        }
      })
      .on("broadcast", { event: "voted" }, ({ payload }) => {
        const { user_id } = payload as { user_id: string };
        setVotedIds((prev) => new Set(prev).add(user_id));
      })
      .on("broadcast", { event: "reveal" }, ({ payload }) => {
        onRevealRef.current(payload as RevealPayload);
      })
      .on("broadcast", { event: "locked" }, ({ payload }) => {
        onLockedRef.current?.(payload as RevealPayload);
      })
      .on("broadcast", { event: "clear" }, ({ payload }) => {
        setVotedIds(new Set());
        onClearRef.current(
          (payload as { next_issue_key: string }).next_issue_key
        );
      })
      .on("broadcast", { event: "issue-select" }, ({ payload }) => {
        setVotedIds(new Set());
        const p = payload as {
          issue_key: string;
          issue: JiraIssue | null;
          jira_base_url: string | null;
          ac_field: string | null;
        };
        onIssueSelectRef.current?.({
          issueKey: p.issue_key,
          issue: p.issue ?? null,
          jiraBaseUrl: p.jira_base_url ?? null,
          acField: p.ac_field ?? null,
        });
      })
      .on("broadcast", { event: "points:submitted" }, ({ payload }) => {
        onPointsSubmittedRef.current?.(payload as PointsSubmittedPayload);
      })
      .on("broadcast", { event: "issue:updated" }, ({ payload }) => {
        const p = payload as { issue_key: string; issue: JiraIssue | null };
        onIssueUpdatedRef.current?.({
          issueKey: p.issue_key,
          issue: p.issue ?? null,
        });
      })
      .on("broadcast", { event: "plan:updated" }, ({ payload }) => {
        onPlanUpdatedRef.current?.(payload as SprintPlanPayload);
      })
      .on("broadcast", { event: "plan:committed" }, ({ payload }) => {
        onPlanCommittedRef.current?.(payload as PlanCommittedPayload);
      })
      .on("broadcast", { event: "plan:visibility" }, ({ payload }) => {
        const { open } = payload as { open: boolean };
        if (!isFacilitator) onPlanVisibilityRef.current?.(open);
      })
      .on("broadcast", { event: "session:ended" }, () => {
        if (!isFacilitator) {
          onHostLeftRef.current?.();
        }
      })
      .on("broadcast", { event: "kick" }, ({ payload }) => {
        const { user_id } = payload as { user_id: string };
        // Remove from presence and voted state on all clients immediately
        setPresenceList((prev) => prev.filter((p) => p.user_id !== user_id));
        setVotedIds((prev) => {
          const next = new Set(prev);
          next.delete(user_id);
          return next;
        });
        if (user_id === userId) {
          onKickedRef.current?.();
        }
      })
      .on("broadcast", { event: "nudge" }, ({ payload }) => {
        const { user_id } = payload as { user_id: string };
        if (user_id === userId) {
          onNudgedRef.current?.();
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          // Called exactly once — presence never needs to be updated again.
          await channel.track({
            user_id: userId,
            display_name: displayName,
            is_facilitator: isFacilitator,
            avatar_emoji: avatarEmoji ?? null,
          });
        }
      });

    channelRef.current = channel;

    return () => {
      if (hostLeftTimerRef.current) {
        clearTimeout(hostLeftTimerRef.current);
        hostLeftTimerRef.current = null;
      }
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [code, userId, displayName, avatarEmoji, isFacilitator]);

  return { participants, markVoted, hydrateVotedIds, resetVote, broadcastPlanVisibility };
}
