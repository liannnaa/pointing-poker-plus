# Deployment Guide

This app can be deployed on **Vercel** (external, free) with a **Supabase** project for the database, realtime, and auth layers.

## Architecture

```
vercel --prod → Vercel builds → https://your-app.vercel.app
                                                    │
                                                    ▼
                                        supabase.com (project)
                                        Postgres + Realtime + Auth
```

---

## One-time setup

### 1. Create a Supabase project (~5 min)

1. Go to [supabase.com](https://supabase.com) → New project (free tier)
2. Once it spins up, link and push migrations from your local machine:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase push
   ```
3. Add API keys to .env.local
   ```bash
   npx supabase status
   ```
   - `NEXT_PUBLIC_SUPABASE_URL` -> Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` -> Publishable
   - `SUPABASE_SERVICE_ROLE_KEY` -> Secret
3. Go to **Settings → API** and add values to .env.production:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

4. Generate the Jira encryption key:
   ```bash
   openssl rand -hex 32
   ```
   This becomes `JIRA_ENCRYPTION_KEY`.

### 2. Deploy to Vercel (~5 min)

1. Go to [vercel.com](https://vercel.com) → Import Project → connect your GitHub repo
2. In **Settings → Environment Variables**, add all 4 values from step 1
3. Install the Vercel CLI if you haven't already:
   ```bash
   npm i -g vercel
   ```
4. Deploy to production:
   ```bash
   vercel --prod
   ```
   Vercel auto-detects Next.js — no config changes needed.

To redeploy after changes, run `vercel --prod` again from the project root.

---

## Environment variables

See `.env.example` for the full list. All 4 must be set in Vercel:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API |
| `JIRA_ENCRYPTION_KEY` | Generate once: `openssl rand -hex 32` |

> The `JIRA_ENCRYPTION_KEY` encrypts Jira tokens at rest. Because everyone shares one deployment, there is only one key — no coordination needed between teammates.

---

## Verification checklist

- [ ] `npm run build` passes locally
- [ ] First Vercel deploy completes green
- [ ] Open the URL → create a session
- [ ] Two teammates join the same session code and see each other's votes in real-time
- [ ] (Optional) Test Jira connect flow with a real Jira token