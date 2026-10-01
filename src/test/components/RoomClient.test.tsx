import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { RoomClient } from "@/app/session/[code]/RoomClient";

// ── Next.js router ────────────────────────────────────────────────────────────
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ── Auth provider ─────────────────────────────────────────────────────────────
vi.mock("@/components/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "fac-1" },
    loading: false,
  }),
}));

// ── Realtime hook ─────────────────────────────────────────────────────────────
vi.mock("@/lib/session/realtime", () => ({
  useSessionChannel: () => ({
    participants: [],
    markVoted: vi.fn(),
    hydrateVotedIds: vi.fn(),
    broadcastPlanVisibility: vi.fn(),
  }),
}));

// ── Sonner toast ──────────────────────────────────────────────────────────────
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

// ── Minimal session fixture ───────────────────────────────────────────────────
const baseSession = {
  id: "sess-1",
  code: "ABCD",
  facilitator_id: "fac-1",
  state: "voting",
  current_issue_key: null,
  created_at: new Date().toISOString(),
} as Parameters<typeof RoomClient>[0]["session"];

// The host now goes through the same JoinDialog guests use (pre-filled from
// localStorage), so tests must submit it before the room UI is available.
async function renderAndJoinAsHost() {
  render(<RoomClient session={baseSession} />);
  fireEvent.click(screen.getByRole("button", { name: /start/i }));
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /^start$/i })).not.toBeInTheDocument();
  });
}

describe("RoomClient – End Session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all API calls succeed
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    // Suppress localStorage access in test env
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue("Host");
  });

  it("redirects host to '/' after a successful End Session", async () => {
    await renderAndJoinAsHost();

    fireEvent.click(screen.getByRole("button", { name: /end session/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/sessions/${baseSession.code}/end`,
        expect.objectContaining({ method: "POST" })
      );
      expect(mockPush).toHaveBeenCalledWith("/");
    });
  });

  it("does not redirect when the End Session request fails", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/sessions/${baseSession.code}/join`) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: "Server error" }) });
    });

    await renderAndJoinAsHost();

    fireEvent.click(screen.getByRole("button", { name: /end session/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Server error");
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("RoomClient – Jira header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue("Host");
  });

  it("shows 'Disconnect Jira' button when Jira is connected", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/jira/connect") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ connected: true, email: "host@example.com" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await renderAndJoinAsHost();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disconnect jira/i })).toBeInTheDocument();
    });
  });

  it("does not show the Jira email address in the header", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/jira/connect") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ connected: true, email: "host@example.com" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await renderAndJoinAsHost();

    await waitFor(() => {
      expect(screen.queryByText("host@example.com")).not.toBeInTheDocument();
    });
  });

  it("calls disconnect API and removes the button on success", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/jira/connect" && (!opts || opts.method !== "DELETE")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ connected: true, email: "host@example.com" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await renderAndJoinAsHost();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disconnect jira/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /disconnect jira/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/jira/connect",
        expect.objectContaining({ method: "DELETE" })
      );
      expect(screen.queryByRole("button", { name: /disconnect jira/i })).not.toBeInTheDocument();
    });
  });

  it("shows the Sprint Issues drawer trigger when Jira is connected", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/jira/connect") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            connected: true,
            email: "host@example.com",
            base_url: "https://jira.example.com",
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await renderAndJoinAsHost();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sprint issues/i })).toBeInTheDocument();
    });
  });
});
