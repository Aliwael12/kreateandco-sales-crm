# Firebase → Supabase Migration Runbook

Zero-data-loss migration of the kreateandco Sales CRM from Firebase (Firestore + Auth)
to Supabase (Postgres + Auth). Big-bang cutover with a short maintenance window.

**Target project:** `qhcptigbbhrnxgechsrl` (Sales CRM, eu-west-1).

---

## 0. What's already done (by the migration build)

- ✅ Postgres schema applied (`migration/sql/01_schema.sql`) — all 9 tables.
- ✅ RLS policies applied (`migration/sql/02_rls.sql`) — faithful translation of
  `firestore.rules` (28 policies, RLS on all tables).
- ✅ UID mapping verified: JS `fbUidToUuid` ≡ Postgres `migration.fb_uid_to_uuid`
  (deterministic UUIDv5 — proven byte-identical).
- ✅ Frontend rewritten to Supabase (`tsc -b`, `vite build`, `eslint` all green).
- ✅ `api/createUser.ts` ported to Supabase service-role.
- ✅ `daily-reminder-digest` ported to a Supabase Edge Function + pg_cron.

You run the data migration (steps below) when ready.

---

## 1. Prerequisites (gather once)

| Item | Where to get it |
|---|---|
| **Firebase service-account JSON** | Firebase Console → Project settings → Service accounts → *Generate new private key*. Save as `service-account.json` at repo root (gitignored). |
| **Firebase scrypt params** | Firebase Console → Authentication → (⋮ menu top-right of Users table) → *Password hash parameters*. Copy `base64_signer_key`, `base64_salt_separator`, `rounds`, `mem_cost` into `migration/data/scrypt.json` (copy from `scrypt.json.example`). **Without these, passwords cannot be carried over.** |
| **Supabase DB connection string** | Supabase Dashboard → Project Settings → Database → *Connection string (URI)*. Used as `SUPABASE_DB_URL`. |
| **Supabase anon key + URL** | Project Settings → API. For the app's `.env.local` / Vercel. |
| **Supabase service-role key** | Project Settings → API → `service_role`. For `api/createUser.ts` + the Edge Function. **Secret.** |

Install migration deps:

```bash
cd migration && npm install   # firebase-admin + pg
```

---

## 2. Dry run (NO downtime — do this first, days before)

Practice the whole thing against the live Supabase project while Firebase keeps
serving traffic. The import is idempotent (UPSERT), so a dry run followed by the
real run is safe.

```bash
# from repo root
node migration/export.mjs                       # → migration/data/{firestore,auth,manifest}.json
SUPABASE_DB_URL="postgres://..." node migration/import.mjs
SUPABASE_DB_URL="postgres://..." node migration/verify.mjs
```

- Read `migration/data/manifest.json` for counts + warnings (auth accounts with
  no profile, profiles with no auth, passwordless accounts).
- `verify.mjs` exits non-zero if ANY row/field mismatch is found. Investigate
  every discrepancy before cutover. A clean run prints `✓✓ PASS`.

> The dry run leaves real data in Supabase. That's fine — the final run will
> UPSERT over it. If you'd rather start clean, truncate first (see §7 rollback).

---

## 3. Cutover (maintenance window)

Announce a short window to the team. Then:

1. **Freeze writes.** Easiest: take the app offline (Vercel → Deployments →
   disable, or put up a maintenance page). This guarantees the export snapshot
   is the final state — nothing changes underneath you.

2. **Final export** (captures the last writes):
   ```bash
   node migration/export.mjs
   ```

3. **Import** into Supabase:
   ```bash
   SUPABASE_DB_URL="postgres://..." node migration/import.mjs
   ```
   The import runs in a single transaction — on any error it rolls back and
   commits nothing.

4. **Verify zero loss** (gates the go/no-go):
   ```bash
   SUPABASE_DB_URL="postgres://..." node migration/verify.mjs
   ```
   Must print `✓✓ PASS`. If it fails, DO NOT proceed — fix and re-run (idempotent).

5. **Point the app at Supabase.** In Vercel → Settings → Environment Variables:
   - `VITE_SUPABASE_URL = https://qhcptigbbhrnxgechsrl.supabase.co`
   - `VITE_SUPABASE_ANON_KEY = <anon key>`
   - `SUPABASE_URL = https://qhcptigbbhrnxgechsrl.supabase.co` (server)
   - `SUPABASE_SERVICE_ROLE_KEY = <service_role key>` (server)
   - Remove the old `VITE_FIREBASE_*` and `FIREBASE_SERVICE_ACCOUNT` vars.

6. **Redeploy** the app (it's already built against Supabase on this branch).

7. **Smoke test** (see §5).

8. **Re-open** the app to the team.

---

## 4. Deploy the scheduled digest (after cutover)

```bash
npm i -g supabase                       # or use npx
supabase login                          # or export SUPABASE_ACCESS_TOKEN
supabase link --project-ref qhcptigbbhrnxgechsrl
supabase functions deploy daily-reminder-digest --no-verify-jwt
supabase secrets set RESEND_API_KEY="re_..." DIGEST_FROM_EMAIL="kreateandco <crm@yourdomain.com>"
```

Then schedule it: open `supabase/sql/03_cron.sql`, fill in `<PROJECT_REF>` and
`<SERVICE_ROLE_KEY>`, and run it in the dashboard SQL editor. Verify with
`select * from cron.job;`.

---

## 5. Smoke test checklist

- [ ] Existing user signs in with their **old password** (proves scrypt import).
- [ ] Change-password works (Settings).
- [ ] Dashboard metrics + merchant count load.
- [ ] Pipeline board: drag a deal → status updates; reminder auto-created.
- [ ] My Projects: inline edits save; merchant search works.
- [ ] Rep account sees only their own deals/tasks/reminders (RLS scoping).
- [ ] Admin creates a new user (`/api/createUser`) → they can sign in.
- [ ] Activity log shows entries (admin/BD only).
- [ ] CSV import (Admin) creates merchants + deals.

---

## 6. Post-cutover

- **Rotate the Supabase access token** that was shared during setup
  (`sbp_...`) at supabase.com/dashboard/account/tokens → revoke + regenerate;
  update the MCP config env var.
- Keep Firebase **read-only** for ~2 weeks as a safety net before deleting.
- `migration/data/*.json` contain real customer data + password hashes — keep
  them out of git (already gitignored) and delete the local copies once stable.
- The old `functions/` dir (Firebase Cloud Functions) and `firestore.rules` are
  now superseded by the Edge Function + RLS; remove them in a follow-up cleanup.

---

## 7. Rollback

The cutover is reversible because Firebase is untouched by the migration
(export only reads it):

- **Before re-opening:** just point Vercel env vars back at Firebase and
  redeploy. Firebase still has all the data.
- **To reset Supabase and retry:** truncate and re-import.
  ```sql
  truncate table public.activities, public.tasks, public.reminders,
    public.deals, public.merchants, public.industries, public.stages,
    public.projects, public.users restart identity cascade;
  -- auth users:
  delete from auth.users;
  ```
  Then re-run `import.mjs` (idempotent).

If you cut over and discover an issue *after* the team has written new data to
Supabase, rolling back to Firebase means those new writes are only in Supabase —
so decide fast within the window. This is why the verify step gates go/no-go.
