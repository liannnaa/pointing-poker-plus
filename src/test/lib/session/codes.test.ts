import { describe, it, expect } from "vitest";
import { generateSessionCode } from "@/lib/session/codes";

const CHARSET = new Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789".split(""));
const AMBIGUOUS = new Set(["0", "O", "1", "I", "L"]);

describe("generateSessionCode", () => {
  it("returns a 6-character string", () => {
    expect(generateSessionCode()).toHaveLength(6);
  });

  it("only uses characters from the unambiguous charset", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateSessionCode();
      for (const char of code) {
        expect(CHARSET.has(char), `'${char}' should be in charset`).toBe(true);
      }
    }
  });

  it("never contains ambiguous characters", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateSessionCode();
      for (const char of code) {
        expect(AMBIGUOUS.has(char), `'${char}' should not be ambiguous`).toBe(false);
      }
    }
  });

  it("returns uppercase letters only", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateSessionCode();
      expect(code).toBe(code.toUpperCase());
    }
  });

  it("generates different codes across calls (not static)", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateSessionCode()));
    // Probability of all 20 matching is astronomically small
    expect(codes.size).toBeGreaterThan(1);
  });
});
