#!/usr/bin/env node
// ============================================================================
// STEP 3 — VERIFY zero data loss.
//
// Reads migration/data/firestore.json (the source of truth from the export)
// and compares it field-by-field against what landed in Supabase Postgres.
//
// Checks, per collection:
//   1. Row count matches exactly.
//   2. Every source document ID exists in the target.
//   3. Every scalar field round-trips (with the documented transforms:
//      Timestamps→timestamptz, user refs→uuidv5, contacts→jsonb).
//   4. Auth: every Firebase account has an auth.users row with a password hash
//      (unless it had none in Firebase).
//
// Exit code is non-zero if ANY discrepancy is found, so it can gate the cutover
// in a script. Prints a clear PASS/FAIL summary and the first N mismatches.
//
// Usage:
//   SUPABASE_DB_URL=postgres://... node migration/verify.mjs
// ============================================================================

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { fbUidToUuid, tsToIso, loadEnvFile } from './lib/shared.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
loadEnvFile(resolve(HERE, '.env'))
const DATA = resolve(HERE, 'data')
const src = JSON.parse(readFileSync(resolve(DATA, 'firestore.json'), 'utf8')).collections
const authSrc = JSON.parse(readFileSync(resolve(DATA, 'auth.json'), 'utf8')).users

const { Client } = pg
if (!process.env.SUPABASE_DB_URL) {
  console.error('✗ SUPABASE_DB_URL is required (set it in migration/.env or the environment).')
  process.exit(1)
}
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

const MAX_SHOW = 10
let failures = 0
const report = []

function eqTs(srcVal, dbVal) {
  const a = tsToIso(srcVal)
  const b = dbVal ? new Date(dbVal).toISOString() : null
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return new Date(a).getTime() === new Date(b).getTime()
}
const eqStr = (a, b) => (a ?? '') === (b ?? '')
const eqUuid = (fbRef, dbVal) => {
  const expect = fbUidToUuid(fbRef)
  return (expect ?? null) === (dbVal ?? null)
}

// Order-independent deep equality for JSON values (objects/arrays/scalars).
// Postgres jsonb does NOT preserve object key order, so a naive
// JSON.stringify comparison reports false mismatches on `contacts` / `meta`
// even when every key/value is identical. This compares by VALUE instead.
function eqJson(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => eqJson(x, b[i]))
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => eqJson(a[k], b[k]))
  }
  return a === b
}

async function dbRows(table) {
  const { rows } = await client.query(`select * from public.${table}`)
  return new Map(rows.map((r) => [r.id, r]))
}

async function checkCount(table, srcArr) {
  const { rows } = await client.query(`select count(*)::int as c from public.${table}`)
  const got = rows[0].c
  const want = srcArr.length
  const ok = got === want
  if (!ok) failures++
  report.push(`${ok ? '✓' : '✗'} ${table.padEnd(12)} count: source=${want} target=${got}`)
  return ok
}

// ── field-level checkers ──────────────────────────────────────────────────────
const CHECKS = {
  projects: (s, r) =>
    eqStr(s.name, r.name) && eqStr(s.color, r.color) &&
    eqStr(s.description, r.description) && eqTs(s.createdAt, r.created_at),
  stages: (s, r) =>
    eqStr(s.name, r.name) && eqStr(s.color, r.color) &&
    Number(s.order ?? 0) === r.order && (s.locked === true) === r.locked,
  industries: (s, r) => eqStr(s.name, r.name) && eqTs(s.createdAt, r.created_at),
  merchants: (s, r) =>
    eqStr(s.name, r.name) &&
    eqStr(s.nameLower ?? (s.name ?? '').toLowerCase(), r.name_lower) &&
    eqStr(s.industry, r.industry) && eqStr(s.contact, r.contact) &&
    eqStr(s.contactRole, r.contact_role) && eqStr(s.phone, r.phone) &&
    eqStr(s.email, r.email) && eqUuid(s.createdBy, r.created_by) &&
    eqTs(s.createdAt, r.created_at) &&
    eqJson(s.contacts ?? null, r.contacts ?? null),
  deals: (s, r) =>
    eqStr(s.merchantId, r.merchant_id) && eqStr(s.merchantName, r.merchant_name) &&
    eqStr(s.projectId, r.project_id) && eqUuid(s.repId, r.rep_id) &&
    eqStr(s.status, r.status) && eqStr(s.rate, r.rate) && eqStr(s.comments, r.comments) &&
    eqUuid(s.createdBy, r.created_by) && eqUuid(s.updatedBy, r.updated_by) &&
    eqTs(s.createdAt, r.created_at),
  reminders: (s, r) =>
    eqStr(s.dealId, r.deal_id) && eqStr(s.merchantName, r.merchant_name) &&
    eqUuid(s.repId, r.rep_id) && eqStr(s.type, r.type) && eqStr(s.note, r.note) &&
    eqTs(s.dueAt, r.due_at) && (s.dismissed === true) === r.dismissed &&
    eqTs(s.createdAt, r.created_at),
  tasks: (s, r) =>
    eqStr(s.title, r.title) && eqStr(s.merchantId, r.merchant_id) &&
    eqStr(s.projectId, r.project_id) && eqUuid(s.assigneeId, r.assignee_id) &&
    eqUuid(s.createdBy, r.created_by) && eqStr(s.note, r.note) &&
    eqStr(s.status, r.status) && eqTs(s.dueAt, r.due_at) &&
    eqTs(s.createdAt, r.created_at),
  activities: (s, r) =>
    eqUuid(s.who, r.who) && eqStr(s.kind, r.kind) && eqStr(s.text, r.text) &&
    eqStr(s.refId, r.ref_id) && eqTs(s.createdAt, r.created_at) &&
    eqJson(s.meta ?? null, r.meta ?? null),
  users: (s, r) =>
    eqStr(s.name, r.name) && eqStr((s.email ?? '').toLowerCase(), r.email) &&
    eqStr(s.role ?? 'Rep', r.role) && eqStr(s.color, r.color) &&
    (s.disabled === true) === r.disabled &&
    JSON.stringify(Array.isArray(s.projectIds) ? s.projectIds : []) ===
      JSON.stringify(r.project_ids ?? []),
}

console.log('Verifying Supabase against the Firebase export…\n')

for (const table of Object.keys(CHECKS)) {
  const srcArr = src[table]
  await checkCount(table, srcArr)
  const rows = await dbRows(table)
  let mismatches = 0
  const shown = []
  for (const { id, data } of srcArr) {
    // users: target id is the uuidv5 of the firebase uid, not the doc id.
    const key = table === 'users' ? fbUidToUuid(id) : id
    const r = rows.get(key)
    if (!r) {
      mismatches++
      if (shown.length < MAX_SHOW) shown.push(`missing row id=${id}`)
      continue
    }
    if (!CHECKS[table](data, r)) {
      mismatches++
      if (shown.length < MAX_SHOW) shown.push(`field mismatch id=${id}`)
    }
  }
  if (mismatches) {
    failures++
    report.push(`  ↳ ${mismatches} field/row mismatch(es) in ${table}:`)
    shown.forEach((m) => report.push(`      ${m}`))
  }
}

// ── auth check ────────────────────────────────────────────────────────────────
{
  const { rows } = await client.query(
    `select id, email, (encrypted_password is not null and encrypted_password <> '') as has_pw
       from auth.users`,
  )
  const byId = new Map(rows.map((r) => [r.id, r]))
  let missing = 0
  let noPw = 0
  for (const a of authSrc) {
    const id = fbUidToUuid(a.uid)
    const r = byId.get(id)
    if (!r) {
      missing++
      continue
    }
    if (a.passwordHash && !r.has_pw) noPw++
  }
  if (missing) {
    failures++
    report.push(`✗ auth: ${missing} Firebase account(s) missing in auth.users`)
  } else {
    report.push(`✓ auth         all ${authSrc.length} accounts present`)
  }
  if (noPw) {
    failures++
    report.push(`✗ auth: ${noPw} account(s) had a Firebase password but no hash in Supabase`)
  }
}

console.log(report.join('\n'))
console.log('\n' + (failures === 0 ? '✓✓ PASS — no data loss detected.' : `✗✗ FAIL — ${failures} issue(s). DO NOT cut over.`))
await client.end()
process.exit(failures === 0 ? 0 : 1)
