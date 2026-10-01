import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  TEAMMATES_STORAGE_KEY,
  loadStoredTeammates,
  saveStoredTeammates,
} from "@/lib/session/teammate-storage";
import type { SprintTeammate } from "@/lib/session/plan";

const teammate: SprintTeammate = {
  account_id: "acc-1",
  display_name: "Alice",
  email: "alice@example.com",
  avatar_url: "http://x/a.png",
  capacity_points: 13,
  position: 0,
};

describe("teammate-storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty roster when nothing is stored", () => {
    expect(loadStoredTeammates()).toEqual([]);
  });

  it("round-trips a saved roster without session-scoped fields", () => {
    saveStoredTeammates([teammate]);
    expect(loadStoredTeammates()).toEqual([
      {
        account_id: "acc-1",
        display_name: "Alice",
        email: "alice@example.com",
        avatar_url: "http://x/a.png",
        capacity_points: 13,
      },
    ]);
  });

  it("normalises missing optional fields to null", () => {
    localStorage.setItem(
      TEAMMATES_STORAGE_KEY,
      JSON.stringify([{ account_id: "acc-2", display_name: "Bob" }])
    );
    expect(loadStoredTeammates()).toEqual([
      {
        account_id: "acc-2",
        display_name: "Bob",
        email: null,
        avatar_url: null,
        capacity_points: null,
      },
    ]);
  });

  it("drops malformed entries rather than failing the whole read", () => {
    localStorage.setItem(
      TEAMMATES_STORAGE_KEY,
      JSON.stringify([{ account_id: "acc-1", display_name: "Alice" }, { nope: true }, null, 7])
    );
    expect(loadStoredTeammates()).toHaveLength(1);
  });

  it("returns an empty roster for invalid JSON", () => {
    localStorage.setItem(TEAMMATES_STORAGE_KEY, "{not json");
    expect(loadStoredTeammates()).toEqual([]);
  });

  it("returns an empty roster when the stored value is not an array", () => {
    localStorage.setItem(TEAMMATES_STORAGE_KEY, JSON.stringify({ account_id: "x" }));
    expect(loadStoredTeammates()).toEqual([]);
  });

  it("swallows localStorage read failures", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadStoredTeammates()).toEqual([]);
  });

  it("swallows localStorage write failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveStoredTeammates([teammate])).not.toThrow();
  });
});
