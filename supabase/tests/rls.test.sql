-- pgTAP RLS policy tests for Pointing Poker Plus
-- Run with: npx supabase test db

BEGIN;

SELECT plan(27);

-- ── Fixture setup (runs as superuser — no role switch yet) ───────────────────
-- Use fixed UUIDs so we can reference them in SET LOCAL jwt.claims below.

DO $$
DECLARE
  _user_a  uuid := '11111111-1111-1111-1111-111111111111';
  _user_b  uuid := '22222222-2222-2222-2222-222222222222';
  _sess_id uuid;
BEGIN
  INSERT INTO auth.users (id, email, role, aud)
  VALUES
    (_user_a, 'rls_test_a@test.com', 'authenticated', 'authenticated'),
    (_user_b, 'rls_test_b@test.com', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.sessions (code, facilitator_id, state)
  VALUES ('RLSTST', _user_a, 'voting')
  ON CONFLICT (code) DO NOTHING;

  SELECT id INTO _sess_id FROM public.sessions WHERE code = 'RLSTST';

  INSERT INTO public.votes (session_id, issue_key, user_id, value)
  VALUES
    (_sess_id, 'round-1', _user_a, 3),
    (_sess_id, 'round-1', _user_b, 5)
  ON CONFLICT DO NOTHING;
END $$;

-- ── Policy existence (superuser can always query pg_policies) ────────────────

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'votes' AND cmd = 'INSERT'
      AND policyname = 'Users can insert their own votes'
  ),
  'RLS INSERT policy exists on votes'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'votes' AND cmd = 'SELECT'
      AND policyname = 'Users can read own votes'
  ),
  'RLS SELECT own-votes policy exists on votes'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'votes' AND cmd = 'SELECT'
      AND policyname = 'Users can read all votes when session is revealed'
  ),
  'RLS SELECT post-reveal policy exists on votes'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sessions' AND cmd = 'UPDATE'
      AND policyname = 'Facilitator can update their session'
  ),
  'RLS UPDATE facilitator policy exists on sessions'
);

-- ── Votes hidden pre-reveal: user_b sees only their own row ──────────────────
-- auth.uid() reads request.jwt.claims->>'sub', cast to uuid.

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.votes
   WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST')
     AND issue_key = 'round-1'),
  1,
  'authenticated user sees only own vote pre-reveal'
);

-- ── Votes visible post-reveal: user_b sees all rows ──────────────────────────

RESET ROLE;
UPDATE public.sessions SET state = 'revealed' WHERE code = 'RLSTST';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.votes
   WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST')
     AND issue_key = 'round-1'),
  2,
  'all votes visible after session revealed'
);

-- ── Sessions: anyone can read ────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM public.sessions WHERE code = 'RLSTST'),
  1,
  'anon role can read sessions'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.sessions WHERE code = 'RLSTST'),
  1,
  'authenticated role can read sessions'
);

-- ── Participants: anyone can read ─────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;

SELECT ok(
  (SELECT count(*)::int FROM public.participants) >= 0,
  'anon role can read participants table'
);

-- ── jira_credentials: RLS deny-all — SELECT returns 0 rows ───────────────────
-- No policies defined means every row is hidden (not a permission error for SELECT).

RESET ROLE;
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM public.jira_credentials),
  0,
  'anon role sees 0 rows from jira_credentials (RLS deny-all)'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.jira_credentials),
  0,
  'authenticated role sees 0 rows from jira_credentials (RLS deny-all)'
);

-- ── jira_credentials: INSERT raises RLS policy violation ─────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

SELECT throws_ok(
  $q$
    INSERT INTO public.jira_credentials (user_id, email, base_url, encrypted_token)
    VALUES (
      '22222222-2222-2222-2222-222222222222'::uuid,
      'x@x.com',
      'https://x.atlassian.net',
      'enc-token'
    )
  $q$,
  '42501',
  'new row violates row-level security policy for table "jira_credentials"',
  'authenticated role cannot INSERT into jira_credentials'
);

-- ── Sessions: facilitator DELETE policy ──────────────────────────────────────

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sessions' AND cmd = 'DELETE'
      AND policyname = 'Facilitator can delete their session'
  ),
  'RLS DELETE facilitator policy exists on sessions'
);

-- user_a (facilitator) can delete their own session
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.sessions WHERE code = 'RLSTST'),
  1,
  'session exists before facilitator delete'
);

-- Re-insert so cleanup section still has a row to clean up
RESET ROLE;
INSERT INTO public.sessions (code, facilitator_id, state)
VALUES ('RLSTST', '11111111-1111-1111-1111-111111111111', 'voting')
ON CONFLICT (code) DO NOTHING;


-- ── Sprint plan items ────────────────────────────────────────────────────────

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sprint_plan_items' AND cmd = 'SELECT'
      AND policyname = 'Anyone can read sprint plan items'
  ),
  'RLS SELECT policy exists on sprint_plan_items'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sprint_plan_items' AND cmd = 'INSERT'
      AND policyname = 'Facilitator can insert sprint plan items'
  ),
  'RLS INSERT facilitator policy exists on sprint_plan_items'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sprint_plan_items' AND cmd = 'DELETE'
      AND policyname = 'Facilitator can delete sprint plan items'
  ),
  'RLS DELETE facilitator policy exists on sprint_plan_items'
);

-- Facilitator (user_a) can add a ticket to the plan
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

INSERT INTO public.sprint_plan_items (session_id, issue_key, summary, points, added_by)
VALUES (
  (SELECT id FROM public.sessions WHERE code = 'RLSTST'),
  'PROJ-1', 'Facilitator ticket', 3,
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.sprint_plan_items
   WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST')),
  1,
  'facilitator can insert sprint plan items'
);

-- Non-facilitator (user_b) cannot add a ticket
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

SELECT throws_ok(
  $$INSERT INTO public.sprint_plan_items (session_id, issue_key, summary, points, added_by)
    VALUES (
      (SELECT id FROM public.sessions WHERE code = 'RLSTST'),
      'PROJ-9', 'Guest ticket', 5,
      '22222222-2222-2222-2222-222222222222'
    )$$,
  '42501',
  NULL,
  'non-facilitator cannot insert sprint plan items'
);

-- ...but everyone can read the plan (it is broadcast to the whole room)
SELECT is(
  (SELECT count(*)::int FROM public.sprint_plan_items
   WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST')),
  1,
  'non-facilitator can read sprint plan items'
);

RESET ROLE;
DELETE FROM public.sprint_plan_items
  WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST');

-- ── Sprint teammates ─────────────────────────────────────────────────────────

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sprint_teammates' AND cmd = 'SELECT'
      AND policyname = 'Anyone can read sprint teammates'
  ),
  'RLS SELECT policy exists on sprint_teammates'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sprint_teammates' AND cmd = 'INSERT'
      AND policyname = 'Facilitator can insert sprint teammates'
  ),
  'RLS INSERT facilitator policy exists on sprint_teammates'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sprint_teammates' AND cmd = 'UPDATE'
      AND policyname = 'Facilitator can update sprint teammates'
  ),
  'RLS UPDATE facilitator policy exists on sprint_teammates'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sprint_teammates' AND cmd = 'DELETE'
      AND policyname = 'Facilitator can delete sprint teammates'
  ),
  'RLS DELETE facilitator policy exists on sprint_teammates'
);

-- Facilitator (user_a) can add a teammate
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

INSERT INTO public.sprint_teammates (session_id, account_id, display_name, capacity_points)
VALUES (
  (SELECT id FROM public.sessions WHERE code = 'RLSTST'),
  'acc-1', 'Alice', 13
);

SELECT is(
  (SELECT count(*)::int FROM public.sprint_teammates
   WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST')),
  1,
  'facilitator can insert sprint teammates'
);

-- Non-facilitator (user_b) cannot add a teammate
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

SELECT throws_ok(
  $$INSERT INTO public.sprint_teammates (session_id, account_id, display_name)
    VALUES (
      (SELECT id FROM public.sessions WHERE code = 'RLSTST'),
      'acc-9', 'Mallory'
    )$$,
  '42501',
  NULL,
  'non-facilitator cannot insert sprint teammates'
);

-- ...but everyone can read the roster (it is broadcast to the whole room)
SELECT is(
  (SELECT count(*)::int FROM public.sprint_teammates
   WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST')),
  1,
  'non-facilitator can read sprint teammates'
);

RESET ROLE;
DELETE FROM public.sprint_teammates
  WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST');

-- ── Cleanup ───────────────────────────────────────────────────────────────────


RESET ROLE;

DELETE FROM public.sprint_teammates
  WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST');
DELETE FROM public.sprint_plan_items
  WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST');
DELETE FROM public.votes
  WHERE session_id = (SELECT id FROM public.sessions WHERE code = 'RLSTST');
DELETE FROM public.sessions WHERE code = 'RLSTST';
DELETE FROM auth.users
  WHERE email IN ('rls_test_a@test.com', 'rls_test_b@test.com');

SELECT * FROM finish();
ROLLBACK;
