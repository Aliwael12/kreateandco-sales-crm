#!/usr/bin/env node
// One-off repair: re-encode the per-user salt + hash in stored $fbscrypt$
// passwords from URL-safe base64 (-_) to standard base64 (+/).
//
// Firebase's Admin SDK exports passwordHash/passwordSalt in URL-safe base64,
// but Supabase GoTrue decodes them with base64.StdEncoding (expects +/ and =).
// So GoTrue can't decode the salt/hash and every login fails with 400. We fix
// ONLY the salt and hash segments (the 6th and 7th $-delimited fields); the
// params and the ss/sk (which were already standard base64) are left as-is.
//
// Idempotent: converting already-standard base64 is a no-op.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadEnvFile } from './lib/shared.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
loadEnvFile(resolve(HERE, '.env'))

// URL-safe base64 string -> standard base64 string (same bytes, +/ and padding).
function toStdB64(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('base64')
}

// Rebuild a $fbscrypt$ string with salt+hash re-encoded to standard base64.
// Format: $fbscrypt$<params>$<salt>$<hash>
function fixHash(stored) {
  if (!stored || !stored.startsWith('$fbscrypt$')) return null // not an fbscrypt hash
  // Split on '$': ['', 'fbscrypt', '<params>', '<salt>', '<hash>']
  const parts = stored.split('$')
  if (parts.length !== 5) return null
  const salt = parts[3]
  const hash = parts[4]
  const fixedSalt = toStdB64(salt)
  const fixedHash = toStdB64(hash)
  if (fixedSalt === salt && fixedHash === hash) return stored // already standard
  parts[3] = fixedSalt
  parts[4] = fixedHash
  return parts.join('$')
}

const { Client } = pg
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

try {
  const { rows } = await client.query(
    `select id, email, encrypted_password from auth.users
       where encrypted_password like '$fbscrypt$%'`,
  )
  let fixed = 0
  let unchanged = 0
  for (const r of rows) {
    const next = fixHash(r.encrypted_password)
    if (!next) {
      console.warn(`  ⚠ ${r.email}: unexpected fbscrypt shape, skipped`)
      continue
    }
    if (next === r.encrypted_password) {
      unchanged++
      continue
    }
    await client.query('update auth.users set encrypted_password = $1 where id = $2', [
      next,
      r.id,
    ])
    console.log(`  ✓ ${r.email}`)
    fixed++
  }
  console.log(`\nDone. Re-encoded ${fixed} hash(es); ${unchanged} already standard.`)
} catch (err) {
  console.error('✗ Failed:', err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
