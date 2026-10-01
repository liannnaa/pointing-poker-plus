import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("returns empty string with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("returns a single class unchanged", () => {
    expect(cn("foo")).toBe("foo");
  });

  it("merges multiple classes with a space", () => {
    expect(cn("foo", "bar", "baz")).toBe("foo bar baz");
  });

  it("ignores falsy conditional values", () => {
    expect(cn("foo", false && "bar", null, undefined, "baz")).toBe("foo baz");
  });

  it("resolves Tailwind conflicts by keeping the last value", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
