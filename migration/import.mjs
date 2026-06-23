#!/usr/bin/env node
// ============================================================================
// STEP 2 — IMPORT the exported JSON into Supabase (Postgres + Auth).
//
// • Inserts auth.users directly via SQL so we can (a) set a deterministic UUID
//   id = uuidv5(firebaseUid) and (b) carry the Firebase SCRYPT password hash in
//   the $fbscrypt$ format Supabase's auth server understands. Users keep their
//   passwords; Supabase transparently re-hashes to bcrypt on first login.
// • Inserts every public.* row preserving Firestore document IDs and applying
//   the SAME uuidv5 transform to every user-reference column.
// • Idempotent: every insert is an UPSERT (on conflict do update), so a re-run
//   after a partial failure converges to the same state with no duplicates.
//
// SAFE TO RE-RUN. Does NOT touch Firebase.
//
// Requires a DIRECT Postgres connection string with the service-role/postgres
// password (NOT the anon key). Get it from:
//   Supabase Dashboard → Project Settings → Database → Connection string (URI).
// Set it as SUPABASE_DB_URL. Also provide the scrypt params from
//   Supabase/Firebase Console → Authentication → password hash parameters.
//
// Usage:
//   SUPABASE_DB_URL=postgres://... \
//   FB_SCRYPT_SIGNER_KEY=... FB_SCRYPT_SALT_SEPARATOR=... \
//   FB_SCRYPT_ROUNDS=8 FB_SCRYPT_MEM_COST=14 \
//   node migration/import.mjs
//
// (The scrypt params are read from migration/data/scrypt.json if present, so
//  you can put them in a gitignored file instead of env vars.)
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { fbUidToUuid, tsToIso, loadEnvFile } from './lib/shared.mjs'

// Paths resolve relative to THIS script, not the caller's cwd, so the migration
// runs the same whether invoked from the repo root or migration/.
const HERE = dirname(fileURLToPath(import.meta.url))
loadEnvFile(resolve(HERE, '.env')) // optional gitignored secrets file
const DATA = resolve(HERE, 'data')
if (!existsSync(resolve(DATA, 'firestore.json')) || !existsSync(resolve(DATA, 'auth.json'))) {
  console.error(
    '✗ No export found in migration/data/. Run the export first:\n' +
      '    node migration/export.mjs\n' +
      '  (then re-run this import).',
  )
  process.exit(1)
}
const firestore = JSON.parse(readFileSync(resolve(DATA, 'firestore.json'), 'utf8')).collections
const authData = JSON.parse(readFileSync(resolve(DATA, 'auth.json'), 'utf8')).users

// ── scrypt params ────────────────────────────────────────────────────────────
function scryptParams() {
  const file = resolve(DATA, 'scrypt.json')
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  const p = {
    signerKey: process.env.FB_SCRYPT_SIGNER_KEY || fromFile.base64_signer_key || fromFile.signerKey,
    saltSeparator:
      process.env.FB_SCRYPT_SALT_SEPARATOR || fromFile.base64_salt_separator || fromFile.saltSeparator,
    rounds: Number(process.env.FB_SCRYPT_ROUNDS || fromFile.rounds),
    memCost: Number(process.env.FB_SCRYPT_MEM_COST || fromFile.mem_cost || fromFile.memCost),
  }
  return p
}

// Build the exact $fbscrypt$ string Supabase auth verifies. Format (from
// supabase/auth internal/crypto/password.go):
//   $fbscrypt$v=1,n=<N>,r=<R>,p=1,ss=<b64 saltSep>,sk=<b64 signerKey>$<b64 userSalt>$<b64 userHash>
//
// CRITICAL mapping (do NOT map by name): GoTrue computes
//   memory = 1 << n   and passes r straight through as `rounds` to scrypt.Key.
// So n is Firebase's MEM_COST and r is Firebase's ROUNDS — the OPPOSITE of what
// the field names suggest. Getting this backwards makes every hash fail to
// verify (logins all fail) even though the string looks well-formed.
// Firebase's Admin SDK exports passwordHash/passwordSalt in URL-SAFE base64
// (-_), but GoTrue decodes them with base64.StdEncoding (+/). Passing them
// through unchanged makes GoTrue fail to decode the salt/hash → every login
// returns 400 "invalid credentials". Re-encode to standard base64 here.
function toStdB64(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('base64')
}

function buildFbScrypt(passwordHash, passwordSalt, params) {
  if (!passwordHash || !passwordSalt) return null
  return (
    `$fbscrypt$v=1,n=${params.memCost},r=${params.rounds},p=1` +
    `,ss=${params.saltSeparator},sk=${params.signerKey}` +
    `$${toStdB64(passwordSalt)}$${toStdB64(passwordHash)}`
  )
}

const DRY = process.argv.includes('--dry-run')

const { Client } = pg
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('✗ SUPABASE_DB_URL is required (Project Settings → Database → Connection string).')
  process.exit(1)
}
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

const params = scryptParams()
const haveScrypt = params.signerKey && params.saltSeparator && params.rounds && params.memCost
if (!haveScrypt) {
  console.warn(
    '⚠ Firebase scrypt params missing. Auth rows will be created WITHOUT a ' +
      'password (users would need a reset link). Provide them to preserve passwords.\n',
  )
}

// ── fine-grained progress (≈1% steps over ALL rows) ─────────────────────────
// Grand total = one onRow() per inserted unit. The `users` collection is NOT
// counted separately: user profiles are written inside the auth loop, which
// emits one onRow('auth+profile') per auth account. Counting authData.length
// here (not firestore.users) avoids double-counting and lands the bar at 100%.
const GRAND_TOTAL =
  authData.length +
  Object.entries(firestore).reduce(
    (sum, [name, arr]) => sum + (name === 'users' ? 0 : arr.length),
    0,
  )
let rowsDone = 0
let lastPct = -1
function onRow(label) {
  rowsDone++
  const pct = Math.floor((rowsDone / GRAND_TOTAL) * 100)
  if (pct !== lastPct) {
    lastPct = pct
    console.log(`PROGRESS ${pct} ${rowsDone}/${GRAND_TOTAL} ${label}`)
  }
}

let stats = { auth: 0, authNoPw: 0 }
const sql = (q, v) => (DRY ? Promise.resolve({ rowCount: 0 }) : client.query(q, v))

try {
  if (!DRY) await client.query('begin')

  // ── 1. auth.users + public.users (profiles) ────────────────────────────────
  // Index profiles by uid so we can merge name/role/etc. with the auth record.
  const profileById = new Map(firestore.users.map((u) => [u.id, u.data]))

  for (const a of authData) {
    const id = fbUidToUuid(a.uid)
    const profile = profileById.get(a.uid) || {}
    const email = (a.email || profile.email || '').toLowerCase()
    if (!email) {
      console.warn(`  ⚠ skipping auth uid ${a.uid}: no email`)
      continue
    }
    const encryptedPassword = haveScrypt
      ? buildFbScrypt(a.passwordHash, a.passwordSalt, params)
      : null
    if (!encryptedPassword) stats.authNoPw++

    // Insert into auth.users. instance_id/aud/role are the standard Supabase
    // defaults. email_confirmed_at is ALWAYS set (now()): these are real,
    // pre-existing users being migrated, so we trust their emails and let them
    // sign in immediately. (Firebase often stored emailVerified=false even for
    // active accounts; gating confirmation on that flag left every migrated
    // user with email_confirmed_at=NULL and a "Email not confirmed" 400 at
    // login when the project requires confirmation.)
    //
    // The token columns (confirmation_token, recovery_token, email_change*,
    // phone_change*, reauthentication_token) MUST be '' not NULL: GoTrue scans
    // them as Go strings on login and a NULL crashes the query with a 500
    // ("converting NULL to string is unsupported"). Direct SQL inserts default
    // them to NULL, so we set them explicitly here.
    await sql(
      `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at,
          confirmation_token, recovery_token, email_change,
          email_change_token_new, email_change_token_current,
          phone_change, phone_change_token, reauthentication_token)
       values
         ('00000000-0000-0000-0000-000000000000', $1, 'authenticated',
          'authenticated', $2, $3,
          -- Always confirm migrated users. $4 (emailVerified) is referenced so
          -- the param stays bound, but the result is always now() regardless.
          case when $4 is not null then now() else now() end,
          $5::jsonb, $6::jsonb, $7, $8,
          '', '', '', '', '', '', '', '')
       on conflict (id) do update set
          email = excluded.email,
          encrypted_password = coalesce(excluded.encrypted_password, auth.users.encrypted_password),
          raw_user_meta_data = excluded.raw_user_meta_data,
          updated_at = excluded.updated_at,
          confirmation_token = '', recovery_token = '', email_change = '',
          email_change_token_new = '', email_change_token_current = '',
          phone_change = '', phone_change_token = '', reauthentication_token = ''`,
      [
        id,
        email,
        encryptedPassword,
        a.emailVerified !== false,
        JSON.stringify({ provider: 'email', providers: ['email'] }),
        JSON.stringify({ firebase_uid: a.uid, name: a.displayName ?? profile.name ?? '' }),
        tsToIso(profile.createdAt) || a.metadata?.creationTime || new Date().toISOString(),
        new Date().toISOString(),
      ],
    )

    // Supabase also requires an auth.identities row for email/password sign-in.
    await sql(
      `insert into auth.identities
         (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values ($1, $2, $3::jsonb, 'email', now(), now(), now())
       on conflict (provider, provider_id) do nothing`,
      [id, id, JSON.stringify({ sub: id, email })],
    )

    // public.users profile.
    await sql(
      `insert into public.users
         (id, firebase_uid, name, email, role, color, project_ids, disabled, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (id) do update set
          firebase_uid = excluded.firebase_uid, name = excluded.name,
          email = excluded.email, role = excluded.role, color = excluded.color,
          project_ids = excluded.project_ids, disabled = excluded.disabled,
          updated_at = excluded.updated_at`,
      [
        id,
        a.uid,
        profile.name ?? a.displayName ?? '',
        email,
        profile.role ?? 'Rep',
        profile.color ?? '#5B4FCF',
        Array.isArray(profile.projectIds) ? profile.projectIds : [],
        profile.disabled === true,
        tsToIso(profile.createdAt) || new Date().toISOString(),
        tsToIso(profile.updatedAt) || new Date().toISOString(),
      ],
    )
    stats.auth++
    onRow('auth+profile')
  }

  // Profiles that have NO auth account (orphans flagged by export). Create the
  // public.users row anyway so references to them resolve; they just can't log
  // in until an auth account is made. Zero-loss: we keep the data.
  for (const u of firestore.users) {
    if (authData.some((a) => a.uid === u.id)) continue
    const id = fbUidToUuid(u.id)
    const p = u.data
    console.warn(`  ⚠ profile ${p.email || u.id} has no auth account; importing profile only`)
    // Must satisfy the FK to auth.users — create a shell auth row (no password).
    // Token columns set to '' (not NULL) so GoTrue can scan the row — see note
    // on the main auth insert above.
    await sql(
      `insert into auth.users
         (instance_id, id, aud, role, email, created_at, updated_at,
          raw_user_meta_data,
          confirmation_token, recovery_token, email_change,
          email_change_token_new, email_change_token_current,
          phone_change, phone_change_token, reauthentication_token)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated',
               'authenticated', $2, $3, $4, $5::jsonb,
               '', '', '', '', '', '', '', '')
       on conflict (id) do nothing`,
      [
        id,
        (p.email || `${u.id}@no-auth.invalid`).toLowerCase(),
        tsToIso(p.createdAt) || new Date().toISOString(),
        new Date().toISOString(),
        JSON.stringify({ firebase_uid: u.id, orphaned_profile: true }),
      ],
    )
    await sql(
      `insert into public.users
         (id, firebase_uid, name, email, role, color, project_ids, disabled, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do nothing`,
      [
        id, u.id, p.name ?? '', (p.email || '').toLowerCase(),
        p.role ?? 'Rep', p.color ?? '#5B4FCF',
        Array.isArray(p.projectIds) ? p.projectIds : [], p.disabled === true,
        tsToIso(p.createdAt) || new Date().toISOString(),
        tsToIso(p.updatedAt) || new Date().toISOString(),
      ],
    )
  }

  // ── 2. simple ID-preserving collections ─────────────────────────────────────
  await importProjects()
  await importStages()
  await importIndustries()
  await importMerchants()
  await importDeals()
  await importReminders()
  await importTasks()
  await importActivities()

  if (!DRY) await client.query('commit')
  console.log('\n✓ Import complete.')
  console.log(`  auth users: ${stats.auth}  (without password: ${stats.authNoPw})`)
} catch (err) {
  if (!DRY) await client.query('rollback').catch(() => {})
  console.error('\n✗ Import failed — rolled back. No partial data committed.')
  console.error(err)
  process.exit(1)
} finally {
  await client.end()
}

// ── per-collection importers ──────────────────────────────────────────────────

async function importProjects() {
  let n = 0
  for (const { id, data: p } of firestore.projects) {
    await sql(
      `insert into public.projects (id, name, color, description, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set name=excluded.name, color=excluded.color,
         description=excluded.description, updated_at=excluded.updated_at`,
      [id, p.name ?? '', p.color ?? '', p.description ?? '',
       tsToIso(p.createdAt) || new Date().toISOString(),
       tsToIso(p.updatedAt) || new Date().toISOString()],
    )
    n++
    onRow('projects')
  }
  console.log(`  · projects     ${n}`)
}

async function importStages() {
  let n = 0
  for (const { id, data: s } of firestore.stages) {
    await sql(
      `insert into public.stages (id, name, color, "order", locked, created_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set name=excluded.name, color=excluded.color,
         "order"=excluded."order", locked=excluded.locked`,
      [id, s.name ?? '', s.color ?? '', Number(s.order ?? 0), s.locked === true,
       tsToIso(s.createdAt) || new Date().toISOString()],
    )
    n++
    onRow('stages')
  }
  console.log(`  · stages       ${n}`)
}

async function importIndustries() {
  let n = 0
  for (const { id, data: i } of firestore.industries) {
    await sql(
      `insert into public.industries (id, name, created_at)
       values ($1,$2,$3)
       on conflict (id) do update set name=excluded.name`,
      [id, i.name ?? '', tsToIso(i.createdAt) || new Date().toISOString()],
    )
    n++
    onRow('industries')
  }
  console.log(`  · industries   ${n}`)
}

async function importMerchants() {
  let n = 0
  for (const { id, data: m } of firestore.merchants) {
    await sql(
      `insert into public.merchants
         (id, name, name_lower, industry, contact, contact_role, phone, email,
          contacts, created_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
       on conflict (id) do update set name=excluded.name, name_lower=excluded.name_lower,
         industry=excluded.industry, contact=excluded.contact,
         contact_role=excluded.contact_role, phone=excluded.phone, email=excluded.email,
         contacts=excluded.contacts, updated_at=excluded.updated_at`,
      [
        id, m.name ?? '', m.nameLower ?? (m.name ?? '').toLowerCase(),
        m.industry ?? '', m.contact ?? '', m.contactRole ?? '', m.phone ?? '', m.email ?? '',
        m.contacts ? JSON.stringify(m.contacts) : null,
        fbUidToUuid(m.createdBy),
        tsToIso(m.createdAt) || new Date().toISOString(),
        tsToIso(m.updatedAt) || new Date().toISOString(),
      ],
    )
    n++
    onRow('merchants')
  }
  console.log(`  · merchants    ${n}`)
}

async function importDeals() {
  let n = 0
  for (const { id, data: d } of firestore.deals) {
    await sql(
      `insert into public.deals
         (id, merchant_id, merchant_name, project_id, rep_id, status, rate, comments,
          created_by, updated_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do update set merchant_id=excluded.merchant_id,
         merchant_name=excluded.merchant_name, project_id=excluded.project_id,
         rep_id=excluded.rep_id, status=excluded.status, rate=excluded.rate,
         comments=excluded.comments, updated_by=excluded.updated_by,
         updated_at=excluded.updated_at`,
      [
        id, d.merchantId ?? '', d.merchantName ?? '', d.projectId ?? '',
        fbUidToUuid(d.repId), d.status ?? '', d.rate ?? '', d.comments ?? '',
        fbUidToUuid(d.createdBy), fbUidToUuid(d.updatedBy),
        tsToIso(d.createdAt) || new Date().toISOString(),
        tsToIso(d.updatedAt) || new Date().toISOString(),
      ],
    )
    n++
    onRow('deals')
  }
  console.log(`  · deals        ${n}`)
}

async function importReminders() {
  let n = 0
  for (const { id, data: r } of firestore.reminders) {
    await sql(
      `insert into public.reminders
         (id, deal_id, merchant_id, merchant_name, project_id, rep_id, type, note,
          due_at, dismissed, dismissed_at, dismissed_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do update set deal_id=excluded.deal_id,
         merchant_name=excluded.merchant_name, type=excluded.type, note=excluded.note,
         due_at=excluded.due_at, dismissed=excluded.dismissed,
         dismissed_at=excluded.dismissed_at, dismissed_by=excluded.dismissed_by`,
      [
        id, r.dealId ?? '', r.merchantId ?? '', r.merchantName ?? '', r.projectId ?? '',
        fbUidToUuid(r.repId), r.type ?? 'manual', r.note ?? '',
        tsToIso(r.dueAt), r.dismissed === true, tsToIso(r.dismissedAt),
        fbUidToUuid(r.dismissedBy),
        tsToIso(r.createdAt) || new Date().toISOString(),
      ],
    )
    n++
    onRow('reminders')
  }
  console.log(`  · reminders    ${n}`)
}

async function importTasks() {
  let n = 0
  for (const { id, data: t } of firestore.tasks) {
    await sql(
      `insert into public.tasks
         (id, title, merchant_id, merchant_name, project_id, assignee_id, created_by,
          created_by_name, note, status, status_note, status_updated_at, status_updated_by,
          due_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (id) do update set title=excluded.title, merchant_name=excluded.merchant_name,
         assignee_id=excluded.assignee_id, note=excluded.note, status=excluded.status,
         status_note=excluded.status_note, status_updated_at=excluded.status_updated_at,
         status_updated_by=excluded.status_updated_by, due_at=excluded.due_at,
         updated_at=excluded.updated_at`,
      [
        id, t.title ?? '', t.merchantId ?? '', t.merchantName ?? '', t.projectId ?? '',
        fbUidToUuid(t.assigneeId), fbUidToUuid(t.createdBy), t.createdByName ?? '',
        t.note ?? '', t.status ?? 'Pending', t.statusNote ?? '',
        tsToIso(t.statusUpdatedAt), fbUidToUuid(t.statusUpdatedBy),
        tsToIso(t.dueAt),
        tsToIso(t.createdAt) || new Date().toISOString(),
        tsToIso(t.updatedAt) || new Date().toISOString(),
      ],
    )
    n++
    onRow('tasks')
  }
  console.log(`  · tasks        ${n}`)
}

async function importActivities() {
  let n = 0
  for (const { id, data: a } of firestore.activities) {
    await sql(
      `insert into public.activities
         (id, who, who_name, kind, text, ref_id, ref_kind, meta, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       on conflict (id) do nothing`,
      [
        id, fbUidToUuid(a.who), a.whoName ?? '', a.kind ?? 'unknown', a.text ?? '',
        a.refId ?? null, a.refKind ?? null,
        a.meta ? JSON.stringify(a.meta) : null,
        tsToIso(a.createdAt) || new Date().toISOString(),
      ],
    )
    n++
    onRow('activities')
  }
  console.log(`  · activities   ${n}`)
}
