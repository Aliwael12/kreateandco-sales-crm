#!/usr/bin/env node
// ============================================================================
// STEP 1 — EXPORT everything from Firebase to local JSON.
//
// Produces, under migration/data/:
//   • firestore.json    — every doc in all 9 collections, Timestamps as ISO
//   • auth.json         — every Firebase Auth account, including the SCRYPT
//                         passwordHash + salt (needed to keep passwords)
//   • manifest.json     — per-collection counts + auth count + export time
//
// This is a READ-ONLY operation against Firebase. It never writes to Firebase
// and never touches Supabase. Run it during the maintenance window AFTER
// writes are frozen, so the snapshot is the final state.
//
// Usage:
//   node migration/export.mjs [--key-path ./service-account.json]
//
// Requires firebase-admin (already a dependency of this repo).
// ============================================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { initAdmin, toJsonValue, COLLECTIONS, DB_ID } from './lib/shared.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const { values } = parseArgs({
  options: { 'key-path': { type: 'string' }, help: { type: 'boolean', short: 'h' } },
})
if (values.help) {
  console.log('node migration/export.mjs [--key-path ./service-account.json]')
  process.exit(0)
}

const OUT_DIR = resolve(HERE, 'data')
mkdirSync(OUT_DIR, { recursive: true })

// Default the service-account key to the repo root if not passed explicitly.
const { app, projectId } = await initAdmin(
  values['key-path'] ?? resolve(HERE, '..', 'service-account.json'),
)
const db = getFirestore(app, DB_ID)
const auth = getAuth(app)

console.log(`→ Exporting Firebase project: ${projectId} (db: ${DB_ID})\n`)

// ── 1. Firestore documents ──────────────────────────────────────────────────
const firestore = {}
const counts = {}
for (const col of COLLECTIONS) {
  // Stream the whole collection. For very large collections this still fits in
  // memory comfortably (a CRM, not analytics); if a collection ever grows past
  // memory, switch this to a cursor loop on __name__. Counts are logged so you
  // can sanity-check against the Firebase console.
  const snap = await db.collection(col).get()
  firestore[col] = snap.docs.map((d) => ({
    id: d.id,
    data: toJsonValue(d.data()),
  }))
  counts[col] = snap.size
  console.log(`  · ${col.padEnd(12)} ${snap.size} docs`)
}

// ── 2. Auth accounts (with password hashes) ─────────────────────────────────
// listUsers pages 1000 at a time. The UserRecord includes passwordHash and
// passwordSalt ONLY when the request is made with the Admin SDK (which we are).
const authUsers = []
let pageToken
do {
  const res = await auth.listUsers(1000, pageToken)
  for (const u of res.users) {
    authUsers.push({
      uid: u.uid,
      email: u.email ?? null,
      emailVerified: u.emailVerified ?? false,
      displayName: u.displayName ?? null,
      phoneNumber: u.phoneNumber ?? null,
      disabled: u.disabled ?? false,
      // SCRYPT material — base64. Empty for users created via federated
      // providers or imported without a password; the import handles that.
      passwordHash: u.passwordHash ?? null,
      passwordSalt: u.passwordSalt ?? null,
      providerData: u.providerData?.map((p) => ({
        providerId: p.providerId,
        uid: p.uid,
        email: p.email ?? null,
      })),
      metadata: {
        creationTime: u.metadata?.creationTime ?? null,
        lastSignInTime: u.metadata?.lastSignInTime ?? null,
      },
      customClaims: u.customClaims ?? null,
    })
  }
  pageToken = res.pageToken
} while (pageToken)

console.log(`  · auth         ${authUsers.length} accounts`)

// ── 3. Write the files ──────────────────────────────────────────────────────
const exportedAt = new Date().toISOString()
writeFileSync(
  resolve(OUT_DIR, 'firestore.json'),
  JSON.stringify({ projectId, dbId: DB_ID, exportedAt, collections: firestore }, null, 2),
)
writeFileSync(
  resolve(OUT_DIR, 'auth.json'),
  JSON.stringify({ projectId, exportedAt, users: authUsers }, null, 2),
)

// Flag any auth account that has NO Firestore profile and vice-versa — these
// are the cases that need a human decision at import time, surfaced now.
const profileUids = new Set(firestore.users.map((u) => u.id))
const authUids = new Set(authUsers.map((u) => u.uid))
const authWithoutProfile = [...authUids].filter((u) => !profileUids.has(u))
const profileWithoutAuth = [...profileUids].filter((u) => !authUids.has(u))
const withoutPassword = authUsers
  .filter((u) => !u.passwordHash)
  .map((u) => u.email || u.uid)

writeFileSync(
  resolve(OUT_DIR, 'manifest.json'),
  JSON.stringify(
    {
      projectId,
      exportedAt,
      firestoreCounts: counts,
      authCount: authUsers.length,
      warnings: { authWithoutProfile, profileWithoutAuth, withoutPassword },
    },
    null,
    2,
  ),
)

console.log(`\n✓ Export complete → ${OUT_DIR}`)
if (authWithoutProfile.length)
  console.log(`  ⚠ ${authWithoutProfile.length} auth account(s) with no Firestore profile`)
if (profileWithoutAuth.length)
  console.log(`  ⚠ ${profileWithoutAuth.length} profile(s) with no auth account`)
if (withoutPassword.length)
  console.log(
    `  ⚠ ${withoutPassword.length} account(s) have NO password hash ` +
      `(federated/passwordless) — they will need a reset link after migration.`,
  )
process.exit(0)
