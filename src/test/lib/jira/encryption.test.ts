import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const VALID_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

beforeEach(() => {
  process.env.JIRA_ENCRYPTION_KEY = VALID_KEY;
});

afterEach(() => {
  delete process.env.JIRA_ENCRYPTION_KEY;
});

describe("encrypt / decrypt", () => {
  it("round-trips a plain string", async () => {
    const { encrypt, decrypt } = await import("@/lib/jira/encryption");
    const plaintext = "my-secret-token";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("round-trips an empty string", async () => {
    const { encrypt, decrypt } = await import("@/lib/jira/encryption");
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("round-trips unicode content", async () => {
    const { encrypt, decrypt } = await import("@/lib/jira/encryption");
    const text = "tëst-üñícödë-tökën-🔑";
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it("produces different ciphertext each call (random IV)", async () => {
    const { encrypt } = await import("@/lib/jira/encryption");
    const c1 = encrypt("same-input");
    const c2 = encrypt("same-input");
    expect(c1).not.toBe(c2);
  });

  it("output is valid base64", async () => {
    const { encrypt } = await import("@/lib/jira/encryption");
    const out = encrypt("hello");
    expect(() => Buffer.from(out, "base64")).not.toThrow();
  });

  it("throws when JIRA_ENCRYPTION_KEY is missing", async () => {
    delete process.env.JIRA_ENCRYPTION_KEY;
    // Re-import after clearing env so the module re-reads env
    vi.resetModules();
    const { encrypt } = await import("@/lib/jira/encryption");
    expect(() => encrypt("x")).toThrow("JIRA_ENCRYPTION_KEY");
  });

  it("throws when JIRA_ENCRYPTION_KEY is wrong length", async () => {
    process.env.JIRA_ENCRYPTION_KEY = "tooshort";
    vi.resetModules();
    const { encrypt } = await import("@/lib/jira/encryption");
    expect(() => encrypt("x")).toThrow("JIRA_ENCRYPTION_KEY");
  });

  it("throws when decrypting tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/lib/jira/encryption");
    const enc = encrypt("secret");
    const buf = Buffer.from(enc, "base64");
    // Flip a byte in the ciphertext area (past IV+authTag = 28 bytes)
    buf[30] ^= 0xff;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });
});
