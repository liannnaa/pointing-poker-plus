import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FacilitatorControls } from "@/components/room/FacilitatorControls";

describe("FacilitatorControls", () => {
  it("calls onReveal directly when all participants have voted", () => {
    const onReveal = vi.fn();
    render(
      <FacilitatorControls
        state="voting"
        onReveal={onReveal}
        onLock={vi.fn()}
        onClear={vi.fn()}
        onEndSession={vi.fn()}
        loading={false}
        voteCount={2}
        totalVoters={2}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /reveal votes/i }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables Reveal Votes button when voteCount is 0", () => {
    render(
      <FacilitatorControls
        state="voting"
        onReveal={vi.fn()}
        onLock={vi.fn()}
        onClear={vi.fn()}
        onEndSession={vi.fn()}
        loading={false}
        voteCount={0}
        totalVoters={2}
      />
    );
    expect(screen.getByRole("button", { name: /reveal votes/i })).toBeDisabled();
  });

  it("disables Reveal Votes button when loading", () => {
    render(
      <FacilitatorControls
        state="voting"
        onReveal={vi.fn()}
        onLock={vi.fn()}
        onClear={vi.fn()}
        onEndSession={vi.fn()}
        loading={true}
        voteCount={1}
        totalVoters={2}
      />
    );
    expect(screen.getByRole("button", { name: /revealing/i })).toBeDisabled();
  });

  it("shows Invite participants message when totalVoters is 0", () => {
    render(
      <FacilitatorControls
        state="voting"
        onReveal={vi.fn()}
        onLock={vi.fn()}
        onClear={vi.fn()}
        onEndSession={vi.fn()}
        loading={false}
        voteCount={0}
        totalVoters={0}
      />
    );
    expect(screen.getByText(/invite participants/i)).toBeInTheDocument();
  });

  it("shows partial vote warning when some but not all have voted", () => {
    render(
      <FacilitatorControls
        state="voting"
        onReveal={vi.fn()}
        onLock={vi.fn()}
        onClear={vi.fn()}
        onEndSession={vi.fn()}
        loading={false}
        voteCount={1}
        totalVoters={3}
      />
    );
    expect(screen.getByText(/only 1\/3 participants have voted/i)).toBeInTheDocument();
  });

  it("shows Lock Votes button in revealed state and calls onLock on click", () => {
    const onLock = vi.fn();
    render(
      <FacilitatorControls
        state="revealed"
        onReveal={vi.fn()}
        onLock={onLock}
        onClear={vi.fn()}
        onEndSession={vi.fn()}
        loading={false}
        voteCount={2}
        totalVoters={2}
      />
    );
    const btn = screen.getByRole("button", { name: /lock votes/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("does not show Lock Votes button once votes are locked", () => {
    render(
      <FacilitatorControls
        state="locked"
        onReveal={vi.fn()}
        onLock={vi.fn()}
        onClear={vi.fn()}
        onEndSession={vi.fn()}
        loading={false}
        voteCount={2}
        totalVoters={2}
      />
    );
    expect(screen.queryByRole("button", { name: /lock votes/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next round/i })).toBeInTheDocument();
  });

  it("shows Next Round in revealed state and calls onClear on click", () => {
    const onClear = vi.fn();
    render(
      <FacilitatorControls
        state="revealed"
        onReveal={vi.fn()}
        onLock={vi.fn()}
        onClear={onClear}
        onEndSession={vi.fn()}
        loading={false}
        voteCount={2}
        totalVoters={2}
      />
    );
    const btn = screen.getByRole("button", { name: /next round/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("disables Next Round button when loading", () => {
    render(
      <FacilitatorControls
        state="revealed"
        onReveal={vi.fn()}
        onLock={vi.fn()}
        onClear={vi.fn()}
        onEndSession={vi.fn()}
        loading={true}
        voteCount={2}
        totalVoters={2}
      />
    );
    expect(screen.getByRole("button", { name: /clearing/i })).toBeDisabled();
  });

  it("shows End Session button and calls onEndSession on click", () => {
    const onEndSession = vi.fn();
    render(
      <FacilitatorControls
        state="voting"
        onReveal={vi.fn()}
        onLock={vi.fn()}
        onClear={vi.fn()}
        onEndSession={onEndSession}
        loading={false}
        voteCount={1}
        totalVoters={2}
      />
    );
    const btn = screen.getByRole("button", { name: /end session/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onEndSession).toHaveBeenCalledTimes(1);
  });

  it("disables End Session button when loading is true", () => {
    render(
      <FacilitatorControls
        state="voting"
        onReveal={vi.fn()}
        onLock={vi.fn()}
        onClear={vi.fn()}
        onEndSession={vi.fn()}
        loading={true}
        voteCount={1}
        totalVoters={2}
      />
    );
    expect(screen.getByRole("button", { name: /end session/i })).toBeDisabled();
  });

  describe("partial-vote confirmation dialog", () => {
    it("opens the confirmation dialog when not all participants have voted", () => {
      render(
        <FacilitatorControls
          state="voting"
          onReveal={vi.fn()}
          onLock={vi.fn()}
          onClear={vi.fn()}
          onEndSession={vi.fn()}
          loading={false}
          voteCount={1}
          totalVoters={3}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /reveal votes/i }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/not everyone has voted/i)).toBeInTheDocument();
    });

    it("shows the correct absent-participant count in the dialog", () => {
      render(
        <FacilitatorControls
          state="voting"
          onReveal={vi.fn()}
          onLock={vi.fn()}
          onClear={vi.fn()}
          onEndSession={vi.fn()}
          loading={false}
          voteCount={2}
          totalVoters={5}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /reveal votes/i }));
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toMatch(/3 participants haven't voted yet/);
    });

    it("uses singular 'participant' when exactly one hasn't voted", () => {
      render(
        <FacilitatorControls
          state="voting"
          onReveal={vi.fn()}
          onLock={vi.fn()}
          onClear={vi.fn()}
          onEndSession={vi.fn()}
          loading={false}
          voteCount={2}
          totalVoters={3}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /reveal votes/i }));
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toMatch(/1 participant haven't voted yet/);
      expect(dialog.textContent).not.toMatch(/1 participants/);
    });

    it("does not call onReveal when the dialog opens", () => {
      const onReveal = vi.fn();
      render(
        <FacilitatorControls
          state="voting"
          onReveal={onReveal}
          onLock={vi.fn()}
          onClear={vi.fn()}
          onEndSession={vi.fn()}
          loading={false}
          voteCount={1}
          totalVoters={3}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /reveal votes/i }));
      expect(onReveal).not.toHaveBeenCalled();
    });

    it("calls onReveal when 'Reveal anyway' is clicked", () => {
      const onReveal = vi.fn();
      render(
        <FacilitatorControls
          state="voting"
          onReveal={onReveal}
          onLock={vi.fn()}
          onClear={vi.fn()}
          onEndSession={vi.fn()}
          loading={false}
          voteCount={1}
          totalVoters={3}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /reveal votes/i }));
      fireEvent.click(screen.getByRole("button", { name: /reveal anyway/i }));
      expect(onReveal).toHaveBeenCalledTimes(1);
    });

    it("dismisses the dialog and does not call onReveal when Cancel is clicked", () => {
      const onReveal = vi.fn();
      render(
        <FacilitatorControls
          state="voting"
          onReveal={onReveal}
          onLock={vi.fn()}
          onClear={vi.fn()}
          onEndSession={vi.fn()}
          loading={false}
          voteCount={1}
          totalVoters={3}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /reveal votes/i }));
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(onReveal).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
