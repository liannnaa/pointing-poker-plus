import { vi } from "vitest";

/** Build a chainable Supabase query mock that resolves to `result`. */
export function makeQueryMock(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "insert", "update", "upsert", "delete",
    "eq", "single", "neq", "gte", "lte", "in", "is",
  ];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  // Terminal: return promise
  (chain as Record<string, unknown>).then = undefined;
  // Make it thenable when awaited via .single() or direct await
  const thenable = {
    ...chain,
    single: vi.fn().mockResolvedValue(result),
  };
  methods.filter((m) => m !== "single").forEach((m) => {
    (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
  });
  // Allow bare await too
  (thenable as Record<string | symbol, unknown>)[Symbol.for("supabase.resolve")] = result;
  return thenable;
}

/** Minimal Supabase client mock. Override per-test by mutating `.from` return. */
export function makeSupabaseMock(overrides?: {
  getUser?: () => Promise<{ data: { user: { id: string } | null }; error: null }>;
  fromResults?: Record<string, { data?: unknown; error?: unknown }>;
}) {
  const fromResults = overrides?.fromResults ?? {};

  const client = {
    auth: {
      getUser: overrides?.getUser ?? vi.fn().mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => makeQueryMock(fromResults[table] ?? { data: null, error: null })),
    channel: vi.fn().mockReturnValue({
      send: vi.fn().mockResolvedValue(undefined),
    }),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
  return client;
}
