# Pointing Poker Plus

A real-time, browser-based sprint estimation tool with Jira integration. Teams vote on stories simultaneously, the facilitator reveals votes, and agreed story points write back to Jira automatically.

## Features

- **Real-time voting** — join via a shareable code or link, pick a card (1, 2, 3, 5), see live presence and vote counts without values leaking before reveal
- **Facilitator-controlled flow** — only the facilitator can reveal votes, clear rounds, and confirm the final estimate
- **Jira integration** — connect a session to a sprint, browse stories, select one for estimation, and push agreed points back to Jira
- **No account required** — anonymous auth gives each participant a stable identity with zero sign-up friction

## Prerequisites

- Node.js 20+ (managed via nvm)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (required by Supabase local dev)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Start local Supabase

```bash
npx supabase start
```

This starts a local Postgres + Realtime instance. Note the output — you'll need the API URL, anon key, and service role key.

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in the values from `npx supabase status`:

```bash
cp .env.example .env.local
```

Required variables:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Local Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS) |
| `JIRA_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption of Jira tokens |

### 4. Apply database migrations

```bash
npx supabase db reset
```

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. **Create a session** — click "New Session" on the home page, enter your name
2. **Share the room link** — copy the link from the room and send it to your team
3. **Vote** — each participant picks a card; vote values stay hidden until reveal
4. **Reveal** — the facilitator clicks Reveal to show all votes and the tally
5. **Connect Jira** *(optional)* — the facilitator can connect Jira credentials, browse sprint issues, select a story, and submit agreed points directly to Jira

## Development Commands

```bash
# Dev server
npm run dev

# Build (must pass before committing)
npm run build

# Lint
npm run lint

# Tests (always prefix with nvm use 20)
npm run test:run   # single run
npm test           # watch mode

# Database
npx supabase db reset        # rerun all migrations
npx supabase test db         # RLS policy tests
npx supabase stop
```

## Tech Stack

| Concern | Choice |
|---------|--------|
| Frontend + API | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS + shadcn/ui |
| Real-time sync | Supabase Realtime (Broadcast + Presence) |
| Database | Supabase Postgres with Row-Level Security |
| Testing | Vitest + Testing Library |

## Security Notes

- Jira API tokens are encrypted at rest with AES-256-GCM — never stored in plaintext or returned to the client
- All Jira calls are proxied through server-side API routes
- Vote values are hidden from all clients until the facilitator reveals them (enforced by RLS)
- Facilitator-only actions (reveal, clear, submit points) are validated server-side
