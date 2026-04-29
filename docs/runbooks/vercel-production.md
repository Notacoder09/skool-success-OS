# Production on Vercel (Day 14)

This runbook assumes the GitHub repo is connected to Vercel and environment variables are set in the **Vercel project → Settings → Environment Variables**.

## Custom domain (`coursesuccess.io`)

1. Vercel project → **Settings → Domains** → Add `coursesuccess.io` and `www.coursesuccess.io` (redirect `www` to apex or vice versa).
2. At your DNS provider, add the **A/CNAME records** Vercel shows (usually apex → `76.76.21.x` or CNAME to `cname.vercel-dns.com`).
3. Set **`NEXT_PUBLIC_APP_URL`** = `https://coursesuccess.io` for Production (and Preview if previews use previews URL).
4. **Resend:** Add `coursesuccess.io` as a sending domain (SPF/DKIM), then set **`RESEND_FROM`** e.g. `CourseSuccess &lt;noreply@coursesuccess.io&gt;`.

## Cron jobs

Cron routes (see root `vercel.json`):

- `/api/cron/sync` — every 6 hours
- `/api/cron/flashcards` — hourly
- `/api/cron/weekly-reports` — hourly

**Requirements**

- **`CRON_SECRET`** must be set (same value in Vercel and in any manual `curl` tests).
- Vercel automatically sends `Authorization: Bearer &lt;CRON_SECRET&gt;` for cron-invoked routes; do not rename that unless you update the routes.

**Verify after deploy**

1. Vercel → **Deployments** → open latest production deployment → **Functions** tab — confirm cron jobs are scheduled.
2. **Logs**: open `api/cron/sync` after deployment; first run should return `200` JSON with `ranAt` and per-community summaries or `500` only if secrets/DB missing.
3. Optionally trigger manually (replace placeholders):

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "https://coursesuccess.io/api/cron/sync"
```

## Neon / database

Production must use Neon connection strings (**not** localhost). Prefer:

- **`DATABASE_URL`** — direct/host for migrations if needed.
- **`DATABASE_URL_POOLED`** — for serverless; app may prefer pooled at runtime — follow `src/db/` usage.

Run migrations once against production (from CI or locally with prod URL — protect credentials):

```bash
unset DATABASE_URL_POOLED && npm run db:migrate
```

## Sign-in URLs

Magic links use **`NEXT_PUBLIC_APP_URL`**. Wrong origin = callbacks land on localhost or stale domain.

## Beta invite list

Set **`BETA_INVITE_EMAILS`** to a comma-separated list for invite-only launches. Omit or leave empty for open sign-ups.
