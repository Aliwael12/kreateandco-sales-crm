// Shared helpers for the migration scripts (export / import / verify).
//
// Keeping the UID→UUID mapping and the collection list in ONE place is what
// guarantees the export, import, and verify all agree. If you change the
// namespace here you MUST also change it in sql/01_schema.sql
// (migration.fb_uid_to_uuid) — they must stay identical forever.

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

// ── minimal .env loader (no dependency) ─────────────────────────────────────
// Reads KEY=VALUE lines from a file into process.env (without overwriting vars
// already set in the environment). Lets you keep SUPABASE_DB_URL in a gitignored
// migration/.env so the migration is a one-command run with no secrets pasted
// into the shell. Quotes are stripped; lines starting with # are ignored.
export function loadEnvFile(path) {
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

// ── deterministic Firebase-UID → UUID v5 ────────────────────────────────────
// Must match Postgres uuid_generate_v5('b6c2f8a0-…'::uuid, fb_uid) byte-for-byte.
// uuid_generate_v5 = SHA-1(namespace_bytes || name_bytes), with version/variant
// bits set. We reimplement it here so JS and Postgres produce identical UUIDs.
const NAMESPACE = 'b6c2f8a0-1d3e-4f5a-8b9c-7e6d5c4b3a21'

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '')
  const bytes = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  return bytes
}

/** Deterministic UUIDv5 of a Firebase UID. Stable across runs and matches PG. */
export function fbUidToUuid(fbUid) {
  if (fbUid === undefined || fbUid === null || fbUid === '') return null
  const nsBytes = uuidToBytes(NAMESPACE)
  const nameBytes = Buffer.from(String(fbUid), 'utf8')
  const hash = createHash('sha1')
    .update(nsBytes)
    .update(nameBytes)
    .digest() // 20 bytes
  const b = Buffer.from(hash.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50 // version 5
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = b.toString('hex')
  return `${h.substr(0, 8)}-${h.substr(8, 4)}-${h.substr(12, 4)}-${h.substr(16, 4)}-${h.substr(20)}`
}

// ── collection inventory ─────────────────────────────────────────────────────
// The 9 Firestore collections. `users` is special-cased (auth + profile);
// the rest are plain document collections.
export const COLLECTIONS = [
  'users',
  'projects',
  'stages',
  'merchants',
  'deals',
  'reminders',
  'tasks',
  'industries',
  'activities',
]

// ── Firestore value → JSON-safe value ───────────────────────────────────────
// Recursively converts Firestore Timestamps to ISO strings (carrying full ms
// precision), GeoPoints/refs to plain objects, and leaves everything else as
// is. Returns plain JSON so the export file is self-contained.
export function toJsonValue(v) {
  if (v === null || v === undefined) return null
  // Firestore Timestamp (admin SDK): has toDate() + seconds/nanoseconds.
  if (typeof v === 'object' && typeof v.toDate === 'function') {
    return { __ts__: v.toDate().toISOString() }
  }
  if (Array.isArray(v)) return v.map(toJsonValue)
  if (typeof v === 'object') {
    // DocumentReference: keep its path so nothing is silently dropped.
    if (typeof v.path === 'string' && v.firestore) return { __ref__: v.path }
    const out = {}
    for (const [k, val] of Object.entries(v)) out[k] = toJsonValue(val)
    return out
  }
  return v
}

/** Pull a Timestamp marker (from toJsonValue) back into an ISO string, or null. */
export function tsToIso(v) {
  if (!v) return null
  if (typeof v === 'object' && typeof v.__ts__ === 'string') return v.__ts__
  if (typeof v === 'string') return v // already ISO
  return null
}

/** Initialise the Firebase Admin SDK from a service-account key path. */
export async function initAdmin(keyPath) {
  const { readFileSync, existsSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const resolved = resolve(
    keyPath ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      './service-account.json',
  )
  if (!existsSync(resolved)) {
    throw new Error(
      `Service account key not found at ${resolved}. Download it from ` +
        'Firebase Console → Project settings → Service accounts, save as ' +
        'service-account.json at the repo root (gitignored) or pass --key-path.',
    )
  }
  const { initializeApp, cert, getApps } = await import('firebase-admin/app')
  const sa = JSON.parse(readFileSync(resolved, 'utf8'))
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa) })
  return { app, projectId: sa.project_id }
}

export const DB_ID = process.env.FIRESTORE_DATABASE_ID || 'default'
