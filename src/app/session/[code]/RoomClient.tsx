"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  useSessionChannel,
  type RevealPayload,
  type PointsSubmittedPayload,
  type IssueSelectPayload,
  type IssueUpdatedPayload,
  type SprintPlanPayload,
  type PlanCommittedPayload,
} from "@/lib/session/realtime";
import { JoinDialog } from "@/components/room/JoinDialog";
import { CardDeck } from "@/components/room/CardDeck";
import { ParticipantList } from "@/components/room/ParticipantList";
import { VoteReveal } from "@/components/room/VoteReveal";
import { FacilitatorControls } from "@/components/room/FacilitatorControls";
import { ShareLink } from "@/components/room/ShareLink";
import { JiraConnectDialog } from "@/components/room/JiraConnectDialog";
import { IssueList } from "@/components/room/IssueList";
import { IssuePanel } from "@/components/room/IssuePanel";
import { SprintPlanChip } from "@/components/room/SprintPlanChip";
import { SprintPlanSheet } from "@/components/room/SprintPlanSheet";
import { loadStoredTeammates, saveStoredTeammates } from "@/lib/session/teammate-storage";
import type { SuggestedTeammate } from "@/lib/session/plan";
import { ConsensusModal } from "@/components/room/ConsensusModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListIcon } from "lucide-react";
import type { Tables } from "@/lib/supabase/types";
import type { JiraIssue } from "@/lib/jira/types";

type Session = Tables<"sessions">;

type RoomClientProps = {
  session: Session;
};

const EMPTY_PLAN: SprintPlanPayload = {
  items: [],
  teammates: [],
  capacity_points: null,
  total_points: 0,
  unpointed_count: 0,
  destination: { board_id: null, sprint_id: null, sprint_name: null },
  pending_removals: [],
};

export function RoomClient({ session }: RoomClientProps) {
  const { user, loading: authLoading } = useAuth();

  const [joined, setJoined] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);

  const [roomState, setRoomState] = useState<"voting" | "revealed" | "locked">(
    session.state as "voting" | "revealed" | "locked"
  );
  const [issueKey, setIssueKey] = useState(
    session.current_issue_key ?? "round-1"
  );
  const [selectedVote, setSelectedVote] = useState<number | null>(null);
  const [revealData, setRevealData] = useState<RevealPayload | null>(null);

  // Tracks the last `revealData` we synced `selectedVote` from, so the
  // derivation below (adjust-state-during-render) runs only when a new
  // reveal payload actually arrives, not on every render.
  const [syncedRevealData, setSyncedRevealData] =
    useState<RevealPayload | null>(null);

  // Keep the CardDeck's highlighted selection in sync with the participant's
  // own vote whenever the (live-updating) reveal payload changes — covers
  // late-join hydration and vote adjustments made from another tab/device.
  // Adjusted during render (not in an effect) per React's "adjusting state
  // when props change" pattern, avoiding an extra render pass.
  if (revealData !== syncedRevealData) {
    setSyncedRevealData(revealData);
    if (revealData && user?.id) {
      const own = revealData.votes.find((v) => v.user_id === user.id);
      if (own) setSelectedVote(own.value);
    }
  }

  const [actionLoading, setActionLoading] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [showConsensusModal, setShowConsensusModal] = useState(false);

  // Jira state
  const [jiraConnected, setJiraConnected] = useState(false);
  const [jiraEmail, setJiraEmail] = useState<string | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [acField, setAcField] = useState<string | null>(null);
  const [storyPointsField, setStoryPointsField] = useState<string>("customfield_10026");
  const [currentIssue, setCurrentIssue] = useState<JiraIssue | null>(null);
  const [pointedIssues, setPointedIssues] = useState<{ key: string; points: number }[]>([]);

  // Sprint plan state — broadcast to every participant.
  const [plan, setPlan] = useState<SprintPlanPayload>(EMPTY_PLAN);
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  // Guests mirror the host's sheet exactly: view-only, opens and closes with
  // the host's — they can't dismiss it themselves.
  const [hostPlanOpen, setHostPlanOpen] = useState(false);
  const planKeys = new Set(plan.items.map((i) => i.issue_key));
  const planRef = useRef<SprintPlanPayload>(EMPTY_PLAN);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const router = useRouter();
  const isFacilitator = user?.id === session.facilitator_id;

  // Shared hydration: restores tally/issue after any join (participant or facilitator refresh).
  const hydrateRoomState = useCallback(async (currentRoomState: "voting" | "revealed" | "locked") => {
    if (currentRoomState === "revealed" || currentRoomState === "locked") {
      try {
        const res = await fetch(`/api/sessions/${session.code}/reveal`);
        if (res.ok) {
          const data = await res.json();
          setRevealData({ tally: data.tally, average: data.average, median: data.median, votes: data.votes });
          if (data.issue) setCurrentIssue(data.issue);
          if (data.jira_base_url) setJiraBaseUrl(data.jira_base_url);
          if (data.ac_field) setAcField(data.ac_field);
        }
      } catch {
        // Non-fatal
      }
    } else {
      try {
        const res = await fetch(`/api/sessions/${session.code}/select-issue`);
        if (res.ok) {
          const data = await res.json();
          if (data.issue) setCurrentIssue(data.issue);
          if (data.jira_base_url) setJiraBaseUrl(data.jira_base_url);
          if (data.ac_field) setAcField(data.ac_field);
        }
      } catch {
        // Non-fatal
      }
    }

    // Sprint plan is visible to everyone, regardless of room state.
    try {
      const planRes = await fetch(`/api/sessions/${session.code}/plan`);
      if (planRes.ok) {
        const data = (await planRes.json()) as SprintPlanPayload;
        if (Array.isArray(data?.items)) setPlan(data);

        // Seed a fresh room from the host's cross-session roster. Only when the
        // session roster is empty, so a rehydrate can never clobber a roster
        // (and its assignments) already built in this room.
        if (isFacilitator && (data?.teammates?.length ?? 0) === 0) {
          const stored = loadStoredTeammates();
          if (stored.length > 0) {
            const putRes = await fetch(`/api/sessions/${session.code}/plan/teammates`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ teammates: stored }),
            });
            if (putRes.ok) setPlan((await putRes.json()) as SprintPlanPayload);
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }, [session.code, isFacilitator]);

  // The facilitator picks a display name via the same JoinDialog guests use
  // (see the `!joined` render branch below and `handleJoin`).

  const handleRevealEvent = useCallback((payload: RevealPayload) => {
    setRevealData(payload);
    setRoomState("revealed");
    const uniqueValues = Object.keys(payload.tally).length;
    if (uniqueValues === 1) {
      setShowConsensusModal(true);
    }
  }, []);

  const handleLockedEvent = useCallback((payload: RevealPayload) => {
    setRevealData(payload);
    setRoomState("locked");
  }, []);

  const handleClearEvent = useCallback((nextIssueKey: string) => {
    setRevealData(null);
    setRoomState("voting");
    setIssueKey(nextIssueKey);
    setSelectedVote(null);
    setCurrentIssue(null);
    setShowConsensusModal(false);
  }, []);

  const handleIssueSelectEvent = useCallback((payload: IssueSelectPayload) => {
    setIssueKey(payload.issueKey);
    setSelectedVote(null);
    setRevealData(null);
    setRoomState("voting");
    setCurrentIssue(payload.issue);
    if (payload.jiraBaseUrl) setJiraBaseUrl(payload.jiraBaseUrl);
    if (payload.acField) setAcField(payload.acField);
  }, []);

  const handlePointsSubmitted = useCallback(
    (payload: PointsSubmittedPayload) => {
      toast.success(`${payload.issue_key} → ${payload.points} points saved to Jira`);
      setPointedIssues((prev) => {
        const without = prev.filter((p) => p.key !== payload.issue_key);
        return [...without, { key: payload.issue_key, points: payload.points }];
      });

      // A ticket already in the plan just got (re)pointed — pull fresh totals
      // so the tally doesn't drift. Only the host may mutate the plan.
      const inPlan = planRef.current.items.some((i) => i.issue_key === payload.issue_key);
      if (inPlan && user?.id === session.facilitator_id) {
        fetch(`/api/sessions/${session.code}/plan`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: true }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) setPlan(data as SprintPlanPayload);
          })
          .catch(() => {
            // Non-fatal — the host can hit "Refresh totals" manually.
          });
      }
    },
    [session.code, session.facilitator_id, user?.id]
  );

  const handlePlanUpdated = useCallback((payload: SprintPlanPayload) => {
    setPlan(payload);
  }, []);

  const handlePlanCommitted = useCallback(
    (payload: PlanCommittedPayload) => {
      setPlan(payload.plan);
      if (user?.id !== session.facilitator_id) {
        const removedCount = payload.removed?.length ?? 0;
        toast.success(
          `${payload.moved.length} ticket${payload.moved.length === 1 ? "" : "s"} moved to ${payload.sprint_name}` +
            (removedCount > 0 ? ` · ${removedCount} removed` : "")
        );
      }
    },
    [session.facilitator_id, user?.id]
  );

  /**
   * Adds a Jira assignee the host doesn't have on the roster yet, then applies
   * that assignment to the ticket. Offered from the add-to-plan toast so the
   * host never has to retype someone Jira already knows about.
   */
  const handleAddSuggestedTeammate = useCallback(
    async (suggestion: SuggestedTeammate) => {
      try {
        const res = await fetch(`/api/sessions/${session.code}/plan/teammates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: suggestion.account_id,
            display_name: suggestion.display_name,
            email: suggestion.email,
            avatar_url: suggestion.avatar_url,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setPlan(data as SprintPlanPayload);
        // Mirror the roster locally so the host's next session starts pre-filled.
        saveStoredTeammates((data as SprintPlanPayload).teammates ?? []);

        // Only now is the accountId a valid assignee — /plan/[key] rejects
        // anyone who isn't on the roster.
        const assignRes = await fetch(
          `/api/sessions/${session.code}/plan/${encodeURIComponent(suggestion.issue_key)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignee_account_id: suggestion.account_id }),
          }
        );
        const assigned = await assignRes.json();
        if (!assignRes.ok) throw new Error(assigned.error);
        setPlan(assigned as SprintPlanPayload);

        toast.success(
          `${suggestion.display_name} added to the team and assigned ${suggestion.issue_key}`
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to add teammate");
      }
    },
    [session.code]
  );

  /** Adds a ticket to the sprint plan (facilitator only). */
  const handleAddToPlan = useCallback(
    async (issueKey: string) => {
      try {
        const res = await fetch(`/api/sessions/${session.code}/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issue_key: issueKey }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setPlan(data as SprintPlanPayload);

        const suggestion = (data as { suggested_teammate?: SuggestedTeammate | null })
          .suggested_teammate;

        if (suggestion) {
          toast.success(
            `${issueKey} added — assigned to ${suggestion.display_name} in Jira, who isn't on your team yet`,
            {
              duration: 10000,
              action: {
                label: "Add to team",
                onClick: () => {
                  void handleAddSuggestedTeammate(suggestion);
                },
              },
            }
          );
        } else {
          toast.success(`${issueKey} added to sprint plan`);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to add to sprint plan");
      }
    },
    [session.code, handleAddSuggestedTeammate]
  );

  /** Removes a ticket from the sprint plan (facilitator only). */
  const handleRemoveFromPlan = useCallback(
    async (issueKey: string) => {
      try {
        const res = await fetch(
          `/api/sessions/${session.code}/plan/${encodeURIComponent(issueKey)}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const next = data as SprintPlanPayload;
        setPlan(next);
        // A ticket that was already in the destination sprint isn't deleted —
        // it's staged to be pushed back to the backlog when the host commits.
        const staged = (next.pending_removals ?? []).some(
          (i) => i.issue_key === issueKey
        );
        toast.success(
          staged
            ? `${issueKey} will be removed from the sprint on commit`
            : `${issueKey} removed from sprint plan`
        );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Failed to remove from sprint plan"
        );
      }
    },
    [session.code]
  );

  const handleIssueUpdated = useCallback((payload: IssueUpdatedPayload) => {
    if (payload.issue) {
      setCurrentIssue(payload.issue);
    }
  }, []);

  const handlePlanVisibility = useCallback((open: boolean) => {
    setHostPlanOpen(open);
  }, []);

  const handleHostLeft = useCallback(() => {
    setHostPlanOpen(false);
    setSessionEnded(true);
  }, []);

  const handleKicked = useCallback(() => {
    setKicked(true);
  }, []);

  async function handleEndSession() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.code}/end`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      router.push("/");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to end session");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleKick(userId: string) {
    try {
      const res = await fetch(`/api/sessions/${session.code}/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to kick participant");
    }
  }

  async function handleNudge(userId: string) {
    try {
      const res = await fetch(`/api/sessions/${session.code}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to nudge participant");
    }
  }

  // Track when the most recent vote arrived so we can fire the auto-nudge timer
  // relative to actual voting activity rather than a fixed wall-clock delay.
  const lastVoteAtRef = useRef<number | null>(null);
  const autoNudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNudgedRef = useRef<Set<string>>(new Set());

  const { participants, markVoted, hydrateVotedIds, broadcastPlanVisibility } = useSessionChannel({
    code: session.code,
    userId: user?.id ?? "",
    displayName,
    avatarEmoji,
    isFacilitator,
    facilitatorId: session.facilitator_id,
    onReveal: handleRevealEvent,
    onClear: handleClearEvent,
    onLocked: handleLockedEvent,
    onIssueSelect: handleIssueSelectEvent,
    onPointsSubmitted: handlePointsSubmitted,
    onIssueUpdated: handleIssueUpdated,
    onPlanUpdated: handlePlanUpdated,
    onPlanCommitted: handlePlanCommitted,
    onPlanVisibility: isFacilitator ? undefined : handlePlanVisibility,
    onHostLeft: isFacilitator ? undefined : handleHostLeft,
    onKicked: isFacilitator ? undefined : handleKicked,
    onNudged: isFacilitator ? undefined : () => toast("Don't forget to vote!", { description: "The host is waiting for your vote." }),
  });

  // Host: mirror the sprint plan sheet's open state to guests so they get a
  // read-only copy. Re-fires when the roster changes so a late joiner also
  // picks up an already-open panel.
  const rosterSize = participants.length;
  useEffect(() => {
    if (!isFacilitator) return;
    broadcastPlanVisibility(planSheetOpen);
  }, [isFacilitator, planSheetOpen, rosterSize, broadcastPlanVisibility]);

  // Auto-nudge: when the facilitator is in a voting round and exactly one
  // participant hasn't voted, wait 5 s after the last vote then nudge them once.
  const prevVotedCountRef = useRef(0);
  useEffect(() => {
    if (!isFacilitator || roomState !== "voting") {
      prevVotedCountRef.current = 0;
      autoNudgedRef.current = new Set();
      if (autoNudgeTimerRef.current) {
        clearTimeout(autoNudgeTimerRef.current);
        autoNudgeTimerRef.current = null;
      }
      return;
    }

    const voters = participants.filter((p) => !p.is_facilitator);
    const votedCount = voters.filter((p) => p.has_voted).length;
    const unvoted = voters.filter((p) => !p.has_voted);

    // Record the timestamp whenever a new vote comes in.
    if (votedCount > prevVotedCountRef.current) {
      lastVoteAtRef.current = Date.now();
      prevVotedCountRef.current = votedCount;
    }

    // Cancel any pending timer first.
    if (autoNudgeTimerRef.current) {
      clearTimeout(autoNudgeTimerRef.current);
      autoNudgeTimerRef.current = null;
    }

    // Only proceed when exactly one person hasn't voted, at least one vote has
    // been cast, and we haven't already auto-nudged this person this round.
    if (
      unvoted.length === 1 &&
      votedCount > 0 &&
      !autoNudgedRef.current.has(unvoted[0].user_id)
    ) {
      const target = unvoted[0];
      const elapsed = lastVoteAtRef.current ? Date.now() - lastVoteAtRef.current : 0;
      const delay = Math.max(0, 5000 - elapsed);

      autoNudgeTimerRef.current = setTimeout(() => {
        autoNudgeTimerRef.current = null;
        autoNudgedRef.current.add(target.user_id);
        handleNudge(target.user_id);
      }, delay);
    }

    return () => {
      if (autoNudgeTimerRef.current) {
        clearTimeout(autoNudgeTimerRef.current);
        autoNudgeTimerRef.current = null;
      }
    };
  }, [participants, roomState, isFacilitator]);

  // Restore which participants have voted after a facilitator refresh.
  // Runs once when the facilitator first becomes joined. Voting state is checked
  // inside the handler because revealed state already hydrates voted IDs via GET /reveal.
  useEffect(() => {
    if (!isFacilitator || !joined) return;
    if (roomState !== "voting") return;
    fetch(`/api/sessions/${session.code}/vote`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.voted_user_ids) hydrateVotedIds(data.voted_user_ids);
      })
      .catch(() => {});
  }, [isFacilitator, joined, roomState, session.code, hydrateVotedIds]);

  // Check if facilitator has Jira credentials on mount
  useEffect(() => {
    if (!isFacilitator) return;
    fetch("/api/jira/connect")
      .then((res) => res.json())
      .then((data) => {
        if (data.connected) {
          setJiraConnected(true);
          setJiraEmail(data.email);
          if (data.base_url) setJiraBaseUrl(data.base_url);
          if (data.ac_field) setAcField(data.ac_field);
          if (data.story_points_field) setStoryPointsField(data.story_points_field);
        }
      })
      .catch(() => {});
  }, [isFacilitator]);

  async function handleJoin(name: string, avatar: string | null) {
    setJoinLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name, avatar_emoji: avatar }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setDisplayName(name);
      setAvatarEmoji(avatar);
      setJoined(true);
      await hydrateRoomState(roomState);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to join");
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleVote(value: number) {
    setSelectedVote(value);
    try {
      const res = await fetch(`/api/sessions/${session.code}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, issue_key: issueKey }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      markVoted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to vote");
      setSelectedVote(null);
    }
  }

  async function handleReveal() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.code}/reveal`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      const data = await res.json();
      handleRevealEvent(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reveal");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleClear() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.code}/clear`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      // Don't call handleClearEvent here directly — the server broadcasts "clear"
      // to all subscribers including the facilitator, which calls handleClearEvent
      // once via the broadcast handler. Calling it here too caused a double
      // channel.track(), which triggered a presence LEAVE+SYNC before the JOIN
      // landed, making participants briefly see the host as absent.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleLock() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.code}/lock`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      const data = await res.json();
      handleLockedEvent(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to lock votes");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSelectIssue(issue: JiraIssue) {
    try {
      const res = await fetch(`/api/sessions/${session.code}/select-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_key: issue.key }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      const data = await res.json();
      handleIssueSelectEvent({
        issueKey: data.issue_key,
        issue: data.issue ?? issue,
        jiraBaseUrl: data.jira_base_url ?? null,
        acField: data.ac_field ?? null,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to select issue");
    }
  }

  async function handleDisconnectJira() {
    try {
      await fetch("/api/jira/connect", { method: "DELETE" });
      setJiraConnected(false);
      setJiraEmail(null);
      setJiraBaseUrl(null);
      setAcField(null);
      setCurrentIssue(null);
      toast.success("Disconnected from Jira");
    } catch {
      toast.error("Failed to disconnect");
    }
  }

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (sessionEnded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-foreground">This session has ended</p>
          <p className="text-xs text-muted-foreground">The facilitator has left the room.</p>
        </div>
      </div>
    );
  }

  if (kicked) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-foreground">You have been removed</p>
          <p className="text-xs text-muted-foreground">The facilitator has removed you from this session.</p>
        </div>
      </div>
    );
  }

  if (!joined) {
    return (
      <JoinDialog open={true} onJoin={handleJoin} loading={joinLoading} isHost={isFacilitator} />
    );
  }

  const showIssuePanel = isFacilitator && jiraConnected;

  // The plan chip is shown to everyone once there is a plan; the host also
  // sees it (as the sheet trigger) while the plan is still empty. Sessions
  // without Jira have nothing to move, so it stays hidden there.
  const showSprintPlan = showIssuePanel || plan.items.length > 0;

  const issueLabel = issueKey.startsWith("round-")
    ? `Round ${issueKey.split("-")[1]}`
    : issueKey;

  const voters = participants.filter((p) => !p.is_facilitator);
  const allVoted = voters.length > 0 && voters.every((p) => p.has_voted);

  return (
    <>
    {showConsensusModal && (
      <ConsensusModal onDismiss={() => setShowConsensusModal(false)} />
    )}
    {showIssuePanel && (
      <SprintPlanSheet
        open={planSheetOpen}
        onOpenChange={setPlanSheetOpen}
        sessionCode={session.code}
        plan={plan}
        onPlanChange={setPlan}
      />
    )}
    {!isFacilitator && (
      <SprintPlanSheet
        readOnly
        open={hostPlanOpen}
        onOpenChange={() => {}}
        sessionCode={session.code}
        plan={plan}
        onPlanChange={setPlan}
      />
    )}
    <div className="flex flex-1 overflow-hidden bg-background">
      {/* Left: Issue list sidebar (facilitator + Jira only) — desktop only */}
      {showIssuePanel && (
        <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-sidebar flex-col overflow-hidden">
          <div className="px-3 pt-3 pb-2 shrink-0 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
              Sprint Issues
            </span>
          </div>
          <IssueList
            onSelectIssue={handleSelectIssue}
            currentIssueKey={issueKey}
            pointedIssues={pointedIssues}
            storyPointsField={storyPointsField}
            onAddToPlan={(issue) => handleAddToPlan(issue.key)}
            onRemoveFromPlan={(issue) => handleRemoveFromPlan(issue.key)}
            planKeys={planKeys}
          />
        </aside>
      )}

      {/* Center: Main voting area */}
      <div className="flex-1 flex flex-col overflow-y-auto min-w-0">
        {/* Top bar */}
        <header className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-border bg-background">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile: Sprint Issues sheet trigger */}
            {showIssuePanel && (
              <Sheet>
                <SheetTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" className="md:hidden shrink-0" aria-label="Sprint Issues" />
                  }
                >
                  <ListIcon className="h-4 w-4" />
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0 flex flex-col">
                  <div className="px-3 pt-3 pb-2 shrink-0 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                      Sprint Issues
                    </span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <IssueList
                      onSelectIssue={handleSelectIssue}
                      currentIssueKey={issueKey}
                      pointedIssues={pointedIssues}
                      storyPointsField={storyPointsField}
                      onAddToPlan={(issue) => handleAddToPlan(issue.key)}
                      onRemoveFromPlan={(issue) => handleRemoveFromPlan(issue.key)}
                      planKeys={planKeys}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            )}
            <h1 className="text-sm font-semibold text-foreground truncate">
              Pointing Poker Plus
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showSprintPlan && (
              <SprintPlanChip
                count={plan.items.length}
                totalPoints={plan.total_points}
                capacityPoints={plan.capacity_points}
                unpointedCount={plan.unpointed_count}
                onClick={isFacilitator ? () => setPlanSheetOpen(true) : undefined}
              />
            )}
            {isFacilitator && !jiraConnected && (
              <JiraConnectDialog
                onConnected={(info) => {
                  setJiraConnected(true);
                  setJiraEmail(info.email);
                }}
              />
            )}
            {isFacilitator && jiraConnected && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-6 px-2"
                onClick={handleDisconnectJira}
              >
                Disconnect Jira
              </Button>
            )}
            <ShareLink code={session.code} />
            <ThemeToggle />
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 flex flex-col gap-4 p-4">
          {/* Active issue panel */}
          {currentIssue && (
            <IssuePanel
              issue={currentIssue}
              sessionCode={session.code}
              isFacilitator={isFacilitator}
              revealed={roomState !== "voting"}
              voteAverage={revealData?.average ?? null}
              voteMedian={revealData?.median ?? null}
              jiraBaseUrl={jiraBaseUrl}
              acField={acField}
              onAddToPlan={showIssuePanel ? handleAddToPlan : undefined}
              onRemoveFromPlan={showIssuePanel ? handleRemoveFromPlan : undefined}
              inSprintPlan={planKeys.has(currentIssue.key)}
            />
          )}

          {roomState === "voting" ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
              {isFacilitator ? (
                allVoted ? (
                  <p className="text-sm font-semibold text-[#4BCE97] tracking-wide uppercase">
                    All participants have voted
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Waiting for participants to vote…
                  </p>
                )
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {selectedVote
                      ? `You voted ${selectedVote} — change your vote below`
                      : "Pick a card to cast your vote"}
                  </p>
                  <CardDeck
                    selectedValue={selectedVote}
                    onVote={handleVote}
                    disabled={roomState !== "voting"}
                  />
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-6 py-4">
              {revealData && (
                <VoteReveal reveal={revealData} participants={participants} />
              )}
              {!isFacilitator && (
                <div className="flex flex-col items-center gap-3 pt-2 border-t border-border">
                  <p className="text-sm text-muted-foreground">
                    {roomState === "locked"
                      ? "Votes are locked"
                      : selectedVote
                        ? `You voted ${selectedVote} — change your vote as discussion happens`
                        : "Pick a card to cast your vote"}
                  </p>
                  <CardDeck
                    selectedValue={selectedVote}
                    onVote={handleVote}
                    disabled={roomState === "locked"}
                  />
                </div>
              )}
            </div>
          )}

          {/* Participants — inline on mobile, hidden on desktop (shown in sidebar) */}
          <div className="md:hidden border-t border-border pt-3">
            <ParticipantList
              participants={participants}
              facilitatorId={session.facilitator_id}
              currentUserId={user?.id}
              onKick={isFacilitator ? handleKick : undefined}
              onNudge={isFacilitator ? handleNudge : undefined}
            />
          </div>

          {isFacilitator && (
            <div className="shrink-0 pt-2 border-t border-border">
              <FacilitatorControls
                state={roomState}
                onReveal={handleReveal}
                onLock={handleLock}
                onClear={handleClear}
                onEndSession={handleEndSession}
                loading={actionLoading}
                voteCount={participants.filter((p) => !p.is_facilitator && p.has_voted).length}
                totalVoters={participants.filter((p) => !p.is_facilitator).length}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right: Participants sidebar — desktop only */}
      <aside className="hidden md:block w-52 shrink-0 border-l border-border bg-sidebar p-3 overflow-y-auto">
        <ParticipantList
          participants={participants}
          facilitatorId={session.facilitator_id}
          currentUserId={user?.id}
          onKick={isFacilitator ? handleKick : undefined}
          onNudge={isFacilitator ? handleNudge : undefined}
        />
      </aside>
    </div>
    </>
  );
}
