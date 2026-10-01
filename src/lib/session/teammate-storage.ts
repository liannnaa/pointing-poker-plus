"use client";

import type { SprintTeammate } from "@/lib/session/plan";

/**
 * The host's sprint roster, persisted across sessions in localStorage — the
 * same zero-friction pattern as `pp_display_name`. The session's DB roster is
 * still the source of truth for guests; this is only the host's seed for the
 * next room they create.
 */
export const TEAMMATES_STORAGE_KEY = "pp_sprint_teammates";

/** A roster entry as stored locally — no session-scoped fields. */
export type StoredTeammate = {
  account_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  capacity_points: number | null;
};

function isStoredTeammate(value: unknown): value is StoredTeammate {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.account_id === "string" && typeof v.display_name === "string";
}

/**
 * Read the stored roster. Returns `[]` for anything unreadable — localStorage
 * throws in some privacy modes, and the stored JSON is user-editable.
 */
export function loadStoredTeammates(): StoredTeammate[] {
  try {
    const raw = localStorage.getItem(TEAMMATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredTeammate).map((t) => ({
      account_id: t.account_id,
      display_name: t.display_name,
      email: t.email ?? null,
      avatar_url: t.avatar_url ?? null,
      capacity_points: typeof t.capacity_points === "number" ? t.capacity_points : null,
    }));
  } catch {
    return [];
  }
}

/** Persist the roster. Silently ignores storage failures — it's a convenience. */
export function saveStoredTeammates(teammates: SprintTeammate[]): void {
  try {
    const payload: StoredTeammate[] = teammates.map((t) => ({
      account_id: t.account_id,
      display_name: t.display_name,
      email: t.email,
      avatar_url: t.avatar_url,
      capacity_points: t.capacity_points,
    }));
    localStorage.setItem(TEAMMATES_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Non-fatal.
  }
}
