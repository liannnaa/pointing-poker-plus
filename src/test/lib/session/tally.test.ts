import { describe, it, expect } from "vitest";
import { computeTally } from "@/lib/session/tally";

describe("computeTally", () => {
  it("returns zeros for no votes", () => {
    const result = computeTally([]);
    expect(result).toEqual({ tally: {}, average: 0, median: 0 });
  });

  it("returns zeros for null/undefined votes", () => {
    expect(computeTally(null)).toEqual({ tally: {}, average: 0, median: 0 });
    expect(computeTally(undefined)).toEqual({ tally: {}, average: 0, median: 0 });
  });

  it("builds a histogram and computes average/median for a single vote", () => {
    const result = computeTally([{ user_id: "u1", value: 3 }]);
    expect(result).toEqual({ tally: { 3: 1 }, average: 3, median: 3 });
  });

  it("computes the middle value as median for an odd number of votes", () => {
    const result = computeTally([
      { user_id: "u1", value: 1 },
      { user_id: "u2", value: 5 },
      { user_id: "u3", value: 3 },
    ]);
    expect(result.tally).toEqual({ 1: 1, 3: 1, 5: 1 });
    expect(result.average).toBeCloseTo(3);
    expect(result.median).toBe(3);
  });

  it("averages the two middle values as median for an even number of votes", () => {
    const result = computeTally([
      { user_id: "u1", value: 1 },
      { user_id: "u2", value: 2 },
      { user_id: "u3", value: 3 },
      { user_id: "u4", value: 5 },
    ]);
    expect(result.average).toBeCloseTo(11 / 4);
    // Middle two sorted values are 2 and 3 -> median 2.5
    expect(result.median).toBe(2.5);
  });

  it("is not skewed by an outlier the way average is", () => {
    const result = computeTally([
      { user_id: "u1", value: 1 },
      { user_id: "u2", value: 1 },
      { user_id: "u3", value: 1 },
      { user_id: "u4", value: 13 },
    ]);
    expect(result.average).toBeCloseTo(4);
    expect(result.median).toBe(1);
  });
});
