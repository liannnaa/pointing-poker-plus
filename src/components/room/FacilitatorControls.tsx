"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

type FacilitatorControlsProps = {
  state: "voting" | "revealed" | "locked";
  onReveal: () => void;
  onLock: () => void;
  onClear: () => void;
  onEndSession: () => void;
  loading: boolean;
  voteCount: number;
  totalVoters: number;
};

export function FacilitatorControls({
  state,
  onReveal,
  onLock,
  onClear,
  onEndSession,
  loading,
  voteCount,
  totalVoters,
}: FacilitatorControlsProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const noParticipants = totalVoters === 0;
  const allVoted = totalVoters > 0 && voteCount === totalVoters;
  const partialVotes = voteCount > 0 && voteCount < totalVoters;
  const absentCount = totalVoters - voteCount;

  function handleRevealClick() {
    if (!allVoted && voteCount > 0) {
      setShowConfirm(true);
    } else {
      onReveal();
    }
  }

  function handleConfirmReveal() {
    setShowConfirm(false);
    onReveal();
  }

  return (
    <>
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Not everyone has voted</DialogTitle>
            <DialogDescription>
              {absentCount} participant{absentCount !== 1 ? "s" : ""} haven&apos;t voted yet.
              Their votes won&apos;t be included in the average.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowConfirm(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmReveal}>
              Reveal anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between gap-2">
        <Button
          onClick={onEndSession}
          disabled={loading}
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground hover:text-destructive"
        >
          End Session
        </Button>
        <div className="flex items-center gap-2">
          {state === "voting" && noParticipants && (
            <span className="text-xs text-muted-foreground">
              Invite participants to start voting
            </span>
          )}
          {state === "voting" && partialVotes && (
            <span className="text-xs text-yellow-500">
              Only {voteCount}/{totalVoters} participants have voted
            </span>
          )}
          {state === "voting" ? (
            <Button
              onClick={handleRevealClick}
              disabled={loading || voteCount === 0}
              size="sm"
              className="h-8"
            >
              {loading ? "Revealing..." : "Reveal Votes"}
            </Button>
          ) : (
            <>
              {state === "revealed" && (
                <Button
                  onClick={onLock}
                  disabled={loading}
                  size="sm"
                  className="h-8"
                >
                  {loading ? "Locking..." : "Lock Votes"}
                </Button>
              )}
              <Button
                onClick={onClear}
                disabled={loading}
                variant="secondary"
                size="sm"
                className="h-8 border border-border"
              >
                {loading ? "Clearing..." : "Next Round"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
