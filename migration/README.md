# Firebase → Supabase migration

Everything needed to migrate the kreateandco Sales CRM off Firebase with zero data loss.

**Start here:** [`RUNBOOK.md`](./RUNBOOK.md) — the step-by-step cutover guide.

## Contents

```
migration/
  RUNBOOK.md            ← the operational guide (read this)
  package.json          ← deps for the scripts (firebase-admin, pg)
  export.mjs            ← STEP 1: Firebase → local JSON (Firestore + Auth hashes)
  import.mjs            ← STEP 2: JSON → Supabase (Postgres + Auth), idempotent
  verify.mjs            ← STEP 3: field-level zero-loss check (gates cutover)
  apply-sql.mjs         ← helper: run a .sql file via the Supabase Management API
  lib/shared.mjs        ← shared UID→UUID mapping, Timestamp coercion, helpers
  sql/
    01_schema.sql       ← Postgres schema (applied ✓)
    02_rls.sql          ← RLS policies, translated from firestore.rules (applied ✓)
  data/                 ← (gitignored) export output + scrypt.json secrets
    scrypt.json.example ← template for Firebase scrypt params

../supabase/
  functions/daily-reminder-digest/index.ts  ← ported scheduled email digest
  sql/03_cron.sql                            ← pg_cron schedule for the digest
```

## Design decisions (why this is zero-loss)

- **Document IDs preserved.** All non-user Firestore IDs (merchants, deals,
  projects, …) are kept verbatim as `text` primary keys. No remapping → no
  broken references.
- **User IDs → deterministic UUIDv5.** `auth.users.id` must be a UUID, so each
  Firebase UID maps to `uuidv5(uid)`. The same transform is computed identically
  in JS and in Postgres (verified byte-for-byte), and applied to every
  user-reference column (`repId`, `createdBy`, `who`, `assigneeId`, …). The
  original UID is kept in `users.firebase_uid`.
- **Passwords carried over.** Firebase scrypt hashes are written to
  `auth.users.encrypted_password` in Supabase's `$fbscrypt$` format; users keep
  their passwords and Supabase re-hashes to bcrypt on first login.
- **Timestamps exact.** Firestore Timestamps → `timestamptz` via ISO-8601 with
  full millisecond precision.
- **Idempotent import + gating verify.** Re-runnable UPSERTs; `verify.mjs`
  fails the cutover if any row or field doesn't match the source export.
```
