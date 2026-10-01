"use client";

import { cn } from "@/lib/utils";

export type SprintPlanChipProps = {
  count: number;
  totalPoints: number;
  capacityPoints: number | null;
  unpointedCount: number;
  /** Renders as a button when provided (host); otherwise a static readout. */
  onClick?: () => void;
  className?: string;
};

/** under / at / over capacity — drives the colour treatment. */
export function capacityStatus(
  totalPoints: number,
  capacityPoints: number | null
): "none" | "under" | "at" | "over" {
  if (capacityPoints === null || capacityPoints <= 0) return "none";
  if (totalPoints > capacityPoints) return "over";
  if (totalPoints === capacityPoints) return "at";
  return "under";
}

/** Badge colours per capacity state, shared with the sprint plan sheet. */
export const CAPACITY_STATUS_CLASSES: Record<ReturnType<typeof capacityStatus>, string> = {
  none: "bg-blue-100 text-blue-800 dark:bg-[#1C2B41] dark:text-[#579DFF]",
  under: "bg-blue-100 text-blue-800 dark:bg-[#1C2B41] dark:text-[#579DFF]",
  at: "bg-emerald-100 text-emerald-800 dark:bg-[#1C3A2A] dark:text-[#4BCE97]",
  over: "bg-red-100 text-red-800 dark:bg-[#3D1F1D] dark:text-[#F87168]",
};

/**
 * Compact, always-visible readout of the sprint plan. Shown to every
 * participant so the whole team can watch the tally against capacity.
 */
export function SprintPlanChip({
  count,
  totalPoints,
  capacityPoints,
  unpointedCount,
  onClick,
  className,
}: SprintPlanChipProps) {
  const status = capacityStatus(totalPoints, capacityPoints);
  const pointsLabel =
    capacityPoints !== null && capacityPoints > 0
      ? `${totalPoints}/${capacityPoints} pts`
      : `${totalPoints} pts`;

  const label = `Plan: ${count} · ${pointsLabel}`;
  const title =
    unpointedCount > 0
      ? `${unpointedCount} ticket${unpointedCount === 1 ? " has" : "s have"} no points in Jira`
      : undefined;

  const classes = cn(
    "text-[10px] font-medium px-1.5 py-0.5 rounded-sm shrink-0 font-mono",
    CAPACITY_STATUS_CLASSES[status],
    onClick && "cursor-pointer hover:opacity-80 transition-opacity",
    className
  );

  const content = (
    <>
      {label}
      {unpointedCount > 0 && (
        <span className="ml-1 text-amber-700 dark:text-[#F5CD47]" aria-hidden="true">
          ⚠
        </span>
      )}
    </>
  );

  if (!onClick) {
    return (
      <span className={classes} title={title} data-testid="sprint-plan-chip">
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={classes}
      title={title}
      aria-label="Open sprint plan"
      data-testid="sprint-plan-chip"
    >
      {content}
    </button>
  );
}
