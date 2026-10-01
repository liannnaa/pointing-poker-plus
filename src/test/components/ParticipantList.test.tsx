import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ParticipantList } from "@/components/room/ParticipantList";
import type { Participant } from "@/lib/session/realtime";

describe("ParticipantList", () => {
  it("renders all participant names", () => {
    const participants: Participant[] = [
      { user_id: "u1", display_name: "Alice", has_voted: false },
      { user_id: "u2", display_name: "Bob", has_voted: false },
    ];
    render(<ParticipantList participants={participants} facilitatorId="fac" />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows correct vote tally (1/2 when one of two voters has voted)", () => {
    const participants: Participant[] = [
      { user_id: "u1", display_name: "Alice", has_voted: true },
      { user_id: "u2", display_name: "Bob", has_voted: false },
    ];
    render(<ParticipantList participants={participants} facilitatorId="fac" />);
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("labels facilitator as host and does not count them in tally", () => {
    const participants: Participant[] = [
      { user_id: "fac", display_name: "Facilitator", has_voted: false, is_facilitator: true },
      { user_id: "u1", display_name: "Alice", has_voted: true },
      { user_id: "u2", display_name: "Bob", has_voted: false },
    ];
    render(<ParticipantList participants={participants} facilitatorId="fac" />);
    // facilitator shows "host" label
    expect(screen.getByText("host")).toBeInTheDocument();
    // tally excludes facilitator: 1 voted out of 2 voters
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("shows green dot for a voted non-facilitator", () => {
    const participants: Participant[] = [
      { user_id: "u1", display_name: "Alice", has_voted: true },
    ];
    render(<ParticipantList participants={participants} facilitatorId="fac" />);
    const greenDot = document.querySelector('span.bg-\\[\\#4BCE97\\]');
    expect(greenDot).toBeInTheDocument();
  });

  it("shows grey dot for an unvoted non-facilitator", () => {
    const participants: Participant[] = [
      { user_id: "u1", display_name: "Alice", has_voted: false },
    ];
    render(<ParticipantList participants={participants} facilitatorId="fac" />);
    const greyDot = document.querySelector('span.bg-border');
    expect(greyDot).toBeInTheDocument();
  });

  it("renders 0/0 tally for an empty list", () => {
    render(<ParticipantList participants={[]} facilitatorId="fac" />);
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("renders the avatar_emoji instead of initials when present", () => {
    const participants: Participant[] = [
      { user_id: "u1", display_name: "Alice", has_voted: false, avatar_emoji: "🐱" },
    ];
    render(<ParticipantList participants={participants} facilitatorId="fac" />);
    expect(screen.getByText("🐱")).toBeInTheDocument();
    expect(screen.queryByText("AL")).not.toBeInTheDocument();
  });

  it("falls back to initials when avatar_emoji is not set", () => {
    const participants: Participant[] = [
      { user_id: "u1", display_name: "Alice", has_voted: false },
    ];
    render(<ParticipantList participants={participants} facilitatorId="fac" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  describe("kick button", () => {
    const participants: Participant[] = [
      { user_id: "fac", display_name: "Host", has_voted: false, is_facilitator: true },
      { user_id: "u1", display_name: "Alice", has_voted: false },
      { user_id: "u2", display_name: "Bob", has_voted: true },
    ];

    it("shows kick buttons for non-host participants when viewer is host", () => {
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
          onKick={vi.fn()}
        />
      );
      expect(screen.getByTitle("Kick Alice")).toBeInTheDocument();
      expect(screen.getByTitle("Kick Bob")).toBeInTheDocument();
    });

    it("does not show a kick button for the host row", () => {
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
          onKick={vi.fn()}
        />
      );
      expect(screen.queryByTitle("Kick Host")).not.toBeInTheDocument();
    });

    it("calls onKick with the correct user_id when kick button is clicked", () => {
      const onKick = vi.fn();
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
          onKick={onKick}
        />
      );
      fireEvent.click(screen.getByTitle("Kick Alice"));
      expect(onKick).toHaveBeenCalledTimes(1);
      expect(onKick).toHaveBeenCalledWith("u1");
    });

    it("does not show kick buttons when viewer is not the host", () => {
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="u1"
          onKick={vi.fn()}
        />
      );
      expect(screen.queryByTitle("Kick Alice")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Kick Bob")).not.toBeInTheDocument();
    });

    it("does not show kick buttons when onKick is not provided", () => {
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
        />
      );
      expect(screen.queryByTitle("Kick Alice")).not.toBeInTheDocument();
    });
  });

  describe("nudge button", () => {
    const participants: Participant[] = [
      { user_id: "fac", display_name: "Host", has_voted: false, is_facilitator: true },
      { user_id: "u1", display_name: "Alice", has_voted: false },
      { user_id: "u2", display_name: "Bob", has_voted: true },
    ];

    it("shows nudge button for unvoted non-host participants when viewer is host", () => {
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
          onNudge={vi.fn()}
        />
      );
      expect(screen.getByTitle("Nudge Alice")).toBeInTheDocument();
    });

    it("does not show nudge button for a participant who has already voted", () => {
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
          onNudge={vi.fn()}
        />
      );
      expect(screen.queryByTitle("Nudge Bob")).not.toBeInTheDocument();
    });

    it("does not show a nudge button for the host row", () => {
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
          onNudge={vi.fn()}
        />
      );
      expect(screen.queryByTitle("Nudge Host")).not.toBeInTheDocument();
    });

    it("calls onNudge with the correct user_id when clicked", () => {
      const onNudge = vi.fn();
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
          onNudge={onNudge}
        />
      );
      fireEvent.click(screen.getByTitle("Nudge Alice"));
      expect(onNudge).toHaveBeenCalledTimes(1);
      expect(onNudge).toHaveBeenCalledWith("u1");
    });

    it("does not show nudge buttons when viewer is not the host", () => {
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="u1"
          onNudge={vi.fn()}
        />
      );
      expect(screen.queryByTitle("Nudge Alice")).not.toBeInTheDocument();
    });

    it("does not show nudge buttons when onNudge is not provided", () => {
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
        />
      );
      expect(screen.queryByTitle("Nudge Alice")).not.toBeInTheDocument();
    });

    it("shows both kick and nudge buttons for the same unvoted participant", () => {
      const onKick = vi.fn();
      const onNudge = vi.fn();
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
          onKick={onKick}
          onNudge={onNudge}
        />
      );
      expect(screen.getByTitle("Kick Alice")).toBeInTheDocument();
      expect(screen.getByTitle("Nudge Alice")).toBeInTheDocument();
    });

    it("shows kick but not nudge for a participant who has already voted", () => {
      const onKick = vi.fn();
      const onNudge = vi.fn();
      render(
        <ParticipantList
          participants={participants}
          facilitatorId="fac"
          currentUserId="fac"
          onKick={onKick}
          onNudge={onNudge}
        />
      );
      expect(screen.getByTitle("Kick Bob")).toBeInTheDocument();
      expect(screen.queryByTitle("Nudge Bob")).not.toBeInTheDocument();
    });
  });
});
