# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

Pointing Poker Plus — a real-time browser-based sprint estimation tool with Jira integration. Teams vote on stories simultaneously, facilitator reveals/confirms, and agreed points write back to Jira.

## Commands

```bash
# Dev server
npm run dev

# Build (must pass before committing)
npm run build

# Tests (Vitest) — always prefix with nvm use 20
source ~/.nvm/nvm.sh && nvm use 20 > /dev/null && npm run test:run        # single run
source ~/.nvm/nvm.sh && nvm use 20 > /dev/null && npm test                # watch mode
source ~/.nvm/nvm.sh && nvm use 20 > /dev/null && npm test -- src/test/lib/session/codes.test.ts  # single file

# Database (Supabase local)
npx supabase start
npx supabase stop
npx supabase status
npx supabase db reset          # rerun all migrations
npx supabase test db           # pgTAP RLS tests (20 tests in supabase/tests/rls.test.sql)

# Type generation (after migration changes)
# NOTE: "Connecting to db ..." is written to stderr, so redirect it away rather
# than stripping the first line of stdout (which would eat "export type Json =")
npx supabase gen types typescript --local 2>/dev/null > src/lib/supabase/types.ts

# Linting
npm run lint
```

## Workflow Rules

- **Always prefix shell commands with `source ~/.nvm/nvm.sh && nvm use 20 > /dev/null &&`** to ensure Node 20 is active.
- **After creating/modifying migrations**: run `npx supabase db reset` then regenerate types.
- **Before marking work complete**: run `npm run build` — type errors must be resolved.
- **API route pattern**: all routes validate input, return `{ error }` on failure, check auth first.
- **New shadcn components**: install with `npx shadcn@latest add <name>` — never create them manually.
- **Tests**: write or update tests for every new route, business-logic function, and non-trivial component. Run `npm run test:run` and `npx supabase test db` before marking any feature complete. Current baseline: 969 Vitest tests, 27 pgTAP tests — do not regress.
- **PLAN.md + AGENTS.md**: update both files whenever a phase is completed, a new architectural decision is made, a new test file is added, or a migration is created. Keep phase statuses, test file lists, broadcast event descriptions, and key patterns current.

## Testing Standards

### Coverage requirements
Coverage is enforced on every `npm run test:coverage` run. All thresholds apply **per-file** and **globally**:

| Category | Minimum |
|----------|---------|
| Statements | 80% |
| Branches | 80% |
| Functions | 80% |
| Lines | 80% |

`vitest.config.mts` uses `include: ["src/**/*.{ts,tsx}"]` to force all source files into the report — files with no tests show as 0% and will fail the gate. Untestable files (Next.js pages, layouts, Supabase client wiring, shadcn re-exports, type-only files) are explicitly listed in `exclude`.

### What must be tested
- Every API route handler — at minimum: auth check (401), the happy path (200/201), and the primary error path (4xx/5xx)
- Every business-logic function in `src/lib/`
- Every non-trivial component (anything with conditional rendering, event handlers, or state)
- New Zod schemas — valid input, each invalid branch

### What does NOT need tests
- Next.js page/layout files (`app/**/page.tsx`, `app/layout.tsx`)
- `RoomClient.tsx` (full integration component — tested via component tests instead)
- `src/middleware.ts` (Next.js auth session wiring)
- `src/components/providers/` (React context wiring)
- `src/lib/supabase/` (client initialisation, no logic)
- Pure shadcn/base-ui wrapper components in `src/components/ui/` with no added logic (alert, badge, card, select, separator, sheet, sonner)
- `src/lib/jira/types.ts` (type definitions only)

### Test file conventions
- Mirror source paths: `src/foo/bar.ts` → `src/test/foo/bar.test.ts`
- Use `vi.mock()` at the top level before `await import(...)` for route handlers
- Mock Supabase server client: `vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue(mockSupabase) }))`
- Use the `makeQueryMock` / `makeSupabaseMock` helpers from `src/test/mocks/supabase.ts` where appropriate
- Component tests: mock `sonner` (`vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))`), use real child components (don't mock shadcn primitives unless they prevent jsdom rendering)
- `@base-ui/react` Select/Dialog components may need mocking in jsdom — follow the pattern in `IssueList.test.tsx` (mock `@/components/ui/select` with native `<select>` doubles wired to `onValueChange`). Because components format their trigger label (see the `SelectValue` note below), the double must invoke that formatter — both `IssueList.test.tsx` and `SprintPlanSheet.test.tsx` render it into a `data-testid="select-value"` span so the label is assertable
- **Board selection in `IssueList.test.tsx` must wait on the `<option>`, not the fetch**: `await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/jira/sprints"))` only proves the request was *issued*; the board `<option>` may not be rendered yet, and `fireEvent.change` to a value a native `<select>` doesn't contain is silently a no-op. This was the cause of the file's long-standing intermittent failures — use the `selectBoard(value)` helper, which waits for the option itself

## Architecture

### Tech Stack
- **Next.js 14** (App Router, TypeScript, Tailwind CSS)
- **Supabase** — Postgres (RLS), Realtime (Broadcast + Presence), Anonymous Auth
- **shadcn/ui** (Radix + Tailwind components)
- **Vitest** + Testing Library for tests
- **Zod** for API input validation

### Real-time Model
Each session uses a single Supabase channel (`room:{code}`):
- **Presence** — tracks who's in room + `has_voted` flag (vote value never leaked pre-reveal)
- **Broadcast** — server-emitted events:
  - `reveal` — tally + individual votes (facilitator excluded via `.neq("user_id", facilitator_id)`)
  - `clear` — next issue key
  - `issue-select` — `{ issue_key, issue, jira_base_url, ac_field }` — full `JiraIssue` + Jira base URL + AC field ID; non-facilitator clients use this to display IssuePanel with description and AC
  - `points:submitted` — issue key + confirmed points (triggers toast on all clients)
  - `issue:updated` — `{ issue_key, issue }` — updated `JiraIssue` after facilitator edits summary/description/AC, a manual refresh, or an image upload; all clients replace their current issue state
  - `session:ended` — no payload; broadcast by `POST /api/sessions/[code]/end` before row deletion; non-facilitator clients show "session ended" overlay
  - `kick` — `{ user_id }`; broadcast by `POST /api/sessions/[code]/kick` before DB deletion; all clients immediately remove the user from presence/voted state; the kicked user sees a "removed" overlay
  - `plan:updated` — `{ items, teammates, capacity_points, total_points, unpointed_count, destination, pending_removals }` — the **entire** sprint plan state (not a delta); broadcast by every mutating plan, teammate and destination route; all clients replace their plan state wholesale. Each item carries `assignee_account_id` plus `origin` (`"added"` | `"sprint"`) and `removed`; `teammates` is the host's sprint roster; `destination` is `{ board_id, sprint_id, sprint_name } | null`; `pending_removals` holds the staged sprint-origin removals (excluded from `items` and all totals)
  - `plan:committed` — `{ sprint_id, sprint_name, moved, failed, assigned, assign_failed, removed, remove_failed }` — broadcast by `POST /api/sessions/[code]/plan/commit` after issues are moved into the target sprint; `removed`/`remove_failed` are the staged removals pushed back to the Jira backlog; drives a toast for everyone and flips the host's sheet into its committed state
  - `plan:visibility` — `{ open }` — **client-emitted by the host only** (via `broadcastPlanVisibility()` from `useSessionChannel`); mirrors the host's sprint plan sheet open/close state so guests see a read-only copy. Purely presentational, hence the client broadcast; the plan data itself still arrives via the server-emitted `plan:updated`. The host re-broadcasts whenever the roster changes so late joiners pick up an already-open panel
- Reveal tally computed server-side via service-role client (RLS blocks vote reads pre-reveal)
- Broadcast sent from API routes using service-role client (prevents client spoofing)
- Postgres Changes not used — Presence + Broadcast sufficient for all current needs

### Key Patterns
- **Anonymous auth**: `signInAnonymously()` gives stable `user_id` per browser, zero-friction join
- **Facilitator enforcement**: server-side check of `auth.uid()` vs `sessions.facilitator_id`
- **Jira credentials**: AES-256-GCM encrypted at rest, service-role only table, never returned to client
- **Vote upsert**: unique constraint `(session_id, issue_key, user_id)` allows changing vote before reveal
- **Non-Jira sessions**: use synthetic issue keys (`round-1`, `round-2`, etc.)
- **API errors**: structured `{ error: string, details?: any }` — Zod validation failures use `error.issues` (not `flatten()`, which is deprecated in Zod v4)
- **Issue selection resets DB state**: `POST /api/sessions/[code]/select-issue` sets `sessions.state = "voting"` before broadcasting — required so votes aren't rejected after a reveal when a new issue is selected
- **IssuePanel for all participants**: `select-issue` route fetches the full Jira issue and includes it in the broadcast payload; non-facilitator clients receive and display the issue details
- **Points snap-up**: after reveal, IssuePanel pre-fills the points input by snapping the vote **median** (not average — median resists skew from outlier votes) up to the nearest value in `[1, 2, 3, 5]`; `computeTally()` in `src/lib/session/tally.ts` returns both `average` (display only, shown in `VoteReveal`) and `median` (drives the snap)
- **Facilitator excluded from tally**: `reveal/route.ts` uses `.neq("user_id", session.facilitator_id)` on the votes query; facilitator does not see a CardDeck either
- **ADF renderer**: `IssuePanel.tsx` renders Jira's Atlassian Document Format via pure recursive functions (`renderBlock`, `renderInline`, `applyMarks`); `media` nodes render as `<img>` pointing at the attachment proxy route
- **Jira inline images**: Jira attachment URLs need auth, so images can't load directly in the browser. `GET /api/jira/attachment/[id]?session_code=X` proxies the bytes using the **facilitator's** credentials, so every participant sees images without their own Jira connection. `getIssue()` requests the `attachment` field; `resolveMediaAttachment()` maps an ADF media node to an attachment by (1) `alt`/`__fileName` filename, (2) matching id, (3) document order. Images not referenced inline render in an "Attachments" gallery; inline ones are excluded to avoid duplicates
- **Attachment proxy is deliberately narrow** (it borrows the facilitator's token, so it must not become a confused deputy): the caller must be authenticated, must be a row in `participants` for that session (facilitator exempt), and the requested id **must be one of the current issue's own attachments** — otherwise a caller could walk sequential Jira attachment ids and read the facilitator's entire Jira instance. Responses allow-list `image/png|jpeg|gif|webp` and serve anything else as `application/octet-stream` with `Content-Disposition: attachment`, plus `X-Content-Type-Options: nosniff` and a `default-src 'none'; sandbox` CSP, so an HTML/SVG attachment cannot run script on our origin
- **Media survives editing**: `adfToMarkdown()` emits images as `![alt](jira-media:<id>#<collection>)` and `markdownToAdf()` parses them back into `mediaSingle`/`media` nodes — without this, a facilitator edit would silently strip images from the Jira ticket
- **AC field detection**: `detectAcField()` in `src/lib/jira/client.ts` calls `/rest/api/3/field` at connect time and stores the matching field ID in `jira_credentials.ac_field`; existing users must reconnect once to get AC
- **`IssueSelectPayload`**: exported type from `realtime.ts` — single object `{ issueKey, issue, jiraBaseUrl, acField }` passed to `onIssueSelect` callback; snake_case broadcast payload mapped to camelCase in the handler
- **Facilitator ticket editing**: `IssuePanel.tsx` shows an "Edit" toggle (host only); edit mode swaps rendered ADF for Markdown `<Textarea>` editors (summary, description, AC); `adfToMarkdown()` pre-fills editors preserving links, lists, code blocks, bold/italic, headings, blockquotes; save sends raw Markdown strings to `PATCH /api/jira/issue/[key]`, which calls `markdownToAdf()` before writing to Jira, then broadcasts `issue:updated` so all clients see the revision live
- **Late-joiner state hydration**: after `POST /api/sessions/[code]/join`, `RoomClient` fetches current room state — `GET /reveal` if `session.state === "revealed"` (returns tally + votes + issue), or `GET /select-issue` if `state === "voting"` (returns current issue). Both endpoints use the facilitator's Jira credentials so non-facilitator late joiners still see the full issue detail
- **`src/lib/jira/adf-markdown.ts`**: ADF↔Markdown conversion module — `adfToMarkdown(node)` and `markdownToAdf(md)` — tested in `src/test/lib/jira/adf-markdown.test.ts`
- **Session auto-cleanup**: `POST /api/sessions/[code]/end` (facilitator-only) broadcasts `session:ended` then cascade-deletes the session. Facilitator's `RoomClient` fires `navigator.sendBeacon` to this route on `beforeunload`. Non-facilitators also detect host departure via presence (fallback for crashes). pg_cron job in migration 009 deletes sessions older than 24h as a final safety net.
- **`issueUpdateSchema`**: Zod schema in `schemas.ts` validates `{ session_code, summary?, description?, ac? }` with a refine ensuring at least one field is present; used by `PATCH /api/jira/issue/[key]`
- **`updateIssueFields()`**: Jira client function that writes summary, description, and/or AC to Jira; description and AC converted from Markdown to ADF via `markdownToAdf()` before the Jira API call
- **Manual + automatic ticket refresh**: `IssuePanel.tsx` has a facilitator-only "Refresh" button that calls `POST /api/jira/issue/[key]/refresh` (`refreshIssueSchema` in `schemas.ts`), which re-fetches the issue from Jira and broadcasts `issue:updated` — picks up edits made directly in Jira outside the app. `POST /api/jira/issue/[key]/attachments` triggers the same re-fetch + broadcast after a successful upload (non-fatal if the refresh fails) so every participant's attachment gallery updates without a manual reload
- **Sprint plan (multi-ticket selection)**: `sprint_plan_items` (migration 012) holds the facilitator's candidate set for the next sprint; `sessions.capacity_points` holds the bandwidth target. `src/lib/session/plan.ts` centralises `computePlanTotals` / `loadPlanState` / `broadcastPlanUpdate` so all three plan routes stay consistent. The UI is a **hybrid**: inline `+`/`✓` toggles in `IssueList` rows and an "Add to sprint plan" button in `IssuePanel`, a host-only `SprintPlanSheet` slide-over for capacity/destination/commit, and a `SprintPlanChip` in the header that every participant sees
- **Plan points are always read server-side**: `POST /plan` and `PATCH /plan { refresh: true }` call `getIssuePoints()` against Jira with the facilitator's credentials rather than trusting the client's cached issue list, which goes stale the moment points are written back mid-session. Re-pointing a ticket already in the plan also triggers a refresh via the `points:submitted` handler in `RoomClient`
- **A ticket's existing Jira assignee seeds the plan**: `getIssuePoints()` requests the `assignee` field, and both `POST /plan` and `PATCH /plan { refresh: true }` use it to fill `assignee_account_id` — so a ticket already assigned in Jira doesn't land in the plan looking unassigned. Two invariants: (1) it **only fills a gap**, never overriding an assignment the host made in this session (the plan is the source of truth once set), and (2) it only writes an accountId that is **already on the roster**, because commit pushes these accountIds back to Jira
- **A non-roster Jira assignee is offered, never auto-added**: when the ticket's Jira assignee isn't on the roster, `POST /plan` returns a `suggested_teammate` (`{ issue_key, account_id, display_name, email, avatar_url }`, typed in `plan.ts`) *alongside* the plan state — it is deliberately **not** broadcast, since it's a prompt for the host, not shared state. `RoomClient.handleAddToPlan` turns it into a toast with an "Add to team" action that `POST`s the roster row, mirrors the roster to localStorage, then `PATCH /plan/[key]`s the assignment (which only becomes valid once they're on the roster)
- **Plan broadcasts are full state**: `plan:updated` carries the entire `{ items, capacity_points, total_points, unpointed_count, destination, pending_removals }` object, so clients replace rather than merge. Supabase does not echo a broadcast back to its sender, so the mutating routes *also* return the fresh state and the host applies it optimistically from the HTTP response
- **Sprint commit batching + partial failure**: `moveIssuesToSprint()` chunks issue keys at `SPRINT_MOVE_BATCH_SIZE = 50` (Jira's hard per-request cap) and attempts each batch independently, so one bad batch doesn't discard prior successes. `POST /plan/commit` reports `{ moved, failed }`; failed keys stay in the plan for retry
- **Unpointed tickets in a plan**: allowed and counted as 0, surfaced via `unpointed_count` — the sheet badges each unpointed row and the total notes "n unpointed" so the capacity read-out is never silently wrong
- **Guest view of the sprint plan**: `SprintPlanSheet` takes a `readOnly` prop. In read-only mode it renders only the ticket list plus the totals/capacity progress bar — no capacity editor, no "Refresh totals", no per-row Remove, no destination/commit footer — and it skips the `/api/jira/sprints` board fetch (guests have no Jira credentials). `RoomClient` renders a second, read-only `SprintPlanSheet` for non-facilitators driven entirely by the `plan:visibility` broadcast. Guests **cannot dismiss it** — `showCloseButton` is off and `onOpenChange` is swallowed, so backdrop/Esc dismissal is ignored; the panel closes only when the host closes their sheet (or leaves)
- **Nested-button hazard in `IssueList`**: rows used to be a single `<button>`; the add-to-plan affordance required restructuring each row into a `<div>` holding the select button plus a separately positioned add button (a `<button>` inside a `<button>` is invalid HTML and breaks jsdom queries)
- **`SelectValue` needs an explicit formatter**: Base UI's `Select.Value` renders the *raw value*, so **every** `Select` must pass a children function — `<SelectValue>{(v) => label(v)}</SelectValue>` — or the trigger shows the stored value (a Jira `accountId`, a board/sprint/quick-filter id, or a lowercase filter key like `unpointed`) instead of the readable option text. `SprintPlanSheet` supplies `teammateName` / `boardName` / `sprintName`; `IssueList` supplies `boardName` / `sprintName` (mapping `backlog` → "Backlog") / `statusFilterName` / `pointFilterName` / `quickFilterName`. A `placeholder` alone is not enough — it only covers the empty-value case
- **Sprint teammates + assignment**: `sprint_teammates` (migration 013) holds the host's roster of real Jira users for the session, keyed by `accountId`; `sprint_plan_items.assignee_account_id` links a planned ticket to one of them. `TeammateRoster.tsx` renders above the capacity control in `SprintPlanSheet`, and the plan list is grouped by assignee with an **Unassigned** group last. `computeTeammateTotals()` in `plan.ts` derives per-person workload **client-side from full broadcast state**, so it can never drift from `items` and needs no extra wire format
- **`assignee_account_id` is deliberately not a foreign key**: removing a teammate nulls the column on their tickets (see `DELETE /plan/teammates/[accountId]`) so their work stays in the plan as unassigned. A cascading FK would silently delete tickets. Tickets pointing at an accountId no longer on the roster are also bucketed as unassigned by `computeTeammateTotals()`
- **Assignees are validated against the roster**: `PATCH /plan/[key]` rejects an `assignee_account_id` that isn't a `sprint_teammates` row for that session — otherwise a client could plant an arbitrary accountId that the commit route later pushes to Jira
- **Roster persists across sessions**: mirrored to `localStorage` under `pp_sprint_teammates` (`src/lib/session/teammate-storage.ts`, same pattern as `pp_display_name`) on every roster mutation. `RoomClient` `PUT`s it back on load **only when the session roster is empty**, so a rehydrate can never clobber a roster — and its assignments — already built in that room. All storage access is try/catch-guarded (localStorage throws in some privacy modes)
- **Jira assignee write-back is best-effort**: `POST /plan/commit` sets the Jira assignee per moved+assigned ticket *after* `moveIssuesToSprint`, reporting `{ assigned, assign_failed }`. A host lacking the *Assign Issues* permission must never undo a successful sprint move — same partial-failure philosophy as batched commits
- **`GET /api/jira/users`** is credential-gated (guests have no Jira credentials, so they cannot enumerate the host's instance) and translates Jira's 403 into an actionable "needs *Browse users and groups* permission" message. `JiraUser.emailAddress` is **optional** — GDPR-strict Jira sites omit it, so `accountId` is the only stable key. The guest `SprintPlanSheet` renders the roster but never calls this endpoint
- **`requireFacilitatorSession()`** in `plan.ts` collapses the auth → session lookup → facilitator check guard shared by the roster and assignment routes; it returns either a `{ error, status }` response descriptor or the session row
- **Team capacity is suggested from the roster**: `computeRosterCapacity()` in `plan.ts` sums the per-person `capacity_points`, returning `null` when nobody has a target (0 would be a misleading suggestion; teammates without a target simply contribute nothing, so a partly-filled roster yields a conservative floor). When the sum differs from `plan.capacity_points`, the sheet shows a host-only `data-testid="capacity-suggestion"` line with a **Use N** button that saves it straight through `saveCapacity()`. Derived client-side from broadcast state, like `computeTeammateTotals` — no new wire format
- **`SprintPlanSheet` is split into `Setup` / `Plan` tabs** (Setup first — it's the prerequisite): Setup holds the destination picker, the teammate roster and capacity (+ roster suggestion); Plan holds the assignee-grouped ticket list and pending removals. The landing tab is **Setup until a destination sprint is chosen, then Plan** — seeded once from `plan.destination?.sprint_id`, never re-derived, so it can't yank the host between tabs mid-session. Tab state is local and deliberately **not** broadcast; `plan:visibility` stays purely open/closed. Guests get the same two tabs
- **Base UI `Tabs` mounts only the active panel**, so component tests must switch tabs before asserting. `SprintPlanSheet.test.tsx` has `showPlan()` / `showSetup()` helpers for exactly this — reach for them rather than changing the default tab to suit a test
- **The totals + capacity bar is pinned outside the tabs** (`data-testid="plan-totals"`, between `SheetHeader` and `TabsList`): it is the number the host is planning against, so it survives both tab switches and scrolling
- **Per-teammate capacity is shown on the Plan tab, not just in the roster**: each assignee group header carries a `group-capacity-<key>` badge (`points/capacity pts`, coloured by `capacityStatus` via the exported `CAPACITY_STATUS_CLASSES`) plus a `group-bar-<key>` mini progress bar and a `group-remaining-<key>` line reading "n pts free" / "At capacity" / "n pts over capacity". A teammate with a per-person target but **no** tickets still renders an (empty) group — that person is precisely who the host is looking for — so the plan-tab empty state keys off `groups.length`, not `plan.items.length`. Teammates and the Unassigned bucket with no target show a plain total and no bar
- **Every teammate gets a group, ticket or no ticket**: the Plan tab renders one group per roster member and filters out only the **Unassigned** bucket when it's empty. An empty group shows "No tickets assigned yet." — a person with nothing assigned is exactly who the host is hunting for, so hiding them defeats the purpose. The one exception is a completely empty plan (`plan.items.length === 0`), where the "add some tickets" guidance beats a column of zeroes
- **Assignee groups collapse**: the group header is a `<button data-testid="group-toggle-<key>">` with `aria-expanded`/`aria-controls` that folds away that person's ticket list. The header, points badge and capacity bar **stay visible when collapsed** — the point is to keep the summary and drop the detail. Collapsed keys live in local `Set` state and are never broadcast, so one person folding a group can't hide it for everyone; guests can collapse too
- **The group accent encodes capacity, not identity**: `capacityAccent(state)` in `plan.ts` maps a `CapacityState` (`none`/`under`/`at`/`over`) to the same blue/green/red language as the points badge, so a card's left edge answers "who is overloaded?" at a glance. Groups with no per-person target — and the Unassigned bucket — get `border-l-muted-foreground/40`. This replaced `teammateAccent(index)`, whose alternating decorative hues meant nothing and invited readers to decode them
- **Group and row boundaries are deliberately different weights**: groups are `border-2` blocks with a `border-l-4` accent, a `bg-muted/40` header and a gap between them; rows inside use a plain `divide-y divide-border`. The teammate roster gets the same treatment (`rounded-md border divide-y`) so its rows read as rows and not free-floating text. The **Setup** tab uses the same card language: the destination picker (`destination-picker`), the roster (`teammate-roster`), the guest destination read-out and the capacity block (`capacity-section`) are each a `<section>` with `mx-3 my-3 rounded-md border-2 bg-card shadow-sm` and a `bg-muted/40 border-b-2` header strip, so configuration reads as a set of discrete cards rather than a stack of hairline-separated rows
- **The destination picker is the first thing in the Setup tab** (`data-testid="destination-picker"`): it is a prerequisite, since choosing a sprint is what pulls that sprint's existing tickets into the plan. The commit button stays in the footer, outside the tabs. Guests get a read-only destination line in the same position
- **The commit button never swaps to a "Plan another sprint" reset**: after a successful commit, `SprintPlanSheet` shows a transient "N tickets moved to \<sprint\>" line above the footer button but leaves the normal "Move tickets to sprint" / confirm flow in place (disabled via `canCommit` when there's nothing new to move) — the sheet, tabs, and destination picker all stay interactive so the host can keep adjusting the plan and commit again without an extra click to "unlock" the UI
- **The destination sprint is persisted state, not a UI selection**: `sessions.target_board_id` / `target_sprint_id` / `target_sprint_name` (migration 014) are written by `PUT /api/sessions/[code]/plan/destination` and travel to every client inside `plan:updated`, so guests and late joiners see the same target. `SprintPlanSheet` hydrates its selects from `plan.destination` rather than owning it
- **Plan items carry an `origin`**: `"sprint"` means the ticket was pulled from the destination sprint's real Jira contents; `"added"` means the host queued it during the session. Choosing a destination sprint calls `listSprintIssues()` and syncs those issues in as `origin: "sprint"` (pre-filling `assignee_account_id` when the Jira assignee is on the roster), so the capacity read-out reflects work **already** committed to the sprint instead of starting from zero. Switching sprints deletes the old sprint-origin rows and pulls the new sprint's; `origin: "added"` rows always carry over untouched. Picking "create new sprint" clears sprint-origin rows entirely
- **The roster-total suggestion is an explicit button**: `capacity-suggestion` is a dashed-border, muted-background strip holding the "Roster totals N pts" text and an **outline** `Use N pts` button (it was a ghost button beside muted copy, which read as static text). It shows "Applying…" while the PATCH is in flight
- **The plan re-syncs every time the host opens the sheet**: a `useEffect` keyed on `open` re-`PUT`s the *current* destination to `/plan/destination`, which re-pulls the sprint's real Jira contents (dropping stale sprint-origin rows, keeping host-added ones) and broadcasts the fresh state. Without it the plan was only ever as fresh as the last destination change, so issues moved into the sprint elsewhere never appeared. Guests and destination-less plans skip it; a failure is non-fatal and leaves the last known plan on screen rather than an error wall. A `plan-syncing` hint shows in the totals bar while it runs. The effect deliberately depends on `open` alone — it replaces `plan`, so depending on the destination would loop
- **Destination sync fails closed**: `listSprintIssues` runs *before* any DB write, so a Jira outage leaves both the destination and the plan exactly as they were (502, nothing persisted)
- **Removing a sprint-origin ticket is staged, not immediate**: `DELETE /plan/[key]` sets `removed = true` on `origin: "sprint"` rows (hard-deleting `origin: "added"` ones as before). Staged rows leave `items` for `pending_removals`, so they stop counting toward capacity, and on commit their keys are pushed back to the Jira backlog via `moveIssuesToBacklog()`. `PATCH /plan/[key] { removed: false }` undoes the staging — `planAssignSchema` uses `z.literal(false)` so this path can only *undo*, never stage
- **`moveIssuesToBacklog()`** mirrors `moveIssuesToSprint()`: batched at `SPRINT_MOVE_BATCH_SIZE`, independent per-batch attempts, `{ removed, failed }` partial-failure shape. Some next-gen/team-managed boards reject `/rest/agile/1.0/backlog/issue`, so a removal failure must never fail the commit — the row stays staged for retry
- **Commit no longer empties the plan**: it splits state three ways — `toMove` (`origin: "added"`), `alreadyInSprint` (`origin: "sprint"`, skipped, they're already there) and `toBacklog` (staged removals). Successfully moved rows flip to `origin: "sprint"` instead of being deleted, so the panel stays a live mirror of the sprint; failures stay `added` for retry. Committing with *only* removals is valid. Assignee write-back spans `toMove ∪ alreadyInSprint` so re-assigning an existing sprint ticket actually reaches Jira. Consequently the commit button in `SprintPlanSheet` must stay enabled — labelled "Sync assignee changes" — whenever the plan has *any* item at all, not just when there's something to move or remove; otherwise re-assigning a ticket that's already in the sprint has no way to reach Jira
- **Sprint issues are always read through the board**: `listSprintIssues(opts, boardId, sprintId, field)` calls `/rest/agile/1.0/board/{boardId}/sprint/{sprintId}/issue`, never the unscoped `/rest/agile/1.0/sprint/{id}/issue`. The unscoped route returns every issue in the sprint regardless of board, so a sprint shared across boards (or simply a repeated sprint name) leaked another board's tickets into both the issue list and the sprint plan. Consequently `GET /api/jira/issues` requires `boardId` alongside `sprintId` (400 otherwise), `IssueList` sends both, and `planDestinationSchema` refuses a `sprint_id` with a null `board_id`
- **`listSprintIssues` caps at `maxResults=100`** — a destination sprint holding more than 100 issues will silently undercount capacity. Paginate before relying on this for large sprints

### Supabase Client Usage
| Context | File | Notes |
|---------|------|-------|
| Browser | `src/lib/supabase/client.ts` | `createBrowserClient` |
| Server (request-scoped) | `src/lib/supabase/server.ts` | `createServerClient` with cookies |
| Service role (bypasses RLS) | `src/lib/supabase/service.ts` | For reveal tally, credential storage |

### Security Model
- Jira tokens encrypted with AES-256-GCM, key from `JIRA_ENCRYPTION_KEY` env var
- `jira_credentials` table RLS denies all access to anon/authenticated roles
- All Jira calls proxied through server-side API routes
- Story-points field defaults to `customfield_10026` — auto-detection was removed (unreliable); overridable per-credential in connect dialog

### File Structure Convention
```
src/
├── app/                    # Next.js App Router pages + API routes
│   ├── api/
│   │   ├── sessions/
│   │   │   ├── route.ts           # POST: create session
│   │   │   └── [code]/
│   │   │       ├── route.ts       # GET: fetch session by code
│   │   │       ├── join/route.ts  # POST: add participant (upsert)
│   │   │       ├── vote/route.ts  # POST: upsert vote (1,2,3,5)
│   │   │       ├── reveal/route.ts         # GET: tally for late joiners; POST: tally + broadcast (facilitator)
│   │   │       ├── clear/route.ts          # POST: reset + next round (facilitator)
│   │   │       ├── select-issue/route.ts   # GET: current issue for late joiners; POST: reset state + fetch issue + broadcast
│   │   │       ├── end/route.ts            # POST: broadcast session:ended + delete session (facilitator); sendBeacon target
│   │   │       ├── kick/route.ts           # POST: broadcast kick + delete participant + votes (facilitator)
│   │   │       └── plan/
│   │   │           ├── route.ts            # GET: hydrate plan (any participant); POST: add issue (facilitator, server-side Jira points + assignee fetch, may return suggested_teammate); PATCH: set capacity / refresh points+assignees
│   │   │           ├── [key]/route.ts      # PATCH: assign/unassign to a teammate; DELETE: remove one plan item (facilitator)
│   │   │           ├── teammates/
│   │   │           │   ├── route.ts        # POST: add teammate; PATCH: per-person capacity; PUT: bulk-merge host's stored roster
│   │   │           │   └── [accountId]/route.ts # DELETE: remove teammate + unassign their tickets
│   │   │           ├── destination/route.ts # PUT: persist target board/sprint + sync that sprint's issues into the plan (facilitator)
│   │   │           └── commit/route.ts     # POST: create-or-select sprint + batched issue move + backlog removals + plan:committed (facilitator)
│   │   └── jira/
│   │       ├── attachment/[id]/route.ts # GET: proxy attachment bytes (participant + current-issue scoped)
│       ├── connect/route.ts   # GET/POST/DELETE: Jira credential management
│   │       ├── users/route.ts     # GET: search Jira users for the sprint roster (credential-gated)
│   │       ├── sprints/route.ts   # GET: boards + sprints (scoped by project_key)
│   │       ├── issues/route.ts    # GET: sprint issues or backlog issues
│   │       └── issue/[key]/
│   │           ├── route.ts       # GET: issue detail; PUT: write story points; PATCH: edit summary/description/AC (facilitator only)
│   │           ├── attachments/route.ts # POST: upload image attachment (facilitator only); re-fetches + broadcasts issue:updated
│   │           └── refresh/route.ts     # POST: re-fetch issue from Jira + broadcast issue:updated (facilitator only)
│   ├── session/[code]/
│   │   ├── page.tsx               # Server component: fetch session
│   │   └── RoomClient.tsx         # Client component: realtime room
│   └── page.tsx                   # Home page (create/join)
├── components/
│   ├── ui/                # shadcn components (never edit directly)
│   ├── room/              # Room-specific components
│   │   ├── JoinDialog.tsx
│   │   ├── CardDeck.tsx
│   │   ├── ParticipantList.tsx
│   │   ├── VoteReveal.tsx
│   │   ├── FacilitatorControls.tsx
│   │   ├── ShareLink.tsx
│   │   ├── JiraConnectDialog.tsx  # Jira credentials form (email, token, URL, project key, SP field)
│   │   ├── IssueList.tsx          # Sheet: board/sprint selector + issue list + backlog + add-to-plan toggle
│   │   ├── IssuePanel.tsx         # Active issue card + points submit (facilitator post-reveal) + add-to-plan
│   │   ├── SprintPlanChip.tsx     # Header chip: plan count + total/capacity (all participants); sheet trigger for host
│   │   ├── TeammateRoster.tsx     # Sprint roster: Jira user typeahead, per-person capacity + assigned total
│   │   └── SprintPlanSheet.tsx    # Slide-over: pinned totals + Plan/Setup tabs (tickets vs destination/capacity/roster) + commit footer (read-only copy for guests)
│   └── providers/
│       └── AuthProvider.tsx  # Anonymous auth context (wraps layout)
├── lib/
│   ├── supabase/          # Client configs + generated types
│   ├── session/           # Session logic (codes, realtime hooks)
│   │   ├── codes.ts       # 6-char code generator
│   │   ├── plan.ts        # Sprint plan types, PLAN_SESSION_COLUMNS, computePlanTotals, computeTeammateTotals, computeRosterCapacity, capacityAccent, loadPlanState, broadcastPlanUpdate, requireFacilitatorSession
│   │   ├── teammate-storage.ts # Cross-session roster in localStorage (pp_sprint_teammates)
│   │   └── realtime.ts    # useSessionChannel hook (Presence + Broadcast)
│   ├── jira/              # Jira client, encryption, types
│   │   ├── client.ts      # loadCredentials, getIssue, detectAcField, updateStoryPoints, updateIssueFields, listBoards, createSprint, moveIssuesToSprint, moveIssuesToBacklog, getIssuePoints, searchUsers, updateIssueAssignee, etc.
│   │   ├── adf-markdown.ts# ADF↔Markdown conversion (adfToMarkdown, markdownToAdf)
│   │   ├── encryption.ts  # AES-256-GCM encrypt/decrypt
│   │   └── types.ts       # JiraIssue, JiraSprint, JiraBoard, AdfNode, AdfMark, etc.
│   └── validation/
│       └── schemas.ts     # Zod schemas: joinSession, vote, jiraConnect, pointsSubmit, selectIssue, issueUpdate, planAdd, planUpdate, planCommit, planAssign, planDestination, teammateAdd, teammateUpdate, teammateBulk
├── middleware.ts           # Supabase auth session refresh
└── test/
    ├── setup.ts
    ├── mocks/
    │   └── supabase.ts
    ├── lib/
    │   ├── session/codes.test.ts
    │   └── jira/
    │       ├── encryption.test.ts
    │       └── adf-markdown.test.ts
    ├── api/
    │   ├── sessions-create.test.ts
    │   ├── sessions-get.test.ts
    │   ├── sessions-join.test.ts
    │   ├── sessions-vote.test.ts
    │   ├── sessions-reveal.test.ts
    │   ├── sessions-clear.test.ts
    │   ├── sessions-end.test.ts
│   ├── sessions-kick.test.ts
    │   ├── sessions-select-issue.test.ts
    │   ├── sessions-plan.test.ts
    │   ├── sessions-plan-delete.test.ts
    │   ├── sessions-plan-commit.test.ts
    │   ├── sessions-plan-destination.test.ts
    │   ├── sessions-plan-teammates.test.ts
    │   ├── sessions-plan-teammate-delete.test.ts
    │   ├── jira-attachment.test.ts
    │   ├── jira-board-config.test.ts
    │   ├── jira-connect.test.ts
    │   ├── jira-issue-attachments.test.ts
    │   ├── jira-issue-refresh.test.ts
    │   ├── jira-issue-key.test.ts
    │   ├── jira-issues.test.ts
    │   ├── jira-sprints.test.ts
    │   └── jira-users.test.ts
    ├── lib/
    │   ├── jira/
    │   │   ├── adf-markdown.test.ts
    │   │   ├── client.test.ts
    │   │   └── encryption.test.ts
    │   ├── session/
    │   │   ├── codes.test.ts
    │   │   ├── plan.test.ts
    │   │   ├── teammate-storage.test.ts
    │   │   └── realtime.test.ts
    │   ├── utils.test.ts
    │   └── validation/schemas.test.ts
    └── components/
        ├── CardDeck.test.tsx
        ├── ConsensusModal.test.tsx
        ├── FacilitatorControls.test.tsx
        ├── IssueList.test.tsx
        ├── IssuePanel.test.tsx
        ├── JiraConnectDialog.test.tsx
        ├── JoinDialog.test.tsx
        ├── ParticipantList.test.tsx
        ├── ShareLink.test.tsx
        ├── SprintPlanChip.test.tsx
        ├── SprintPlanSheet.test.tsx
        ├── VoteReveal.test.tsx
        └── ui/
            ├── Avatar.test.tsx
            └── Dialog.test.tsx
supabase/
├── config.toml
├── migrations/            # Numbered SQL migrations (001-014)
└── tests/                 # pgTAP RLS tests (27 tests)
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
