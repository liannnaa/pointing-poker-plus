import { z } from "zod";

// Small curated set of emoji avatars users can optionally pick alongside
// their display name. Kept as an allow-list (rather than free text) so we
// never persist arbitrary/oversized strings or unexpected unicode.
export const ALLOWED_AVATARS = [
  "😀", "😎", "🤓", "🥳", "🤖", "👽", "🐱", "🐶",
  "🦊", "🐼", "🐸", "🦄", "🐙", "🦁", "🐵", "🐧",
  "👻", "🪿",
] as const;

export const joinSessionSchema = z.object({
  display_name: z
    .string()
    .min(1, "Display name is required")
    .max(50, "Display name must be 50 characters or fewer"),
  avatar_emoji: z
    .enum(ALLOWED_AVATARS)
    .optional()
    .or(z.literal(null)),
});

export const voteSchema = z.object({
  value: z
    .number()
    .refine((v) => [1, 2, 3, 5].includes(v), "Vote must be 1, 2, 3, or 5"),
  issue_key: z.string().min(1, "issue_key is required"),
});

export const jiraConnectSchema = z.object({
  email: z.email("Invalid email address"),
  token: z.string().min(1, "API token is required"),
  base_url: z
    .string()
    .min(1, "base_url is required")
    .refine((url) => {
      try {
        return new URL(url).protocol === "https:";
      } catch {
        return false;
      }
    }, "base_url must be a valid HTTPS URL"),
  project_key: z.string().optional(),
});

export const pointsSubmitSchema = z.object({
  points: z.number().gte(0, "points must be a non-negative number"),
  session_code: z.string().min(1, "session_code is required"),
});

export const selectIssueSchema = z.object({
  issue_key: z.string().min(1, "issue_key is required"),
});

export const refreshIssueSchema = z.object({
  session_code: z.string().min(1, "session_code is required"),
});

export const planAddSchema = z.object({
  issue_key: z.string().min(1, "issue_key is required"),
});

export const planUpdateSchema = z
  .object({
    capacity_points: z
      .number()
      .gte(0, "capacity_points must be a non-negative number")
      .nullable()
      .optional(),
    refresh: z.boolean().optional(),
  })
  .refine(
    (d) => d.capacity_points !== undefined || d.refresh !== undefined,
    "At least one field (capacity_points, refresh) must be provided"
  );

export const teammateSchema = z.object({
  account_id: z.string().min(1, "account_id is required").max(128),
  display_name: z.string().min(1, "display_name is required").max(255),
  email: z.string().max(255).nullable().optional(),
  avatar_url: z.string().max(2048).nullable().optional(),
  capacity_points: z
    .number()
    .gte(0, "capacity_points must be a non-negative number")
    .nullable()
    .optional(),
});

export const teammateAddSchema = teammateSchema;

export const teammateUpdateSchema = z.object({
  account_id: z.string().min(1, "account_id is required").max(128),
  capacity_points: z
    .number()
    .gte(0, "capacity_points must be a non-negative number")
    .nullable(),
});

/** Bulk rehydrate of the host's locally-stored roster. Merges, never wipes. */
export const teammateBulkSchema = z.object({
  teammates: z.array(teammateSchema).max(50, "At most 50 teammates"),
});

export const planAssignSchema = z
  .object({
    assignee_account_id: z.string().min(1).max(128).nullable().optional(),
    /** Only `false` is accepted — un-stages a pending removal. */
    removed: z.literal(false).optional(),
  })
  .refine(
    (d) => d.assignee_account_id !== undefined || d.removed !== undefined,
    "At least one field (assignee_account_id, removed) must be provided"
  );

/**
 * The plan's destination sprint. A null `sprint_id` means no existing sprint is
 * targeted (nothing chosen yet, or the host is creating a new one), which
 * clears the plan's sprint-origin tickets.
 */
export const planDestinationSchema = z
  .object({
    board_id: z.number().int().positive().nullable(),
    sprint_id: z.number().int().positive().nullable(),
    sprint_name: z.string().min(1).max(255).nullable().optional(),
  })
  // A sprint is only meaningful with its board: sprint names repeat across
  // boards, and the sprint's issues must be read through the board's filter.
  .refine((d) => d.sprint_id === null || d.board_id !== null, {
    message: "board_id is required when sprint_id is set",
    path: ["board_id"],
  });

export const planCommitSchema = z
  .object({
    sprint_id: z.number().int().positive().optional(),
    board_id: z.number().int().positive().optional(),
    name: z.string().min(1).max(255).optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    goal: z.string().max(500).optional(),
  })
  .refine(
    (d) =>
      (d.sprint_id !== undefined && d.board_id === undefined && d.name === undefined) ||
      (d.sprint_id === undefined && d.board_id !== undefined && d.name !== undefined),
    "Provide either sprint_id, or board_id and name to create a new sprint"
  );

export const issueUpdateSchema = z.object({
  session_code: z.string().min(1, "session_code is required"),
  summary: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  ac: z.string().optional(),
}).refine(
  (d) => d.summary !== undefined || d.description !== undefined || d.ac !== undefined,
  "At least one field (summary, description, ac) must be provided"
);
