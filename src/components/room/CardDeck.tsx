"use client";

import { cn } from "@/lib/utils";

const CARD_VALUES = [1, 2, 3, 5] as const;

type CardDeckProps = {
  selectedValue: number | null;
  onVote: (value: number) => void;
  disabled: boolean;
};

export function CardDeck({ selectedValue, onVote, disabled }: CardDeckProps) {
  return (
    <div className="flex gap-3 justify-center flex-wrap">
      {CARD_VALUES.map((value) => (
        <button
          key={value}
          onClick={() => onVote(value)}
          disabled={disabled}
          className={cn(
            "w-16 h-24 rounded-sm border text-xl font-semibold transition-colors cursor-pointer",
            "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
            selectedValue === value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-foreground hover:border-primary/60 hover:bg-accent"
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
