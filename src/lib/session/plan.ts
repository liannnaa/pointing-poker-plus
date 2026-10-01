import type { SupabaseClient } from "@supabase/supabase-js";

/** A single ticket queued for the next sprint. */
export type SprintPlanItem = {
  issue_key: string;
  summary: string;
  points: number | null;
  position: number;
  /** Jira accountId of the teammate this ticket is assigned to, or null. */
  assignee_account_id: string | null;
  /**
   * `sprint` — the ticket is already in the destination sprint, pulled from
   * Jira when the destination was selected. `added` — the host queued it during
   * the session. Changing destination drops `sprint` items and keeps `added`.
   */
  origin: PlanItemOrigin;
  /**
   * A sprint-origin ticket the host has staged for removal. Kept in the table
   * (so the removal is undoable and commit knows which keys to push back to the
   * backlog) but excluded from `items` and the totals.
   */
  removed: boolean;
};

export type PlanItemOrigin = "added" | "sprint";

/** The sprint the plan is destined for, when the host has chosen an existing one. */
export type PlanDestination = {
  board_id: number | null;
  sprint_id: number | null;
  sprint_name: string | null;
};

/** A person on the host's roster for the next sprint (a real Jira user). */
export type SprintTeammate = {
  account_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  /** Individual point target. Null = no per-person target set. */
  capacity_points: number | null;
  position: number;
};

/**
 * A Jira assignee found on a ticket the host just added to the plan who isn't
 * on the roster yet.
 *
 * Returned by `POST /plan` *alongside* the plan state (never broadcast): the
 * roster is the host's deliberate team, so we surface a one-click offer rather
 * than silently adding a stranger — and the commit route would otherwise push
 * an accountId the host never chose back to Jira.
 */
export type SuggestedTeammate = {
  issue_key: string;
  account_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
};

/** Per-person workload, derived client-side from the full plan state. */export type TeammateTotals = {
  assigned_points: number;
  assigned_count: number;
  unpointed_count: number;
};

/** The full, broadcast-shaped sprint plan for a session. */
export type SprintPlanState = {
  items: SprintPlanItem[];
  teammates: SprintTeammate[];
  capacity_points: number | null;
  total_points: number;
  unpointed_count: number;
  /** Where the plan is headed. Null board *and* sprint = nothing chosen yet. */
  destination: PlanDestination;
  /** Sprint-origin tickets staged to be pushed back to the backlog on commit. */
  pending_removals: SprintPlanItem[];
};

/**
 * Sum the plan's points. Tickets with no story points in Jira contribute 0 but
 * are counted separately so the UI can warn that the total is an undercount.
 */
export function computePlanTotals(items: SprintPlanItem[]): {
  total_points: number;
  unpointed_count: number;
} {
  let total = 0;
  let unpointed = 0;

  for (const item of items) {
    if (typeof item.points === "number") {
      total += item.points;
    } else {
      unpointed += 1;
    }
  }

  return { total_points: total, unpointed_count: unpointed };
}

/**
 * Sum the roster's per-person capacities into a suggested team capacity.
 *
 * Returns null when nobody has a per-person target set — there is nothing to
 * suggest in that case, and 0 would be a misleading suggestion. Teammates
 * without a target contribute nothing, so a partially-filled roster still gives
 * the host a (deliberately conservative) floor.
 */
export function computeRosterCapacity(teammates: SprintTeammate[]): number | null {
  let total = 0;
  let any = false;

  for (const t of teammates) {
    if (typeof t.capacity_points === "number") {
      total += t.capacity_points;
      any = true;
    }
  }

  return any ? total : null;
}

/** How a total sits against a capacity target. */
export type CapacityState = "none" | "under" | "at" | "over";

/**
 * Accent colours for assignee groups in the plan list.
 *
 * The bar carries the same signal as the group's points badge — blue while
 * there's room, green at target, red over — so the left edge of every card
 * answers "who is overloaded?" without reading a single number. Alternating
 * decorative hues were dropped: a colour that means nothing invites readers to
 * decode it.
 */
const CAPACITY_ACCENTS: Record<CapacityState, string> = {
  // No target set (and the unassigned bucket): nothing to be over or under.
  none: "border-l-muted-foreground/40",
  under: "border-l-blue-500 dark:border-l-[#579DFF]",
  at: "border-l-emerald-500 dark:border-l-[#4BCE97]",
  over: "border-l-red-500 dark:border-l-[#F87168]",
};

/** Pick the left-accent class for a group in the given capacity state. */
export function capacityAccent(state: CapacityState): string {
  return CAPACITY_ACCENTS[state];
}

/**
 * Bucket the plan's tickets by assignee.
 *
 * Derived on the client from full broadcast state rather than sent over the
 * wire, so it can never drift from `items`. Tickets whose assignee is no longer
 * on the roster fall into the unassigned bucket — removing a teammate must
 * never hide their tickets.
 */
export function computeTeammateTotals(
  items: SprintPlanItem[],
  teammates: SprintTeammate[]
): { byAccountId: Record<string, TeammateTotals>; unassigned: TeammateTotals } {
  const known = new Set(teammates.map((t) => t.account_id));
  const empty = (): TeammateTotals => ({
    assigned_points: 0,
    assigned_count: 0,
    unpointed_count: 0,
  });

  const byAccountId: Record<string, TeammateTotals> = {};
  for (const t of teammates) byAccountId[t.account_id] = empty();
  const unassigned = empty();

  for (const item of items) {
    const id = item.assignee_account_id;
    const bucket = id !== null && known.has(id) ? byAccountId[id] : unassigned;

    bucket.assigned_count += 1;
    if (typeof item.points === "number") {
      bucket.assigned_points += item.points;
    } else {
      bucket.unpointed_count += 1;
    }
  }

  return { byAccountId, unassigned };
}

/** The session fields the plan state is derived from. */
export type PlanSessionContext = {
  id: string;
  capacity_points: number | null;
  target_board_id: number | null;
  target_sprint_id: number | null;
  target_sprint_name: string | null;
};

/** Load the plan rows for a session and derive the broadcast payload. */
export async function loadPlanState(
  // The generated Supabase types are regenerated per-migration; the routes pass
  // either the request-scoped or the service-role client here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  session: PlanSessionContext
): Promise<SprintPlanState> {
  const sessionId = session.id;

  const [itemsRes, teammatesRes] = await Promise.all([
    client
      .from("sprint_plan_items")
      .select("issue_key, summary, points, position, assignee_account_id, origin, removed")
      .eq("session_id", sessionId)
      .order("position", { ascending: true }),
    client
      .from("sprint_teammates")
      .select("account_id, display_name, email, avatar_url, capacity_points, position")
      .eq("session_id", sessionId)
      .order("position", { ascending: true }),
  ]);

  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (teammatesRes.error) throw new Error(teammatesRes.error.message);

  const allItems: SprintPlanItem[] = (itemsRes.data ?? []).map((row) => ({
    issue_key: row.issue_key as string,
    summary: row.summary as string,
    points: row.points === null || row.points === undefined ? null : Number(row.points),
    position: Number(row.position ?? 0),
    assignee_account_id: (row.assignee_account_id as string | null) ?? null,
    origin: (row.origin as PlanItemOrigin | null) ?? "added",
    removed: row.removed === true,
  }));

  // Staged removals are split out here so every downstream consumer — totals,
  // grouping, commit — sees only live tickets in `items` by construction.
  const items = allItems.filter((i) => !i.removed);
  const pending_removals = allItems.filter((i) => i.removed);

  const teammates: SprintTeammate[] = (teammatesRes.data ?? []).map((row) => ({
    account_id: row.account_id as string,
    display_name: row.display_name as string,
    email: (row.email as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    capacity_points:
      row.capacity_points === null || row.capacity_points === undefined
        ? null
        : Number(row.capacity_points),
    position: Number(row.position ?? 0),
  }));

  return {
    items,
    teammates,
    capacity_points: session.capacity_points,
    destination: {
      board_id: session.target_board_id ?? null,
      sprint_id: session.target_sprint_id ?? null,
      sprint_name: session.target_sprint_name ?? null,
    },
    pending_removals,
    ...computePlanTotals(items),
  };
}

/**
 * Push the whole plan to every client in the room. Sending full state (rather
 * than a delta) keeps clients convergent with no merge logic.
 */
export async function broadcastPlanUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClient: SupabaseClient<any, any, any>,
  code: string,
  state: SprintPlanState
): Promise<void> {
  const channel = serviceClient.channel(`room:${code.toUpperCase()}`);
  await channel.send({
    type: "broadcast",
    event: "plan:updated",
    payload: state,
  });
  await serviceClient.removeChannel(channel);
}

export type PlanSessionRow = {
  id: string;
  facilitator_id: string;
  capacity_points: number | null;
  target_board_id: number | null;
  target_sprint_id: number | null;
  target_sprint_name: string | null;
};

/** The columns every plan route needs off `sessions`. */
export const PLAN_SESSION_COLUMNS =
  "id, facilitator_id, capacity_points, target_board_id, target_sprint_id, target_sprint_name";

/**
 * Shared auth + facilitator guard for the sprint-plan mutation routes.
 * Returns either a ready-to-send error `response` or the session `row`.
 */
export async function requireFacilitatorSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  code: string
): Promise<
  | { response: { error: string; status: number }; row?: undefined; userId?: undefined }
  | { response?: undefined; row: PlanSessionRow; userId: string }
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: { error: "Not authenticated", status: 401 } };
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .select(PLAN_SESSION_COLUMNS)
    .eq("code", code.toUpperCase())
    .single();

  if (error || !session) {
    return { response: { error: "Session not found", status: 404 } };
  }

  const row = session as PlanSessionRow;

  if (row.facilitator_id !== user.id) {
    return {
      response: {
        error: "Only the facilitator can change the sprint plan",
        status: 403,
      },
    };
  }

  return { row, userId: user.id };
}
