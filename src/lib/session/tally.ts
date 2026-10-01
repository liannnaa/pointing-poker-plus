export type Vote = { user_id: string; value: number };

export type Tally = Record<number, number>;

export type TallyResult = {
  tally: Tally;
  average: number;
  median: number;
};

/** Computes a vote-value histogram, average, and median from a list of votes. */
export function computeTally(votes: Vote[] | null | undefined): TallyResult {
  const tally: Tally = {};
  let sum = 0;
  const list = votes ?? [];
  for (const vote of list) {
    tally[vote.value] = (tally[vote.value] || 0) + 1;
    sum += vote.value;
  }
  const average = list.length > 0 ? sum / list.length : 0;
  const sorted = [...list].map((v) => v.value).sort((a, b) => a - b);
  let median = 0;
  if (sorted.length > 0) {
    const mid = Math.floor(sorted.length / 2);
    median =
      sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
  return { tally, average, median };
}
