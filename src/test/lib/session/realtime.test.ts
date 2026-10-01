import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Minimal Supabase channel mock
// ---------------------------------------------------------------------------

type BroadcastHandler = (event: { payload: unknown }) => void;
type PresenceHandler = () => void;
type SubscribeCallback = (status: string) => Promise<void>;

interface ChannelMock {
  _broadcastHandlers: Record<string, BroadcastHandler>;
  _presenceHandlers: PresenceHandler[];
  _presenceState: Record<string, unknown[]>;
  presenceState: <T>() => Record<string, T[]>;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  track: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  // test helpers
  _simulateBroadcast: (event: string, payload: unknown) => void;
  _simulatePresenceSync: (state: Record<string, unknown[]>) => void;
  _subscribeCallback: SubscribeCallback | null;
}

function makeChannelMock(): ChannelMock {
  const mock: ChannelMock = {
    _broadcastHandlers: {},
    _presenceHandlers: [],
    _presenceState: {},
    _subscribeCallback: null,

    presenceState<T>() {
      return mock._presenceState as Record<string, T[]>;
    },

    on: vi.fn((type: string, opts: { event: string } | Record<string, unknown>, handler: BroadcastHandler | PresenceHandler) => {
      if (type === "broadcast" && "event" in opts) {
        mock._broadcastHandlers[opts.event as string] = handler as BroadcastHandler;
      } else if (type === "presence") {
        mock._presenceHandlers.push(handler as PresenceHandler);
      }
      return mock;
    }),

    subscribe: vi.fn((cb: SubscribeCallback) => {
      mock._subscribeCallback = cb;
      return mock;
    }),

    track: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),

    _simulateBroadcast(event: string, payload: unknown) {
      mock._broadcastHandlers[event]?.({ payload });
    },

    _simulatePresenceSync(state: Record<string, unknown[]>) {
      mock._presenceState = state;
      for (const h of mock._presenceHandlers) h();
    },
  };
  return mock;
}

let channelMock: ChannelMock;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => channelMock,
    removeChannel: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ---------------------------------------------------------------------------
// Import after mock setup
// ---------------------------------------------------------------------------

import type { UseSessionChannelOptions } from "@/lib/session/realtime";

const { useSessionChannel } = await import("@/lib/session/realtime");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_OPTS = {
  code: "ROOM1",
  userId: "user-1",
  displayName: "Alice",
  isFacilitator: false,
  facilitatorId: "host-1",
  onReveal: vi.fn(),
  onClear: vi.fn(),
};

function render(overrides: Partial<UseSessionChannelOptions> = {}) {
  return renderHook(() => useSessionChannel({ ...BASE_OPTS, ...overrides }));
}

async function subscribeChannel() {
  await act(async () => {
    await channelMock._subscribeCallback?.("SUBSCRIBED");
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessionChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelMock = makeChannelMock();
  });

  describe("presence — identity only", () => {
    it("calls channel.track exactly once on subscribe with no has_voted field", async () => {
      render();
      await subscribeChannel();

      expect(channelMock.track).toHaveBeenCalledTimes(1);
      const payload = channelMock.track.mock.calls[0][0];
      expect(payload).not.toHaveProperty("has_voted");
      expect(payload.user_id).toBe("user-1");
      expect(payload.display_name).toBe("Alice");
    });

    it("builds participant list from presence sync with has_voted defaulting to false", async () => {
      const { result } = render();
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "host-1": [{ user_id: "host-1", display_name: "Host", is_facilitator: true }],
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
        });
      });

      expect(result.current.participants).toHaveLength(2);
      expect(result.current.participants.every((p) => p.has_voted === false)).toBe(true);
    });
  });

  describe("markVoted", () => {
    it("sends a voted broadcast and marks the user as voted locally", async () => {
      const { result } = render();
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
        });
      });

      act(() => {
        result.current.markVoted();
      });

      expect(channelMock.send).toHaveBeenCalledWith(
        expect.objectContaining({ event: "voted", payload: { user_id: "user-1" } })
      );

      const alice = result.current.participants.find((p) => p.user_id === "user-1");
      expect(alice?.has_voted).toBe(true);
    });

    it("does not call channel.track when marking voted", async () => {
      const { result } = render();
      await subscribeChannel();
      const trackCallsBefore = channelMock.track.mock.calls.length;

      act(() => { result.current.markVoted(); });

      expect(channelMock.track.mock.calls.length).toBe(trackCallsBefore);
    });
  });

  describe("voted broadcast", () => {
    it("marks another participant as voted when voted broadcast arrives", async () => {
      const { result } = render();
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          "user-2": [{ user_id: "user-2", display_name: "Bob", is_facilitator: false }],
        });
      });

      act(() => {
        channelMock._simulateBroadcast("voted", { user_id: "user-2" });
      });

      const bob = result.current.participants.find((p) => p.user_id === "user-2");
      expect(bob?.has_voted).toBe(true);
      // Alice not affected
      const alice = result.current.participants.find((p) => p.user_id === "user-1");
      expect(alice?.has_voted).toBe(false);
    });
  });

  describe("clear broadcast", () => {
    it("resets all voted state and calls onClear", async () => {
      const onClear = vi.fn();
      const { result } = render({ onClear });
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          "user-2": [{ user_id: "user-2", display_name: "Bob", is_facilitator: false }],
        });
      });

      // Both users vote
      act(() => {
        channelMock._simulateBroadcast("voted", { user_id: "user-1" });
        channelMock._simulateBroadcast("voted", { user_id: "user-2" });
      });
      expect(result.current.participants.every((p) => p.has_voted)).toBe(true);

      // Clear round
      act(() => {
        channelMock._simulateBroadcast("clear", { next_issue_key: "round-2" });
      });

      expect(result.current.participants.every((p) => !p.has_voted)).toBe(true);
      expect(onClear).toHaveBeenCalledWith("round-2");
    });

    it("does not call channel.track when clearing", async () => {
      const { result } = render();
      await subscribeChannel();
      const trackCallsBefore = channelMock.track.mock.calls.length;

      act(() => {
        channelMock._simulateBroadcast("voted", { user_id: "user-1" });
        channelMock._simulateBroadcast("clear", { next_issue_key: "round-2" });
      });

      expect(channelMock.track.mock.calls.length).toBe(trackCallsBefore);
    });
  });

  describe("issue-select broadcast", () => {
    it("resets all voted state and calls onIssueSelect", async () => {
      const onIssueSelect = vi.fn();
      const { result } = render({ onIssueSelect });
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
        });
      });

      act(() => {
        channelMock._simulateBroadcast("voted", { user_id: "user-1" });
      });
      expect(result.current.participants[0].has_voted).toBe(true);

      act(() => {
        channelMock._simulateBroadcast("issue-select", {
          issue_key: "PROJ-2",
          issue: null,
          jira_base_url: null,
          ac_field: null,
        });
      });

      expect(result.current.participants[0].has_voted).toBe(false);
      expect(onIssueSelect).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: "PROJ-2" })
      );
    });
  });

  describe("host-left detection", () => {
    it("fires onHostLeft when host disappears from presence", async () => {
      vi.useFakeTimers();
      const onHostLeft = vi.fn();
      try {
        render({ onHostLeft });
        await subscribeChannel();

        // Host present first
        act(() => {
          channelMock._simulatePresenceSync({
            "host-1": [{ user_id: "host-1", display_name: "Host", is_facilitator: true }],
            "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          });
        });

        // Host leaves
        act(() => {
          channelMock._simulatePresenceSync({
            "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          });
        });

        // Advance past the 8-second grace period
        await act(async () => {
          await vi.advanceTimersByTimeAsync(8100);
        });

        expect(onHostLeft).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not fire onHostLeft immediately when host disappears (within grace period)", async () => {
      vi.useFakeTimers();
      const onHostLeft = vi.fn();
      try {
        render({ onHostLeft });
        await subscribeChannel();

        // Host present first
        act(() => {
          channelMock._simulatePresenceSync({
            "host-1": [{ user_id: "host-1", display_name: "Host", is_facilitator: true }],
            "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          });
        });

        // Host leaves
        act(() => {
          channelMock._simulatePresenceSync({
            "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          });
        });

        // Advance only 4 seconds — still within the grace period
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4000);
        });

        expect(onHostLeft).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancels onHostLeft timer when host returns within grace period", async () => {
      vi.useFakeTimers();
      const onHostLeft = vi.fn();
      try {
        render({ onHostLeft });
        await subscribeChannel();

        // Host present first
        act(() => {
          channelMock._simulatePresenceSync({
            "host-1": [{ user_id: "host-1", display_name: "Host", is_facilitator: true }],
            "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          });
        });

        // Host leaves — timer starts
        act(() => {
          channelMock._simulatePresenceSync({
            "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          });
        });

        // Advance 3 seconds — still within grace period
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });

        // Host returns within grace period — timer should be cancelled
        act(() => {
          channelMock._simulatePresenceSync({
            "host-1": [{ user_id: "host-1", display_name: "Host", is_facilitator: true }],
            "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          });
        });

        // Advance another 8 seconds — past where the original timer would have fired
        await act(async () => {
          await vi.advanceTimersByTimeAsync(8000);
        });

        expect(onHostLeft).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not fire onHostLeft on first sync even if host is absent", async () => {
      const onHostLeft = vi.fn();
      render({ onHostLeft });
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
        });
      });

      expect(onHostLeft).not.toHaveBeenCalled();
    });

    it("fires onHostLeft on session:ended broadcast", async () => {
      const onHostLeft = vi.fn();
      render({ onHostLeft });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("session:ended", {});
      });

      expect(onHostLeft).toHaveBeenCalledTimes(1);
    });

    it("does not fire onHostLeft for the facilitator on session:ended", async () => {
      const onHostLeft = vi.fn();
      render({ isFacilitator: true, onHostLeft });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("session:ended", {});
      });

      expect(onHostLeft).not.toHaveBeenCalled();
    });
  });

  describe("kick broadcast", () => {
    it("removes the kicked user from participants on all clients", async () => {
      const { result } = render();
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          "user-2": [{ user_id: "user-2", display_name: "Bob", is_facilitator: false }],
        });
      });

      act(() => {
        channelMock._simulateBroadcast("kick", { user_id: "user-2" });
      });

      expect(result.current.participants.find((p) => p.user_id === "user-2")).toBeUndefined();
      expect(result.current.participants.find((p) => p.user_id === "user-1")).toBeDefined();
    });

    it("clears voted state for the kicked user", async () => {
      const { result } = render();
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          "user-2": [{ user_id: "user-2", display_name: "Bob", is_facilitator: false }],
        });
      });

      act(() => {
        channelMock._simulateBroadcast("voted", { user_id: "user-2" });
      });
      expect(result.current.participants.find((p) => p.user_id === "user-2")?.has_voted).toBe(true);

      act(() => {
        channelMock._simulateBroadcast("kick", { user_id: "user-2" });
      });

      // user-2 removed entirely; vote count no longer includes them
      expect(result.current.participants.find((p) => p.user_id === "user-2")).toBeUndefined();
    });

    it("fires onKicked when the current user is kicked", async () => {
      const onKicked = vi.fn();
      render({ onKicked });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("kick", { user_id: "user-1" });
      });

      expect(onKicked).toHaveBeenCalledTimes(1);
    });

    it("does not fire onKicked when a different user is kicked", async () => {
      const onKicked = vi.fn();
      render({ onKicked });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("kick", { user_id: "user-2" });
      });

      expect(onKicked).not.toHaveBeenCalled();
    });
  });

  describe("markVoted with no channel", () => {
    it("does nothing when channel is not yet set (no error thrown)", () => {
      // Render without subscribing — channelRef.current stays null
      const { result } = render();
      // Should not throw even though channel isn't subscribed yet
      expect(() => {
        act(() => {
          result.current.markVoted();
        });
      }).not.toThrow();
    });
  });

  describe("subscribe callback with non-SUBSCRIBED status", () => {
    it("does not call channel.track when status is not SUBSCRIBED", async () => {
      render();
      // Fire callback with a different status
      await act(async () => {
        await channelMock._subscribeCallback?.("CHANNEL_ERROR");
      });
      expect(channelMock.track).not.toHaveBeenCalled();
    });
  });

  describe("reveal broadcast", () => {
    it("calls onReveal with the payload when reveal broadcast arrives", async () => {
      const onReveal = vi.fn();
      render({ onReveal });
      await subscribeChannel();

      const revealPayload = {
        tally: { 3: 2, 5: 1 },
        average: 3.67,
        votes: [
          { user_id: "user-1", value: 3 },
          { user_id: "user-2", value: 5 },
        ],
      };

      act(() => {
        channelMock._simulateBroadcast("reveal", revealPayload);
      });

      expect(onReveal).toHaveBeenCalledTimes(1);
      expect(onReveal).toHaveBeenCalledWith(revealPayload);
    });
  });

  describe("locked broadcast", () => {
    it("calls onLocked with the payload when locked broadcast arrives", async () => {
      const onLocked = vi.fn();
      render({ onLocked });
      await subscribeChannel();

      const lockedPayload = {
        tally: { 3: 2 },
        average: 3,
        votes: [
          { user_id: "user-1", value: 3 },
          { user_id: "user-2", value: 3 },
        ],
      };

      act(() => {
        channelMock._simulateBroadcast("locked", lockedPayload);
      });

      expect(onLocked).toHaveBeenCalledTimes(1);
      expect(onLocked).toHaveBeenCalledWith(lockedPayload);
    });

    it("does not throw when onLocked is not provided", async () => {
      render({ onLocked: undefined });
      await subscribeChannel();

      expect(() => {
        act(() => {
          channelMock._simulateBroadcast("locked", { tally: {}, average: 0, votes: [] });
        });
      }).not.toThrow();
    });
  });

  describe("points:submitted broadcast", () => {
    it("calls onPointsSubmitted with the payload when points:submitted broadcast arrives", async () => {
      const onPointsSubmitted = vi.fn();
      render({ onPointsSubmitted });
      await subscribeChannel();

      const payload = { issue_key: "PROJ-1", points: 5 };

      act(() => {
        channelMock._simulateBroadcast("points:submitted", payload);
      });

      expect(onPointsSubmitted).toHaveBeenCalledTimes(1);
      expect(onPointsSubmitted).toHaveBeenCalledWith(payload);
    });
  });

  describe("issue:updated broadcast", () => {
    it("calls onIssueUpdated with mapped payload when issue is null", async () => {
      const onIssueUpdated = vi.fn();
      render({ onIssueUpdated });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("issue:updated", { issue_key: "PROJ-1", issue: null });
      });

      expect(onIssueUpdated).toHaveBeenCalledTimes(1);
      expect(onIssueUpdated).toHaveBeenCalledWith({ issueKey: "PROJ-1", issue: null });
    });

    it("calls onIssueUpdated with the issue object when issue is non-null", async () => {
      const onIssueUpdated = vi.fn();
      render({ onIssueUpdated });
      await subscribeChannel();

      const issue = { key: "PROJ-1", summary: "Test issue", description: null };

      act(() => {
        channelMock._simulateBroadcast("issue:updated", { issue_key: "PROJ-1", issue });
      });

      expect(onIssueUpdated).toHaveBeenCalledTimes(1);
      expect(onIssueUpdated).toHaveBeenCalledWith({ issueKey: "PROJ-1", issue });
    });
  });

  describe("sprint plan broadcasts", () => {
    const planPayload = {
      items: [{ issue_key: "PROJ-1", summary: "First", points: 3, position: 0 }],
      capacity_points: 40,
      total_points: 3,
      unpointed_count: 0,
    };

    it("calls onPlanUpdated with the broadcast plan state", async () => {
      const onPlanUpdated = vi.fn();
      render({ onPlanUpdated });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("plan:updated", planPayload);
      });

      expect(onPlanUpdated).toHaveBeenCalledTimes(1);
      expect(onPlanUpdated).toHaveBeenCalledWith(planPayload);
    });

    it("calls onPlanCommitted with the sprint result", async () => {
      const onPlanCommitted = vi.fn();
      render({ onPlanCommitted });
      await subscribeChannel();

      const committed = {
        sprint_id: 9,
        sprint_name: "Sprint 42",
        moved: ["PROJ-1"],
        failed: [],
        plan: { ...planPayload, items: [], total_points: 0 },
      };

      act(() => {
        channelMock._simulateBroadcast("plan:committed", committed);
      });

      expect(onPlanCommitted).toHaveBeenCalledWith(committed);
    });

    it("does not throw when no plan callbacks are supplied", async () => {      render();
      await subscribeChannel();

      expect(() =>
        act(() => {
          channelMock._simulateBroadcast("plan:updated", planPayload);
          channelMock._simulateBroadcast("plan:committed", {
            sprint_id: 1,
            sprint_name: "S",
            moved: [],
            failed: [],
            plan: planPayload,
          });
        })
      ).not.toThrow();
    });
  });

  describe("plan:visibility broadcast", () => {
    it("fires onPlanVisibility for a guest when the host opens the sheet", async () => {
      const onPlanVisibility = vi.fn();
      render({ onPlanVisibility });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("plan:visibility", { open: true });
      });

      expect(onPlanVisibility).toHaveBeenCalledWith(true);
    });

    it("fires onPlanVisibility with false when the host closes the sheet", async () => {
      const onPlanVisibility = vi.fn();
      render({ onPlanVisibility });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("plan:visibility", { open: false });
      });

      expect(onPlanVisibility).toHaveBeenCalledWith(false);
    });

    it("ignores plan:visibility on the facilitator's own client", async () => {
      const onPlanVisibility = vi.fn();
      render({ isFacilitator: true, onPlanVisibility });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("plan:visibility", { open: true });
      });

      expect(onPlanVisibility).not.toHaveBeenCalled();
    });

    it("broadcastPlanVisibility sends the open state on the channel", async () => {
      const { result } = render({ isFacilitator: true });
      await subscribeChannel();

      act(() => {
        result.current.broadcastPlanVisibility(true);
      });

      expect(channelMock.send).toHaveBeenCalledWith(
        expect.objectContaining({ event: "plan:visibility", payload: { open: true } })
      );
    });

    it("broadcastPlanVisibility is a no-op with no channel", () => {
      const { result, unmount } = render({ isFacilitator: true });
      unmount();
      expect(() => result.current.broadcastPlanVisibility(true)).not.toThrow();
    });
  });

  describe("nudge broadcast", () => {
    it("fires onNudged when the current user is nudged", async () => {
      const onNudged = vi.fn();
      render({ onNudged });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("nudge", { user_id: "user-1" });
      });

      expect(onNudged).toHaveBeenCalledTimes(1);
    });

    it("does not fire onNudged when a different user is nudged", async () => {
      const onNudged = vi.fn();
      render({ onNudged });
      await subscribeChannel();

      act(() => {
        channelMock._simulateBroadcast("nudge", { user_id: "user-2" });
      });

      expect(onNudged).not.toHaveBeenCalled();
    });

    it("does not affect participant list when nudge arrives", async () => {
      const { result } = render();
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          "user-2": [{ user_id: "user-2", display_name: "Bob", is_facilitator: false }],
        });
      });

      act(() => {
        channelMock._simulateBroadcast("nudge", { user_id: "user-1" });
      });

      expect(result.current.participants).toHaveLength(2);
      expect(result.current.participants.find((p) => p.user_id === "user-1")).toBeDefined();
    });
  });

  describe("hydrateVotedIds", () => {
    it("replaces voted state with provided user IDs", async () => {
      const { result } = render();
      await subscribeChannel();

      act(() => {
        channelMock._simulatePresenceSync({
          "user-1": [{ user_id: "user-1", display_name: "Alice", is_facilitator: false }],
          "user-2": [{ user_id: "user-2", display_name: "Bob", is_facilitator: false }],
        });
      });

      act(() => {
        result.current.hydrateVotedIds(["user-1", "user-2"]);
      });

      const alice = result.current.participants.find((p) => p.user_id === "user-1");
      const bob = result.current.participants.find((p) => p.user_id === "user-2");
      expect(alice?.has_voted).toBe(true);
      expect(bob?.has_voted).toBe(true);
    });
  });
});
