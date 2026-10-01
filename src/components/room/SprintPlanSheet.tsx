"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { capacityStatus, CAPACITY_STATUS_CLASSES } from "@/components/room/SprintPlanChip";
import { TeammateRoster } from "@/components/room/TeammateRoster";
import {
  computeRosterCapacity,
  computeTeammateTotals,
  capacityAccent,
  type SprintPlanItem,
} from "@/lib/session/plan";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveStoredTeammates } from "@/lib/session/teammate-storage";
import type { SprintPlanPayload } from "@/lib/session/realtime";
import type { JiraBoard, JiraSprint, JiraUser } from "@/lib/jira/types";

export type SprintPlanSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionCode: string;
  plan: SprintPlanPayload;
  /** Called with fresh plan state after any mutating action. */
  onPlanChange: (plan: SprintPlanPayload) => void;
  /**
   * Guest view: ticket list + capacity progress only. No capacity editing,
   * no removal, no destination/commit controls — and no way to dismiss it:
   * close requests are ignored so the panel tracks the host's sheet exactly.
   */
  readOnly?: boolean;
};

const UNASSIGNED = "__unassigned__";

type Destination = "existing" | "new";

export function SprintPlanSheet({
  open,
  onOpenChange,
  sessionCode,
  plan,
  onPlanChange,
  readOnly = false,
}: SprintPlanSheetProps) {
  // Collapsed assignee groups, keyed by group key. Purely local presentation —
  // never broadcast, so one person folding a group can't hide it for everyone.
  const [syncing, setSyncing] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const [capacityInput, setCapacityInput] = useState<string>(
    plan.capacity_points === null ? "" : String(plan.capacity_points)
  );
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [boardId, setBoardId] = useState<string>(
    plan.destination?.board_id === null || plan.destination?.board_id === undefined
      ? ""
      : String(plan.destination.board_id)
  );
  const [destination, setDestination] = useState<Destination>("existing");
  // Landing tab: setup until a sprint is chosen, since the destination decides
  // what the plan contains. Initial state only — it must never yank the host
  // between tabs mid-session.
  const [tab, setTab] = useState<string>(
    plan.destination?.sprint_id ? "plan" : "setup"
  );
  const [sprintId, setSprintId] = useState<string>(
    plan.destination?.sprint_id === null || plan.destination?.sprint_id === undefined
      ? ""
      : String(plan.destination.sprint_id)
  );
  const [savingDestination, setSavingDestination] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [newSprintName, setNewSprintName] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [committing, setCommitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [committed, setCommitted] = useState<{ name: string; moved: number } | null>(null);

  // Re-sync the capacity input when the broadcast plan changes underneath us.
  // Adjusting state during render (rather than in an effect) avoids a wasted
  // render pass — the React-recommended "derive state from props" pattern.
  const [syncedCapacity, setSyncedCapacity] = useState(plan.capacity_points);
  if (syncedCapacity !== plan.capacity_points) {
    setSyncedCapacity(plan.capacity_points);
    setCapacityInput(plan.capacity_points === null ? "" : String(plan.capacity_points));
  }

  // The destination lives on the session, so a reload or a second host tab
  // picks up whatever sprint the plan is already pointed at.
  const planBoardId =
    plan.destination?.board_id === null || plan.destination?.board_id === undefined
      ? ""
      : String(plan.destination.board_id);
  const planSprintId =
    plan.destination?.sprint_id === null || plan.destination?.sprint_id === undefined
      ? ""
      : String(plan.destination.sprint_id);

  const [syncedDestination, setSyncedDestination] = useState(
    `${planBoardId}|${planSprintId}`
  );
  if (syncedDestination !== `${planBoardId}|${planSprintId}`) {
    setSyncedDestination(`${planBoardId}|${planSprintId}`);
    setBoardId(planBoardId);
    setSprintId(planSprintId);
  }

  useEffect(() => {
    if (readOnly || !open || boards.length !== 0) return;
    // Inlined async closure (rather than calling the separately-defined
    // loadBoards callback) so setState happens inside the async function,
    // not synchronously in the effect body itself.
    (async () => {
      try {
        const res = await fetch("/api/jira/sprints");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setBoards(data.boards ?? []);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load boards");
      }
    })();
  }, [readOnly, open, boards.length]);

  // Hydrate the sprint list for a destination that was chosen before this
  // client opened the sheet — without it the trigger would show a bare id.
  useEffect(() => {
    if (readOnly || !open || boardId === "" || sprints.length !== 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/jira/sprints?boardId=${boardId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSprints(data.sprints ?? []);
      } catch {
        // Non-fatal — the host can re-pick the board to retry.
      }
    })();
  }, [readOnly, open, boardId, sprints.length]);

  // Re-pull the destination sprint's real contents every time the host opens
  // the sheet. Sprint membership changes in Jira (and in other people's
  // sessions) without telling us, so the plan was only ever as fresh as the
  // last destination change. Reuses the destination route, which already drops
  // stale sprint-origin rows and keeps host-added ones.
  useEffect(() => {
    if (readOnly || !open) return;
    const syncBoardId = plan.destination?.board_id ?? null;
    const syncSprintId = plan.destination?.sprint_id ?? null;
    if (syncBoardId === null || syncSprintId === null) return;

    let cancelled = false;
    (async () => {
      setSyncing(true);
      try {
        const res = await fetch(`/api/sessions/${sessionCode}/plan/destination`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            board_id: syncBoardId,
            sprint_id: syncSprintId,
            sprint_name: plan.destination?.sprint_name ?? null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (!cancelled) onPlanChange(data as SprintPlanPayload);
      } catch {
        // Non-fatal: the host keeps the last known plan rather than an error
        // wall, and can re-pick the sprint to retry.
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on `open` alone — this call replaces `plan`, so
    // depending on the destination would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, open, sessionCode]);

  /**
   * Persist the plan's destination. Selecting an existing sprint pulls its
   * tickets into the plan; a null sprint clears them. Returns false on failure
   * so the caller can leave the local selection alone.
   */
  async function saveDestination(
    nextBoardId: string,
    nextSprintId: string
  ): Promise<boolean> {
    setSavingDestination(true);
    try {
      const sprint = sprints.find((s) => String(s.id) === nextSprintId);
      const res = await fetch(`/api/sessions/${sessionCode}/plan/destination`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board_id: nextBoardId === "" ? null : Number(nextBoardId),
          sprint_id: nextSprintId === "" ? null : Number(nextSprintId),
          sprint_name: sprint?.name ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onPlanChange(data as SprintPlanPayload);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to set destination sprint");
      return false;
    } finally {
      setSavingDestination(false);
    }
  }

  async function handleBoardChange(value: string | null) {
    if (!value) return;
    setBoardId(value);
    setSprintId("");
    setSprints([]);
    // A new board invalidates the sprint, so the plan's sprint-origin tickets
    // go with it until the host picks a sprint on the new board.
    await saveDestination(value, "");
    try {
      const res = await fetch(`/api/jira/sprints?boardId=${value}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSprints(data.sprints ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load sprints");
    }
  }

  async function handleSprintChange(value: string | null) {
    if (!value) return;
    const previous = sprintId;
    setSprintId(value);
    const ok = await saveDestination(boardId, value);
    if (!ok) setSprintId(previous);
  }

  async function handleDestinationTypeChange(value: Destination) {
    setDestination(value);
    // "Create new sprint" has no existing tickets to manage, so the plan's
    // sprint-origin tickets are dropped; host-added ones carry over.
    if (value === "new" && sprintId !== "") {
      setSprintId("");
      await saveDestination(boardId, "");
    }
  }

  async function handleUndoRemoval(issueKey: string) {
    setUndoing(issueKey);
    try {
      const res = await fetch(
        `/api/sessions/${sessionCode}/plan/${encodeURIComponent(issueKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ removed: false }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onPlanChange(data as SprintPlanPayload);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore ticket");
    } finally {
      setUndoing(null);
    }
  }

  async function patchPlan(body: Record<string, unknown>) {
    const res = await fetch(`/api/sessions/${sessionCode}/plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    onPlanChange(data as SprintPlanPayload);
  }

  async function saveCapacity(value: number | null) {
    setSavingCapacity(true);
    try {
      await patchPlan({ capacity_points: value });
      setCapacityInput(value === null ? "" : String(value));
      toast.success("Capacity updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save capacity");
    } finally {
      setSavingCapacity(false);
    }
  }

  async function handleSaveCapacity() {
    const trimmed = capacityInput.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      toast.error("Capacity must be a non-negative number");
      return;
    }
    await saveCapacity(value);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await patchPlan({ refresh: true });
      toast.success("Totals refreshed from Jira");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh totals");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRemove(issueKey: string) {
    setRemoving(issueKey);
    try {
      const res = await fetch(
        `/api/sessions/${sessionCode}/plan/${encodeURIComponent(issueKey)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onPlanChange(data as SprintPlanPayload);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove ticket");
    } finally {
      setRemoving(null);
    }
  }

  /** Shared writer for the roster routes — all return full plan state. */
  async function mutateRoster(
    path: string,
    init: RequestInit,
    failureMessage: string
  ): Promise<void> {
    try {
      const res = await fetch(`/api/sessions/${sessionCode}/plan/teammates${path}`, init);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const next = data as SprintPlanPayload;
      onPlanChange(next);
      // Mirror the roster locally so the host's next session starts pre-filled.
      saveStoredTeammates(next.teammates ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : failureMessage);
    }
  }

  async function handleAddTeammate(user: JiraUser) {
    await mutateRoster(
      "",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: user.accountId,
          display_name: user.displayName,
          email: user.emailAddress ?? null,
          avatar_url: user.avatarUrls?.["48x48"] ?? null,
        }),
      },
      "Failed to add teammate"
    );
  }

  async function handleRemoveTeammate(accountId: string) {
    await mutateRoster(
      `/${encodeURIComponent(accountId)}`,
      { method: "DELETE" },
      "Failed to remove teammate"
    );
  }

  async function handleTeammateCapacity(accountId: string, capacity: number | null) {
    await mutateRoster(
      "",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, capacity_points: capacity }),
      },
      "Failed to update teammate capacity"
    );
  }

  async function handleAssign(issueKey: string, accountId: string) {
    try {
      const res = await fetch(
        `/api/sessions/${sessionCode}/plan/${encodeURIComponent(issueKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assignee_account_id: accountId === UNASSIGNED ? null : accountId,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onPlanChange(data as SprintPlanPayload);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign ticket");
    }
  }

  // Sprint-origin tickets are already where they need to be, so only the
  // host-added ones are actually moved on commit. But the plan can still be
  // "dirty" with nothing to move — e.g. an assignee changed on a ticket
  // already in the sprint — and that change only reaches Jira via commit,
  // so committing must stay available whenever there's any item at all.
  const toMoveCount = plan.items.filter((i) => i.origin === "added").length;
  const pendingRemovals = plan.pending_removals ?? [];
  const hasMoveOrRemoveWork = toMoveCount > 0 || pendingRemovals.length > 0;
  const hasSyncOnlyWork = !hasMoveOrRemoveWork && plan.items.length > 0;

  const canCommit =
    (hasMoveOrRemoveWork || hasSyncOnlyWork) &&
    (destination === "existing" ? sprintId !== "" : boardId !== "" && newSprintName.trim() !== "");

  async function handleCommit() {
    setCommitting(true);
    try {
      const body =
        destination === "existing"
          ? { sprint_id: Number(sprintId) }
          : {
              board_id: Number(boardId),
              name: newSprintName.trim(),
              ...(startDate ? { start_date: new Date(startDate).toISOString() } : {}),
              ...(endDate ? { end_date: new Date(endDate).toISOString() } : {}),
            };

      const res = await fetch(`/api/sessions/${sessionCode}/plan/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onPlanChange(data.plan as SprintPlanPayload);
      setCommitted({ name: data.sprint_name, moved: data.moved.length });
      setConfirming(false);

      if (data.failed?.length) {
        toast.error(
          `${data.moved.length} moved, ${data.failed.length} failed — failed tickets kept in the plan`
        );
      } else {
        toast.success(`${data.moved.length} tickets moved to ${data.sprint_name}`);
      }

      if (data.assign_failed?.length) {
        // The move itself succeeded — assignee writes are best-effort.
        toast.error(
          `Could not set the assignee on ${data.assign_failed.length} ticket${
            data.assign_failed.length === 1 ? "" : "s"
          }`
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to commit sprint plan");
    } finally {
      setCommitting(false);
    }
  }

  const status = capacityStatus(plan.total_points, plan.capacity_points);
  const teammates = plan.teammates ?? [];

  // If the host has bothered to set per-person targets, the team capacity that
  // matches them is the only one that can't contradict the roster.
  const suggestedCapacity = computeRosterCapacity(teammates);
  const suggestionDiffers =
    suggestedCapacity !== null && suggestedCapacity !== plan.capacity_points;
  const { byAccountId, unassigned } = computeTeammateTotals(plan.items, teammates);

  // Group the ticket list by assignee so the host reads workload per person,
  // with unassigned work last. Tickets pointing at a removed teammate fall into
  // the unassigned group (computeTeammateTotals applies the same rule).
  const known = new Set(teammates.map((t) => t.account_id));

  // Base UI renders the raw select value unless given a formatter, so map the
  // accountId back to the person's name for the trigger label.
  const teammateName = (accountId: string) =>
    teammates.find((t) => t.account_id === accountId)?.display_name ?? "Unassigned";

  const boardName = (id: string) =>
    boards.find((b) => String(b.id) === id)?.name ?? "Select board";

  const sprintName = (id: string) => {
    const s = sprints.find((x) => String(x.id) === id);
    return s ? `${s.name} (${s.state})` : "Select sprint";
  };

  const groups: {
    key: string;
    label: string;
    items: SprintPlanItem[];
    points: number;
    capacity: number | null;
  }[] = [
    ...teammates.map((t) => ({
      key: t.account_id,
      label: t.display_name,
      items: plan.items.filter((i) => i.assignee_account_id === t.account_id),
      points: byAccountId[t.account_id]?.assigned_points ?? 0,
      capacity: t.capacity_points,
    })),
    {
      key: UNASSIGNED,
      label: "Unassigned",
      items: plan.items.filter(
        (i) => i.assignee_account_id === null || !known.has(i.assignee_account_id)
      ),
      points: unassigned.assigned_points,
      capacity: null,
    },
    // Every teammate stays on screen even with nothing assigned — an empty
    // group is exactly the person the host is looking for. Only the unassigned
    // bucket is hidden when it's empty, since it isn't anybody.
  ].filter((g) => g.key !== UNASSIGNED || g.items.length > 0);

  const remaining =
    plan.capacity_points !== null ? plan.capacity_points - plan.total_points : null;
  const progressPct =
    plan.capacity_points && plan.capacity_points > 0
      ? Math.min(100, (plan.total_points / plan.capacity_points) * 100)
      : 0;

  return (
    <Sheet open={open} onOpenChange={readOnly ? () => {} : onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={!readOnly}
        className="w-full sm:max-w-md flex flex-col gap-0 p-0"
      >
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border">
          <SheetTitle className="text-sm">Sprint Plan</SheetTitle>
          <SheetDescription className="text-xs">
            {readOnly
              ? "The host is planning the next sprint — this is a live, view-only copy."
              : "Queue tickets for the next sprint and track them against your capacity."}
          </SheetDescription>
        </SheetHeader>

        {/* Totals — pinned outside the tabs: this is the number the host is
            planning against, so it must survive both tab switches and scrolling. */}
        <div
          className="px-4 py-3 border-b border-border space-y-1.5 shrink-0"
          data-testid="plan-totals"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">
              {plan.items.length} ticket{plan.items.length === 1 ? "" : "s"}
              {syncing && (
                <span data-testid="plan-syncing" className="ml-1.5 text-[10px]">
                  syncing…
                </span>
              )}
            </span>
            <span
              className={cn(
                "text-sm font-mono font-semibold",
                status === "over" && "text-red-700 dark:text-[#F87168]",
                status === "at" && "text-emerald-700 dark:text-[#4BCE97]"
              )}
            >
              {plan.capacity_points !== null
                ? `${plan.total_points}/${plan.capacity_points} pts`
                : `${plan.total_points} pts`}
            </span>
          </div>

          {plan.capacity_points !== null && (
            <>
              <div className="h-1.5 w-full rounded-sm bg-muted overflow-hidden">
                <div
                  data-testid="capacity-bar"
                  className={cn(
                    "h-full transition-all",
                    status === "over"
                      ? "bg-red-500 dark:bg-[#F87168]"
                      : status === "at"
                        ? "bg-emerald-500 dark:bg-[#4BCE97]"
                        : "bg-blue-500 dark:bg-[#579DFF]"
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {status === "over"
                  ? `${Math.abs(remaining as number)} pts over capacity`
                  : `${remaining} pts remaining`}
              </p>
            </>
          )}

          {plan.unpointed_count > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-[#F5CD47]">
              {plan.unpointed_count} unpointed ticket
              {plan.unpointed_count === 1 ? "" : "s"} counted as 0 — total is an undercount.
            </p>
          )}
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => v && setTab(v as string)}
          className="flex-1 min-h-0 gap-0"
        >
          <TabsList variant="line" className="w-full h-9 px-2 shrink-0 border-b border-border">
            <TabsTrigger
              value="setup"
              className="text-xs cursor-pointer hover:bg-muted/70 rounded-md transition-colors"
            >
              Setup
            </TabsTrigger>
            <TabsTrigger
              value="plan"
              className="text-xs cursor-pointer hover:bg-muted/70 rounded-md transition-colors"
            >
              Plan{plan.items.length > 0 ? ` · ${plan.items.length}` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="min-h-0 overflow-y-auto">
          {/* Destination first — the target sprint decides what the plan contains */}
          {!readOnly && (
            <section
              className="mx-3 my-3 rounded-md border-2 border-border overflow-hidden bg-card shadow-sm"
              data-testid="destination-picker"
            >
              <p className="px-3 py-2 border-b-2 border-border bg-muted/40 text-xs font-semibold tracking-wide">Destination</p>
              <div className="px-3 py-3 space-y-2">
              <Select
                value={destination}
                onValueChange={(v) => v && handleDestinationTypeChange(v as Destination)}
              >
                <SelectTrigger className="h-7 text-xs w-full" aria-label="Destination type">
                  <SelectValue>
                    {(v: string) =>
                      v === "new" ? "Create new sprint" : "Existing sprint"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="existing" className="text-xs">
                    Existing sprint
                  </SelectItem>
                  <SelectItem value="new" className="text-xs">
                    Create new sprint
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={boardId} onValueChange={handleBoardChange} disabled={savingDestination}>
                <SelectTrigger className="h-7 text-xs w-full" aria-label="Board">
                  <SelectValue placeholder="Select board">
                    {(v: string) => boardName(v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {boards.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)} className="text-xs">
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {destination === "existing" ? (
                <Select value={sprintId} onValueChange={handleSprintChange}>
                  <SelectTrigger className="h-7 text-xs w-full" aria-label="Target sprint">
                    <SelectValue placeholder="Select sprint">
                      {(v: string) => sprintName(v)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sprints.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)} className="text-xs">
                        {s.name} ({s.state})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="space-y-2">
                  <Input
                    value={newSprintName}
                    onChange={(e) => setNewSprintName(e.target.value)}
                    placeholder="New sprint name"
                    aria-label="New sprint name"
                    className="h-7 text-xs"
                  />
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      aria-label="Sprint start date"
                      className="h-7 text-xs"
                    />
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      aria-label="Sprint end date"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              )}

              {savingDestination && (
                <p className="text-[10px] text-muted-foreground">Loading sprint tickets…</p>
              )}
              </div>
            </section>
          )}

          {/* Destination (guests see it, but cannot change it) */}
          {readOnly && plan.destination?.sprint_name && (
            <section className="mx-3 my-3 rounded-md border-2 border-border overflow-hidden bg-card shadow-sm">
              <p className="px-3 py-2 border-b-2 border-border bg-muted/40 text-xs font-semibold tracking-wide">Destination</p>
              <p className="px-3 py-2 text-xs" data-testid="guest-destination">
                {plan.destination.sprint_name}
              </p>
            </section>
          )}

          {/* Teammates — above capacity, per the host's planning flow */}
          <TeammateRoster
            teammates={teammates}
            totals={byAccountId}
            readOnly={readOnly}
            onAdd={handleAddTeammate}
            onRemove={handleRemoveTeammate}
            onCapacityChange={handleTeammateCapacity}
          />

          {/* Capacity */}
          {!readOnly && (
          <section className="mx-3 my-3 rounded-md border-2 border-border overflow-hidden bg-card shadow-sm" data-testid="capacity-section">
            <p className="px-3 py-2 border-b-2 border-border bg-muted/40 text-xs font-semibold tracking-wide">Capacity (points)</p>
            <div className="px-3 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                step="1"
                value={capacityInput}
                onChange={(e) => setCapacityInput(e.target.value)}
                placeholder="e.g. 40"
                aria-label="Capacity in points"
                className="h-7 text-xs w-24"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={handleSaveCapacity}
                disabled={savingCapacity}
              >
                {savingCapacity ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs ml-auto"
                onClick={handleRefresh}
                disabled={refreshing || plan.items.length === 0}
              >
                {refreshing ? "Refreshing…" : "Refresh totals"}
              </Button>
            </div>

            {suggestionDiffers && (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border bg-muted/30 px-2 py-1.5"
                data-testid="capacity-suggestion"
              >
                <p className="text-[11px] text-muted-foreground">
                  Roster totals {suggestedCapacity} pts
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] px-2.5 shrink-0"
                  onClick={() => saveCapacity(suggestedCapacity)}
                  disabled={savingCapacity}
                >
                  {savingCapacity ? "Applying…" : `Use ${suggestedCapacity} pts`}
                </Button>
              </div>
            )}
            </div>
          </section>
          )}
          </TabsContent>

          <TabsContent value="plan" className="min-h-0 overflow-y-auto py-1">
          {/* Items, grouped by assignee */}
          {plan.items.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 py-3">
              {readOnly
                ? "The host hasn't added any tickets to the plan yet."
                : "No tickets in the plan yet. Add them from the issue list or the active ticket panel."}
            </p>
          ) : (
            groups.map((group) => {
              const groupStatus = capacityStatus(group.points, group.capacity);
              const groupRemaining =
                group.capacity === null ? null : group.capacity - group.points;
              const isCollapsed = collapsedGroups.has(group.key);
              const groupPct =
                group.capacity && group.capacity > 0
                  ? Math.min(100, (group.points / group.capacity) * 100)
                  : 0;

              return (
              <section
                key={group.key}
                data-testid={`plan-group-${group.key}`}
                className={cn(
                  "mx-3 my-3 rounded-md border-2 border-border border-l-4 overflow-hidden bg-card shadow-sm",
                  capacityAccent(groupStatus)
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={!isCollapsed}
                  aria-controls={`group-items-${group.key}`}
                  data-testid={`group-toggle-${group.key}`}
                  className="w-full flex items-baseline justify-between gap-2 px-3 py-2 border-b-2 border-border bg-muted/40 text-left cursor-pointer transition-colors hover:bg-muted/70"
                >
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "text-[9px] text-muted-foreground transition-transform",
                        isCollapsed && "-rotate-90 inline-block"
                      )}
                    >
                      ▼
                    </span>
                    <span className="text-xs font-semibold tracking-wide truncate">
                      {group.label}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-1.5 shrink-0">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {group.items.length}
                    </span>
                    <span
                      data-testid={`group-capacity-${group.key}`}
                      className={cn(
                        "text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-sm",
                        CAPACITY_STATUS_CLASSES[groupStatus]
                      )}
                    >
                      {group.capacity === null
                        ? `${group.points} pts`
                        : `${group.points}/${group.capacity} pts`}
                    </span>
                  </span>
                </button>
                {group.capacity !== null && group.capacity > 0 && (
                  <div className="px-3 pt-2 pb-1.5 border-b border-border">
                    <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        data-testid={`group-bar-${group.key}`}
                        className={cn(
                          "h-full transition-all",
                          groupStatus === "over"
                            ? "bg-red-500"
                            : groupStatus === "at"
                              ? "bg-emerald-500"
                              : "bg-primary"
                        )}
                        style={{ width: `${groupPct}%` }}
                      />
                    </div>
                    <p
                      data-testid={`group-remaining-${group.key}`}
                      className={cn(
                        "text-[10px] mt-1",
                        groupStatus === "over"
                          ? "text-red-600 dark:text-[#F87168] font-medium"
                          : "text-muted-foreground"
                      )}
                    >
                      {groupStatus === "over"
                        ? `${Math.abs(groupRemaining as number)} pts over capacity`
                        : groupStatus === "at"
                          ? "At capacity"
                          : `${groupRemaining} pts free`}
                    </p>
                  </div>
                )}
                {!isCollapsed && group.items.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-muted-foreground">
                    No tickets assigned yet.
                  </p>
                )}
                {!isCollapsed && (
                <ul id={`group-items-${group.key}`} className="divide-y divide-border">
                  {group.items.map((item) => (
                    <li
                      key={item.issue_key}
                      className="flex items-start gap-2 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-medium">{item.issue_key}</span>
                          {item.origin === "sprint" && (
                            <span
                              data-testid={`in-sprint-${item.issue_key}`}
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-emerald-100 text-emerald-800 dark:bg-[#1C3329] dark:text-[#4BCE97]"
                            >
                              in sprint
                            </span>
                          )}
                          {item.points === null ? (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-800 dark:bg-[#2C2A1E] dark:text-[#F5CD47]">
                              unpointed
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-sm bg-blue-100 text-blue-800 dark:bg-[#1C2B41] dark:text-[#579DFF]">
                              {item.points}pt
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">
                          {item.summary}
                        </p>

                        {!readOnly && teammates.length > 0 && (
                          <Select
                            value={item.assignee_account_id ?? UNASSIGNED}
                            onValueChange={(v) => v && handleAssign(item.issue_key, v)}
                          >
                            <SelectTrigger
                              className="h-6 text-[11px] mt-1 w-full"
                              aria-label={`Assignee for ${item.issue_key}`}
                            >
                              <SelectValue>
                                {(v: string) => teammateName(v)}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNASSIGNED} className="text-xs">
                                Unassigned
                              </SelectItem>
                              {teammates.map((t) => (
                                <SelectItem
                                  key={t.account_id}
                                  value={t.account_id}
                                  className="text-xs"
                                >
                                  {t.display_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      {!readOnly && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs shrink-0"
                          aria-label={`Remove ${item.issue_key} from sprint plan`}
                          onClick={() => handleRemove(item.issue_key)}
                          disabled={removing === item.issue_key}
                        >
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                )}
              </section>
              );
            })
          )}

          {pendingRemovals.length > 0 && (
            <section
              data-testid="pending-removals"
              className="mx-3 my-3 rounded-md border-2 border-border border-l-4 border-l-amber-500 dark:border-l-[#F5CD47] overflow-hidden bg-card shadow-sm"
            >
              <div className="flex items-baseline justify-between px-3 py-2 border-b-2 border-border bg-muted/40">
                <span className="text-xs font-semibold tracking-wide text-amber-700 dark:text-[#F5CD47]">
                  Removing from sprint
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {pendingRemovals.length}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {pendingRemovals.map((item) => (
                  <li
                    key={item.issue_key}
                    className="flex items-start gap-2 px-3 py-2 opacity-60"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-mono font-medium line-through">
                        {item.issue_key}
                      </span>
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">
                        {item.summary}
                      </p>
                    </div>
                    {!readOnly && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs shrink-0"
                        aria-label={`Undo removal of ${item.issue_key}`}
                        onClick={() => handleUndoRemoval(item.issue_key)}
                        disabled={undoing === item.issue_key}
                      >
                        Undo
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground px-3 py-2 border-t-2 border-border">
                {readOnly
                  ? "These tickets will leave the sprint when the host commits."
                  : "These tickets move back to the backlog when you commit."}
              </p>
            </section>
          )}
          </TabsContent>
        </Tabs>

        {/* Commit */}
        {!readOnly && (
        <div className="border-t border-border px-4 py-3 space-y-2 shrink-0">
          {committed && (
            <p className="text-xs text-emerald-700 dark:text-[#4BCE97] font-medium">
              {committed.moved} ticket{committed.moved === 1 ? "" : "s"} moved to{" "}
              {committed.name}
            </p>
          )}
          {confirming ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={handleCommit}
                disabled={committing}
              >
                {committing
                  ? "Applying…"
                  : hasMoveOrRemoveWork
                    ? `Confirm — move ${toMoveCount}${
                        pendingRemovals.length > 0
                          ? `, remove ${pendingRemovals.length}`
                          : ""
                      }`
                    : "Confirm — sync assignee changes"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setConfirming(false)}
                disabled={committing}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="h-7 text-xs w-full"
              onClick={() => setConfirming(true)}
              disabled={!canCommit}
            >
              {pendingRemovals.length > 0
                ? `Move ${toMoveCount} · remove ${pendingRemovals.length}`
                : hasMoveOrRemoveWork
                  ? "Move tickets to sprint"
                  : "Sync assignee changes"}
            </Button>
          )}
        </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
