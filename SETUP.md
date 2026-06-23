# kreateandco Sales Platform — Setup Guide

This document walks you through getting the CRM running locally, bootstrapping
the first admin, deploying security rules, and shipping to Vercel.

Phase 1 delivers: login + Dashboard + My Projects, with real-time Firestore
sync and security rules in place. Pipeline, All Merchants, Reminders,
Activities, Admin, and the Google Sheets importer land in later phases.

---

## 1. Local development

```sh
cd E:\kreateandco-sales-crm
npm install      # already done if you just scaffolded
npm run dev
```

The dev server runs at `http://localhost:5173`. The Firebase config is read
from `.env.local` (already populated with your `kreateandco-sales-crm` project).

---

## 2. Firebase Console — one-time setup

You said you've already created the Firebase project. The remaining steps:

### 2a. Enable Email/Password sign-in

1. Firebase Console → **Authentication** → **Sign-in method**
2. Enable **Email/Password** (leave passwordless link disabled)
3. Save

### 2b. Create the Firestore database (if you haven't)

1. **Firestore Database** → **Create database**
2. Pick **Production mode** (locked rules)
3. Region: pick the one closest to your team — for Cairo, choose `eur3
   (europe-west)`. **This cannot be changed later.**

### 2c. Bootstrap the first admin (one command)

The `scripts/bootstrap-admin.mjs` script creates the Firebase Auth
account *and* the Firestore profile in one shot. You just need a
service-account key (downloaded once).

**One-time: get a service account key.**

1. Firebase Console → **Project settings** (gear icon) → **Service
   accounts** → **Generate new private key** → confirm.
2. Save the downloaded JSON as `service-account.json` in the project
   root. It's already in `.gitignore` so it won't get committed.

**Run the script.**

```sh
npm run bootstrap-admin -- \
  --email m.nassif@st-lr.com \
  --password "Mario@Nassif26" \
  --name "Mario Nassif"
```

You should see:

```
→ Bootstrapping Admin: m.nassif@st-lr.com
  · Auth user created (uid: ...)
  · Firestore profile created
✓ Done. Sign in at the app with m.nassif@st-lr.com / ...
```

The script is idempotent — re-running it just refreshes the password
and profile. To add other admins later (before the Admin page lands in
Phase 3), run it again with different email/name. Once the Admin UI is
live, you'll create users through the app instead.

### 2d. Seed initial projects + stages (one-time, manual for Phase 1)

Until the Admin UI lands, add these manually in Firestore.

**Collection `projects`** — add one document per project, with auto-ID:

| Field       | Type      | Value                          |
|-------------|-----------|--------------------------------|
| `name`      | string    | `Stamps` (etc.)                |
| `color`     | string    | `#5B4FCF`                      |
| `createdAt` | timestamp | (Set to current)               |
| `updatedAt` | timestamp | (Set to current)               |

Then add the project document ID to your user's `projectIds` array.

**Collection `stages`** — add the seven default stages, auto-ID each:

| name                          | color     | order | locked |
|-------------------------------|-----------|-------|--------|
| Initial Contact               | `#6b7280` | 0     | false  |
| Missed Call                   | `#b87209` | 1     | false  |
| Follow Up                     | `#c62828` | 2     | false  |
| Not Interested                | `#d63c2e` | 3     | false  |
| Negotiating                   | `#1565c0` | 4     | false  |
| Waiting for Requirements      | `#6d28d9` | 5     | false  |
| Signed                        | `#0f9e6e` | 6     | true   |

Each also needs a `createdAt` timestamp.

> Phase 3 brings the Admin UI which lets you do all of this through the app.

---

## 3. Deploy Firestore security rules

The rules in `firestore.rules` enforce the role model server-side. To
deploy them you need the Firebase CLI:

```sh
npm install -g firebase-tools
firebase login
firebase use kreateandco-sales-crm
firebase deploy --only firestore:rules,firestore:indexes
```

**Until rules are deployed, your Firestore is wide open in test mode (or
denying everything in production mode)** — deploy them before adding any
real data.

---

## 4. Server-side: creating team members

Creating a team member needs the Firebase **Admin SDK** (it makes an Auth
account and writes the Firestore profile with elevated privileges). That
can't run in the browser, so it runs server-side.

> **Why not a Firebase Cloud Function?** Cloud Functions require the
> Firebase **Blaze (pay-as-you-go)** plan. This project stays on the free
> **Spark** plan, so `createUser` runs as a **Vercel Serverless Function**
> instead — `api/createUser.ts`. It's served from the same origin as the
> app, so there's no CORS to configure. The old Cloud Function in
> `functions/src/index.ts` is left in place but is **not deployed**.

### 4a. Add the service-account key to Vercel

The endpoint authenticates to Firebase with a service-account key, kept
**only** as a Vercel environment variable (never in the client bundle).

1. Firebase Console → **Project settings** → **Service accounts** →
   **Generate new private key**. This downloads a JSON file. (This is the
   same kind of key `scripts/bootstrap-admin.mjs` uses locally.)
2. Vercel → your project → **Settings → Environment Variables** → add:

   | Name | Value | Environments |
   |------|-------|--------------|
   | `FIREBASE_SERVICE_ACCOUNT` | *the entire contents of that JSON file, pasted as one value* | Production, Preview, Development |
   | `FIRESTORE_DATABASE_ID` | `default` | Production, Preview, Development |

   > `FIRESTORE_DATABASE_ID` is optional — it defaults to `default` to match
   > this project's non-standard database name. Set it explicitly anyway so
   > it's obvious.

3. **Redeploy** (Vercel → Deployments → … → Redeploy, or push a commit) so
   the new env vars take effect. Vercel auto-detects `api/createUser.ts` as
   a serverless function — no `vercel.json` needed.

### 4b. Verify it's live

Against your deployed URL, this should return something **other than 404**
(a `401`/JSON error means the function is up; `404` means it isn't):

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://kreateandcosales.vercel.app/api/createUser \
  -H "Content-Type: application/json" -d "{}"
```

Then open the app → **Admin → Add Team Member** and create someone.

### 4c. The daily email digest (not yet deployed)

`dailyReminderDigest` in `functions/src/index.ts` is also a Cloud Function,
so it likewise can't run on the Spark plan. It is **not running**. When you
want it, it must be rebuilt as a free scheduled job (e.g. Vercel Cron or a
GitHub Actions cron) — see the note at the end of this section. The Resend
setup below is kept for reference for whenever that happens.

### 4a. Resend setup (for the digest)

1. Sign up at https://resend.com and verify your domain (or use
   `onboarding@resend.dev` to test). Generate an API key.
2. Set two function secrets:

   ```sh
   firebase functions:secrets:set RESEND_API_KEY
   firebase functions:secrets:set DIGEST_FROM_EMAIL
   # When prompted, enter: "kreateandco <crm@your-verified-domain.com>"
   ```

### 4b. Deploy

```sh
cd functions
npm install
npm run build
cd ..
firebase deploy --only functions
```

To test the digest immediately (without waiting until 9am):

```sh
gcloud scheduler jobs run firebase-schedule-dailyReminderDigest-us-central1 \
  --location=us-central1
```

(Replace job name if your project shows a different one in
`Cloud Scheduler` in GCP Console.)

---

## 5. Deploy frontend to Vercel

1. Push this repo to GitHub.
2. Vercel → **Add New** → **Project** → import the repo.
3. Framework preset: **Vite**. Build command and output directory
   auto-detected (`npm run build` → `dist`).
4. Add the same env vars from `.env.local` to **Settings → Environment
   Variables**. (They start with `VITE_` so Vite picks them up at build
   time.)
5. Deploy.

Add your Vercel URL to **Firebase Console → Authentication → Settings →
Authorized domains** so sign-in works in production.

---

## 6. Where we are vs. what's next

| Phase | Status | Scope                                                  |
|-------|--------|--------------------------------------------------------|
| 1     | ✅     | Foundation: auth, Dashboard, My Projects, rules        |
| 2     | ⏭     | Pipeline (Kanban), All Merchants, Reminders, search    |
| 3     | ⏭     | Activities, Admin UI, Sheets import, daily email digest |

---

## Project structure

```
src/
  components/
    layout/      AppShell, Sidebar, Topbar, RequireAuth
    sheet/       EditableCell, StatusSelect
    ui/          MetricCard, SectionCard
    dashboard/   PipelineByStage
  context/       AuthContext (role helpers live here)
  hooks/         useCollection (real-time Firestore subscriptions)
  lib/           firebase, types, firestore (write helpers)
  pages/         LoginPage, DashboardPage, MyProjectsPage, AccountPendingPage
firestore.rules  Server-side role enforcement
functions/       Cloud Functions (createUser, future digest job)
```
