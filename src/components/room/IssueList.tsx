"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { JiraSprint, JiraIssue, JiraBoard, JiraQuickFilter } from "@/lib/jira/types";

function matchesQuickFilter(issue: JiraIssue, query: string): boolean {
  const statusInMatch = query.match(/status\s+in\s*\(([^)]+)\)/i);
  if (statusInMatch) {
    const values = statusInMatch[1]
      .split(",")
      .map((v) => v.trim().replace(/^["']|["']$/g, "").toLowerCase());
    return values.includes(issue.fields.status.name.toLowerCase());
  }

  const statusEqMatch = query.match(/status\s*=\s*["']?([^"'\s,)]+)["']?/i);
  if (statusEqMatch) {
    return issue.fields.status.name.toLowerCase() === statusEqMatch[1].toLowerCase();
  }

  return true;
}

/** Map Jira status name to Jira-style badge colors (light-mode readable, dark-mode Jira palette) */
function statusBadgeClasses(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("progress") || lower.includes("review") || lower.includes("active")) {
    return "bg-emerald-100 text-emerald-800 dark:bg-[#1C3A2A] dark:text-[#4BCE97]";
  }
  if (lower.includes("done") || lower.includes("complete") || lower.includes("closed") || lower.includes("resolved")) {
    return "bg-amber-100 text-amber-800 dark:bg-[#2C2A1E] dark:text-[#F5CD47]";
  }
  if (lower.includes("block") || lower.includes("flag") || lower.includes("impede")) {
    return "bg-red-100 text-red-800 dark:bg-[#3D1F1D] dark:text-[#F87168]";
  }
  // Default: To Do / Backlog
  return "bg-blue-100 text-blue-800 dark:bg-[#1C2B41] dark:text-[#579DFF]";
}

type PointFilter = "unpointed" | "pointed" | "all";

type IssueListProps = {
  onSelectIssue: (issue: JiraIssue) => void;
  currentIssueKey?: string;
  pointedIssues: { key: string; points: number }[];
  storyPointsField: string;
  /** Adds a ticket to the sprint plan. Omit to hide the add affordance. */
  onAddToPlan?: (issue: JiraIssue) => void;
  /** Removes a ticket already in the sprint plan. Omit to disable un-checking. */
  onRemoveFromPlan?: (issue: JiraIssue) => void;
  /** Issue keys already in the sprint plan. */
  planKeys?: Set<string>;
};

const STORAGE = {
  board: "pp_jira_board",
  sprint: "pp_jira_sprint",
  statusFilter: "pp_jira_status_filter",
  pointFilter: "pp_jira_point_filter",
  quickFilter: "pp_jira_quick_filter",
  search: "pp_jira_search",
} as const;

function read(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

export function IssueList({
  onSelectIssue,
  currentIssueKey,
  pointedIssues,
  storyPointsField,
  onAddToPlan,
  onRemoveFromPlan,
  planKeys,
}: IssueListProps) {
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>(() => read(STORAGE.board, ""));
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string>(() => read(STORAGE.sprint, ""));
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [loadingSprints, setLoadingSprints] = useState(false);
  const [loadingIssues, setLoadingIssues] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>(() => read(STORAGE.statusFilter, "all"));
  const [pointFilter, setPointFilter] = useState<PointFilter>(() => read(STORAGE.pointFilter, "all") as PointFilter);
  const [quickFilters, setQuickFilters] = useState<JiraQuickFilter[]>([]);
  const [selectedQuickFilter, setSelectedQuickFilter] = useState<string>(() => read(STORAGE.quickFilter, "none"));
  const [searchQuery, setSearchQuery] = useState<string>(() => read(STORAGE.search, ""));

  // Persist selections to localStorage whenever they change.
  useEffect(() => { localStorage.setItem(STORAGE.board, selectedBoardId); }, [selectedBoardId]);
  useEffect(() => { localStorage.setItem(STORAGE.sprint, selectedSprintId); }, [selectedSprintId]);
  useEffect(() => { localStorage.setItem(STORAGE.statusFilter, statusFilter); }, [statusFilter]);
  useEffect(() => { localStorage.setItem(STORAGE.pointFilter, pointFilter); }, [pointFilter]);
  useEffect(() => { localStorage.setItem(STORAGE.quickFilter, selectedQuickFilter); }, [selectedQuickFilter]);
  useEffect(() => { localStorage.setItem(STORAGE.search, searchQuery); }, [searchQuery]);

  useEffect(() => {
    // Inlined (rather than calling a separately-defined useCallback) so the
    // setState calls happen inside this async closure, not synchronously in
    // the effect body itself.
    (async () => {
      setLoadingBoards(true);
      try {
        const res = await fetch("/api/jira/sprints");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setBoards(data.boards ?? []);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load boards");
      } finally {
        setLoadingBoards(false);
      }
    })();
  }, []);

  // On mount: re-fetch sprints and issues for any previously selected board/sprint.
  useEffect(() => {
    const boardId = read(STORAGE.board, "");
    const sprintId = read(STORAGE.sprint, "");
    if (!boardId) return;

    (async () => {
      setLoadingSprints(true);
      try {
        const [sprintsRes, configRes] = await Promise.all([
          fetch(`/api/jira/sprints?boardId=${boardId}`),
          fetch(`/api/jira/board-config?boardId=${boardId}`),
        ]);
        if (sprintsRes.ok) {
          const d = await sprintsRes.json();
          setSprints(d.sprints ?? []);
        }
        if (configRes.ok) {
          const d = await configRes.json();
          setQuickFilters(d.quickFilters ?? []);
        }
      } finally {
        setLoadingSprints(false);
      }

      if (!sprintId) return;

      setLoadingIssues(true);
      try {
        const url =
          sprintId === "backlog"
            ? `/api/jira/issues?backlog=true&boardId=${boardId}`
            : `/api/jira/issues?sprintId=${sprintId}&boardId=${boardId}`;
        const res = await fetch(url);
        if (res.ok) {
          const d = await res.json();
          setIssues(d.issues ?? []);
        }
      } finally {
        setLoadingIssues(false);
      }
    })();
  // Intentionally empty deps — restore only on mount using the values read
  // directly from localStorage (not the React state, which may not be ready).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleBoardChange(boardId: string | null) {
    if (!boardId) return;
    setSelectedBoardId(boardId);
    setSelectedSprintId("");
    setIssues([]);
    setStatusFilter("all");
    setSelectedQuickFilter("none");
    setQuickFilters([]);
    setSearchQuery("");
    setLoadingSprints(true);

    try {
      const [sprintsRes, configRes] = await Promise.all([
        fetch(`/api/jira/sprints?boardId=${boardId}`),
        fetch(`/api/jira/board-config?boardId=${boardId}`),
      ]);

      const sprintsData = await sprintsRes.json();
      if (!sprintsRes.ok) throw new Error(sprintsData.error);
      setSprints(sprintsData.sprints ?? []);

      if (configRes.ok) {
        const configData = await configRes.json();
        setQuickFilters(configData.quickFilters ?? []);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load sprints");
    } finally {
      setLoadingSprints(false);
    }
  }

  async function handleSprintChange(sprintId: string | null) {
    if (!sprintId) return;
    setSelectedSprintId(sprintId);
    setStatusFilter("all");
    setSelectedQuickFilter("none");
    setSearchQuery("");
    setLoadingIssues(true);
    try {
      const url =
        sprintId === "backlog"
          ? `/api/jira/issues?backlog=true&boardId=${selectedBoardId}`
          : `/api/jira/issues?sprintId=${sprintId}&boardId=${selectedBoardId}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIssues(data.issues ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load issues");
    } finally {
      setLoadingIssues(false);
    }
  }

  const pointedKeySet = new Set(pointedIssues.map((p) => p.key));

  const statusOptions = Array.from(
    new Set(issues.map((i) => i.fields.status.name))
  ).sort();

  const filteredIssues = issues.filter((issue) => {
    if (statusFilter !== "all" && issue.fields.status.name !== statusFilter) {
      return false;
    }

    const hasPoints =
      issue.fields[storyPointsField] != null ||
      pointedKeySet.has(issue.key);

    if (pointFilter === "unpointed" && hasPoints) return false;
    if (pointFilter === "pointed" && !hasPoints) return false;

    if (selectedQuickFilter !== "none") {
      const qf = quickFilters.find((f) => String(f.id) === selectedQuickFilter);
      if (qf && !matchesQuickFilter(issue, qf.query)) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchesKey = issue.key.toLowerCase().includes(q);
      const matchesSummary = issue.fields.summary.toLowerCase().includes(q);
      if (!matchesKey && !matchesSummary) return false;
    }

    return true;
  });

  function getSessionPoints(key: string): number | null {
    return pointedIssues.find((p) => p.key === key)?.points ?? null;
  }

  // Base UI's Select.Value renders the raw value, so every dropdown needs an
  // explicit formatter or the trigger shows an id / lowercase filter key.
  const boardName = (id: string) =>
    boards.find((b) => String(b.id) === id)?.name ??
    (loadingBoards ? "Loading…" : "Select board");

  const sprintName = (id: string) => {
    if (id === "backlog") return "Backlog";
    const s = sprints.find((x) => String(x.id) === id);
    if (s) return `${s.name} (${s.state})`;
    return loadingSprints ? "Loading…" : "Select sprint";
  };

  const statusFilterName = (value: string) =>
    value === "all" || !value ? "All statuses" : value;

  const pointFilterName = (value: string) => {
    if (value === "unpointed") return "Unpointed";
    if (value === "pointed") return "Pointed";
    return "All";
  };

  const quickFilterName = (id: string) =>
    quickFilters.find((qf) => String(qf.id) === id)?.name ?? "No quick filter";

  const noIssuesMessage = () => {
    if (!selectedSprintId) return null;
    if (loadingIssues) return null;
    if (filteredIssues.length > 0) return null;
    if (issues.length === 0) return "No issues in this sprint.";
    return "No issues match the current filters.";
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Board / sprint selectors */}
      <div className="space-y-2 p-2 border-b border-border shrink-0">
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Board</p>
          <Select
            value={selectedBoardId}
            onValueChange={handleBoardChange}
            disabled={loadingBoards}
          >
            <SelectTrigger className="h-7 text-xs bg-card border-border w-full" aria-label="Board">
              <SelectValue
                placeholder={loadingBoards ? "Loading…" : "Select board"}
              >
                {(v: string) => boardName(v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {boards.map((board) => (
                <SelectItem
                  key={board.id}
                  value={String(board.id)}
                  className="text-xs"
                >
                  {board.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedBoardId && (
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sprint</p>
            <Select
              value={selectedSprintId}
              onValueChange={handleSprintChange}
              disabled={loadingSprints}
            >
              <SelectTrigger className="h-7 text-xs bg-card border-border w-full" aria-label="Sprint">
                <SelectValue
                  placeholder={loadingSprints ? "Loading…" : "Select sprint"}
                >
                  {(v: string) => sprintName(v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {sprints.map((sprint) => (
                  <SelectItem
                    key={sprint.id}
                    value={String(sprint.id)}
                    className="text-xs"
                  >
                    {sprint.name}{" "}
                    <span className="text-muted-foreground">({sprint.state})</span>
                  </SelectItem>
                ))}
                <SelectItem value="backlog" className="text-xs">
                  Backlog
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Filters */}
      {selectedSprintId && !loadingIssues && issues.length > 0 && (
        <div className="space-y-2 px-2 py-2 border-b border-border shrink-0">
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Status</p>
            <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
              <SelectTrigger className="h-7 text-xs bg-card border-border w-full" aria-label="Status filter">
                <SelectValue placeholder="All statuses">
                  {(v: string) => statusFilterName(v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="all" className="text-xs">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Points</p>
            <Select
              value={pointFilter}
              onValueChange={(v) => setPointFilter(v as PointFilter)}
            >
              <SelectTrigger className="h-7 text-xs bg-card border-border w-full" aria-label="Points filter">
                <SelectValue>{(v: string) => pointFilterName(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="all" className="text-xs">All</SelectItem>
                <SelectItem value="unpointed" className="text-xs">Unpointed</SelectItem>
                <SelectItem value="pointed" className="text-xs">Pointed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {quickFilters.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Quick Filter</p>
              <Select
                value={selectedQuickFilter}
                onValueChange={(v) => v && setSelectedQuickFilter(v)}
              >
                <SelectTrigger className="h-7 text-xs bg-card border-border w-full" aria-label="Quick filter">
                  <SelectValue placeholder="No quick filter">
                    {(v: string) => quickFilterName(v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="none" className="text-xs">No quick filter</SelectItem>
                  {quickFilters.map((qf) => (
                    <SelectItem key={qf.id} value={String(qf.id)} className="text-xs">
                      {qf.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Search</p>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ticket # or summary…"
              className="h-7 text-xs bg-card border-border"
            />
          </div>
        </div>
      )}

      {/* Issue list */}
      <div className="flex-1 overflow-y-auto">
        {loadingIssues && (
          <p className="text-xs text-muted-foreground px-3 py-2">Loading issues…</p>
        )}

        {noIssuesMessage() && (
          <p className="text-xs text-muted-foreground px-3 py-2">{noIssuesMessage()}</p>
        )}

        {filteredIssues.map((issue) => {
          const isActive = issue.key === currentIssueKey;
          const sessionPts = getSessionPoints(issue.key);
          const hasPoints =
            issue.fields[storyPointsField] != null || sessionPts != null;
          const displayPoints =
            sessionPts ?? (issue.fields[storyPointsField] as number | null);
          const inPlan = planKeys?.has(issue.key) ?? false;

          return (
            <div key={issue.id} className="relative group/row">
              <button
                onClick={() => onSelectIssue(issue)}
                className={cn(
                  "w-full text-left px-3 py-2 transition-colors border-l-2 cursor-pointer",
                  "hover:bg-accent",
                  onAddToPlan ? "pr-9" : "",
                  isActive
                    ? "border-primary bg-primary/10"
                    : "border-transparent",
                  hasPoints && pointFilter !== "pointed"
                    ? "opacity-60 hover:opacity-100"
                    : ""
                )}
              >
                <div className="flex items-center justify-between gap-1.5 mb-0.5">
                  <span className="text-xs font-mono font-medium text-foreground truncate">
                    {issue.key}
                  </span>
                  {displayPoints != null && (
                    <span className="text-[10px] font-mono font-medium text-blue-800 bg-blue-100 dark:text-[#579DFF] dark:bg-[#1C2B41] px-1.5 py-0.5 rounded-sm shrink-0">
                      {displayPoints}pt
                    </span>
                  )}
                </div>
                <p className="text-xs line-clamp-2 text-muted-foreground leading-snug">
                  {issue.fields.summary}
                </p>
                <div className="mt-1">
                  <span
                    className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded-sm",
                      statusBadgeClasses(issue.fields.status.name)
                    )}
                  >
                    {issue.fields.status.name}
                  </span>
                </div>
              </button>

              {onAddToPlan && (
                <button
                  type="button"
                  onClick={() =>
                    inPlan
                      ? onRemoveFromPlan?.(issue)
                      : onAddToPlan(issue)
                  }
                  disabled={inPlan && !onRemoveFromPlan}
                  aria-label={
                    inPlan
                      ? `Remove ${issue.key} from sprint plan`
                      : `Add ${issue.key} to sprint plan`
                  }
                  title={inPlan ? "Remove from sprint plan" : "Add to sprint plan"}
                  className={cn(
                    "absolute top-1.5 right-1.5 h-5 w-5 rounded-sm text-xs leading-none",
                    "flex items-center justify-center transition-colors",
                    inPlan
                      ? "text-emerald-700 dark:text-[#4BCE97]" +
                        (onRemoveFromPlan
                          ? " hover:bg-accent hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                          : " cursor-default")
                      : "text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                  )}
                >
                  {inPlan ? "✓" : "+"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
