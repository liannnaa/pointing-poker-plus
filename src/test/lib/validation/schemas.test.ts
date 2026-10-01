import { describe, it, expect } from "vitest";
import {
  joinSessionSchema,
  voteSchema,
  jiraConnectSchema,
  pointsSubmitSchema,
  selectIssueSchema,
  issueUpdateSchema,
  planAddSchema,
  planUpdateSchema,
  planCommitSchema,
  teammateAddSchema,
  teammateUpdateSchema,
  teammateBulkSchema,
  planAssignSchema,
  planDestinationSchema,
  ALLOWED_AVATARS,
} from "@/lib/validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// joinSessionSchema
// ─────────────────────────────────────────────────────────────────────────────

describe("joinSessionSchema", () => {
  it("accepts a valid display name", () => {
    const result = joinSessionSchema.safeParse({ display_name: "Alice" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty display_name", () => {
    const result = joinSessionSchema.safeParse({ display_name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a display_name that is too long (>50 chars)", () => {
    const result = joinSessionSchema.safeParse({
      display_name: "A".repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a display name with no avatar_emoji", () => {
    const result = joinSessionSchema.safeParse({ display_name: "Alice" });
    expect(result.success).toBe(true);
  });

  it("accepts an allow-listed avatar_emoji", () => {
    const result = joinSessionSchema.safeParse({
      display_name: "Alice",
      avatar_emoji: ALLOWED_AVATARS[0],
    });
    expect(result.success).toBe(true);
  });

  it("accepts avatar_emoji explicitly set to null", () => {
    const result = joinSessionSchema.safeParse({
      display_name: "Alice",
      avatar_emoji: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an avatar_emoji outside the allow-list", () => {
    const result = joinSessionSchema.safeParse({
      display_name: "Alice",
      avatar_emoji: "🍕",
    });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// voteSchema
// ─────────────────────────────────────────────────────────────────────────────

describe("voteSchema", () => {
  it.each([1, 2, 3, 5])("accepts valid vote value %i", (value) => {
    const result = voteSchema.safeParse({ value, issue_key: "PROJ-1" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid vote value (4)", () => {
    const result = voteSchema.safeParse({ value: 4, issue_key: "PROJ-1" });
    expect(result.success).toBe(false);
  });

  it("rejects when issue_key is missing", () => {
    const result = voteSchema.safeParse({ value: 3 });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// jiraConnectSchema
// ─────────────────────────────────────────────────────────────────────────────

describe("jiraConnectSchema", () => {
  const valid = {
    email: "user@example.com",
    token: "my-api-token",
    base_url: "https://example.atlassian.net",
  };

  it("accepts a valid jira connect payload", () => {
    const result = jiraConnectSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = jiraConnectSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-https URL (http://)", () => {
    const result = jiraConnectSchema.safeParse({
      ...valid,
      base_url: "http://example.atlassian.net",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a totally invalid URL string", () => {
    const result = jiraConnectSchema.safeParse({
      ...valid,
      base_url: "not-a-url-at-all",
    });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pointsSubmitSchema
// ─────────────────────────────────────────────────────────────────────────────

describe("pointsSubmitSchema", () => {
  it("accepts points=0 (zero is valid)", () => {
    const result = pointsSubmitSchema.safeParse({ points: 0, session_code: "ABC123" });
    expect(result.success).toBe(true);
  });

  it("rejects negative points", () => {
    const result = pointsSubmitSchema.safeParse({ points: -1, session_code: "ABC123" });
    expect(result.success).toBe(false);
  });

  it("rejects when session_code is missing", () => {
    const result = pointsSubmitSchema.safeParse({ points: 3 });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectIssueSchema
// ─────────────────────────────────────────────────────────────────────────────

describe("selectIssueSchema", () => {
  it("accepts a valid issue_key", () => {
    const result = selectIssueSchema.safeParse({ issue_key: "PROJ-42" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty issue_key", () => {
    const result = selectIssueSchema.safeParse({ issue_key: "" });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// issueUpdateSchema
// ─────────────────────────────────────────────────────────────────────────────

describe("issueUpdateSchema", () => {
  it("passes when only summary is provided", () => {
    const result = issueUpdateSchema.safeParse({
      session_code: "ABC123",
      summary: "New summary",
    });
    expect(result.success).toBe(true);
  });

  it("passes when only description is provided", () => {
    const result = issueUpdateSchema.safeParse({
      session_code: "ABC123",
      description: "Some description",
    });
    expect(result.success).toBe(true);
  });

  it("passes when only ac is provided", () => {
    const result = issueUpdateSchema.safeParse({
      session_code: "ABC123",
      ac: "Given / When / Then",
    });
    expect(result.success).toBe(true);
  });

  it("fails (refine) when none of summary, description, or ac are provided", () => {
    const result = issueUpdateSchema.safeParse({ session_code: "ABC123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        "At least one field (summary, description, ac) must be provided"
      );
    }
  });
});

describe("planAddSchema", () => {
  it("accepts a non-empty issue key", () => {
    expect(planAddSchema.safeParse({ issue_key: "PROJ-1" }).success).toBe(true);
  });

  it("rejects a missing issue key", () => {
    expect(planAddSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty issue key", () => {
    const result = planAddSchema.safeParse({ issue_key: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("issue_key is required");
    }
  });
});

describe("planUpdateSchema", () => {
  it("accepts a numeric capacity", () => {
    expect(planUpdateSchema.safeParse({ capacity_points: 40 }).success).toBe(true);
  });

  it("accepts a null capacity (clearing the target)", () => {
    expect(planUpdateSchema.safeParse({ capacity_points: null }).success).toBe(true);
  });

  it("accepts a refresh request", () => {
    expect(planUpdateSchema.safeParse({ refresh: true }).success).toBe(true);
  });

  it("rejects a negative capacity", () => {
    expect(planUpdateSchema.safeParse({ capacity_points: -1 }).success).toBe(false);
  });

  it("rejects a non-numeric capacity", () => {
    expect(planUpdateSchema.safeParse({ capacity_points: "forty" }).success).toBe(false);
  });

  it("fails (refine) when no field is provided", () => {
    const result = planUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain(
        "At least one field (capacity_points, refresh) must be provided"
      );
    }
  });
});

describe("planCommitSchema", () => {
  it("accepts an existing sprint id", () => {
    expect(planCommitSchema.safeParse({ sprint_id: 7 }).success).toBe(true);
  });

  it("accepts new-sprint fields", () => {
    const result = planCommitSchema.safeParse({
      board_id: 5,
      name: "Sprint 42",
      start_date: "2026-01-01T00:00:00.000Z",
      end_date: "2026-01-14T00:00:00.000Z",
      goal: "Ship it",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    expect(planCommitSchema.safeParse({}).success).toBe(false);
  });

  it("rejects mixing sprint_id with new-sprint fields", () => {
    const result = planCommitSchema.safeParse({ sprint_id: 7, board_id: 5, name: "S" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain(
        "Provide either sprint_id, or board_id and name to create a new sprint"
      );
    }
  });

  it("rejects a board without a name", () => {
    expect(planCommitSchema.safeParse({ board_id: 5 }).success).toBe(false);
  });

  it("rejects a non-positive sprint id", () => {
    expect(planCommitSchema.safeParse({ sprint_id: 0 }).success).toBe(false);
  });

  it("rejects a non-integer board id", () => {
    expect(planCommitSchema.safeParse({ board_id: 1.5, name: "S" }).success).toBe(false);
  });
});

describe("teammateAddSchema", () => {
  it("accepts a minimal Jira user", () => {
    expect(
      teammateAddSchema.safeParse({ account_id: "acc-1", display_name: "Alice" }).success
    ).toBe(true);
  });

  it("accepts optional email, avatar and capacity", () => {
    const result = teammateAddSchema.safeParse({
      account_id: "acc-1",
      display_name: "Alice",
      email: "alice@example.com",
      avatar_url: "https://x/a.png",
      capacity_points: 13,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a null email for GDPR-strict Jira sites", () => {
    expect(
      teammateAddSchema.safeParse({
        account_id: "acc-1",
        display_name: "Alice",
        email: null,
      }).success
    ).toBe(true);
  });

  it("rejects an empty account_id", () => {
    expect(
      teammateAddSchema.safeParse({ account_id: "", display_name: "Alice" }).success
    ).toBe(false);
  });

  it("rejects a missing display_name", () => {
    expect(teammateAddSchema.safeParse({ account_id: "acc-1" }).success).toBe(false);
  });

  it("rejects a negative capacity", () => {
    expect(
      teammateAddSchema.safeParse({
        account_id: "acc-1",
        display_name: "Alice",
        capacity_points: -1,
      }).success
    ).toBe(false);
  });
});

describe("teammateUpdateSchema", () => {
  it("accepts a numeric capacity", () => {
    expect(
      teammateUpdateSchema.safeParse({ account_id: "acc-1", capacity_points: 8 }).success
    ).toBe(true);
  });

  it("accepts null to clear the capacity", () => {
    expect(
      teammateUpdateSchema.safeParse({ account_id: "acc-1", capacity_points: null }).success
    ).toBe(true);
  });

  it("requires capacity_points to be present", () => {
    expect(teammateUpdateSchema.safeParse({ account_id: "acc-1" }).success).toBe(false);
  });

  it("rejects a negative capacity", () => {
    expect(
      teammateUpdateSchema.safeParse({ account_id: "acc-1", capacity_points: -3 }).success
    ).toBe(false);
  });
});

describe("teammateBulkSchema", () => {
  it("accepts an empty roster", () => {
    expect(teammateBulkSchema.safeParse({ teammates: [] }).success).toBe(true);
  });

  it("accepts a list of teammates", () => {
    expect(
      teammateBulkSchema.safeParse({
        teammates: [{ account_id: "acc-1", display_name: "Alice" }],
      }).success
    ).toBe(true);
  });

  it("rejects a non-array payload", () => {
    expect(teammateBulkSchema.safeParse({ teammates: "nope" }).success).toBe(false);
  });

  it("rejects a malformed entry", () => {
    expect(
      teammateBulkSchema.safeParse({ teammates: [{ display_name: "Alice" }] }).success
    ).toBe(false);
  });

  it("caps the roster size", () => {
    const teammates = Array.from({ length: 51 }, (_, i) => ({
      account_id: `acc-${i}`,
      display_name: `User ${i}`,
    }));
    expect(teammateBulkSchema.safeParse({ teammates }).success).toBe(false);
  });
});

describe("planAssignSchema", () => {
  it("accepts an account id", () => {
    expect(planAssignSchema.safeParse({ assignee_account_id: "acc-1" }).success).toBe(true);
  });

  it("accepts null to unassign", () => {
    expect(planAssignSchema.safeParse({ assignee_account_id: null }).success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(planAssignSchema.safeParse({ assignee_account_id: "" }).success).toBe(false);
  });

  it("rejects a non-string assignee", () => {
    expect(planAssignSchema.safeParse({ assignee_account_id: 7 }).success).toBe(false);
  });

  it("rejects a missing field", () => {
    expect(planAssignSchema.safeParse({}).success).toBe(false);
  });

  it("accepts removed: false to undo a staged removal", () => {
    expect(planAssignSchema.safeParse({ removed: false }).success).toBe(true);
  });

  it("rejects removed: true — staging goes through DELETE", () => {
    expect(planAssignSchema.safeParse({ removed: true }).success).toBe(false);
  });
});

describe("planDestinationSchema", () => {
  it("accepts a board and sprint", () => {
    expect(
      planDestinationSchema.safeParse({ board_id: 1, sprint_id: 10, sprint_name: "Sprint 10" })
        .success
    ).toBe(true);
  });

  it("accepts a null sprint (no existing sprint targeted)", () => {
    expect(planDestinationSchema.safeParse({ board_id: 1, sprint_id: null }).success).toBe(true);
  });

  it("accepts a fully null destination", () => {
    expect(planDestinationSchema.safeParse({ board_id: null, sprint_id: null }).success).toBe(
      true
    );
  });

  it("rejects a sprint without its board", () => {
    // Sprint names repeat across boards, so a sprint is meaningless alone.
    const result = planDestinationSchema.safeParse({ board_id: null, sprint_id: 10 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["board_id"]);
    }
  });

  it("rejects a non-numeric id", () => {
    expect(planDestinationSchema.safeParse({ board_id: "1", sprint_id: 10 }).success).toBe(false);
  });

  it("rejects a non-positive sprint id", () => {
    expect(planDestinationSchema.safeParse({ board_id: 1, sprint_id: 0 }).success).toBe(false);
  });

  it("rejects a missing board_id", () => {
    expect(planDestinationSchema.safeParse({ sprint_id: 10 }).success).toBe(false);
  });

  it("rejects an empty sprint name", () => {
    expect(
      planDestinationSchema.safeParse({ board_id: 1, sprint_id: 10, sprint_name: "" }).success
    ).toBe(false);
  });
});
