#!/usr/bin/env node
// Applies a .sql file to Supabase via the Management API.
// Usage: node migration/apply-sql.mjs <path-to-sql> [--token TOKEN] [--ref REF]
// Token/ref fall back to SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF env vars.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node migration/apply-sql.mjs <path-to-sql>')
  process.exit(1)
}
const argTok = process.argv.indexOf('--token')
const argRef = process.argv.indexOf('--ref')
const token =
  (argTok > -1 ? process.argv[argTok + 1] : null) || process.env.SUPABASE_ACCESS_TOKEN
const ref =
  (argRef > -1 ? process.argv[argRef + 1] : null) || process.env.SUPABASE_PROJECT_REF
if (!token || !ref) {
  console.error('Need a token and project ref (--token/--ref or env vars).')
  process.exit(1)
}

const query = readFileSync(resolve(file), 'utf8')
const res = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  },
)
const text = await res.text()
if (!res.ok) {
  console.error(`✗ ${res.status} ${res.statusText}`)
  console.error(text)
  process.exit(1)
}
console.log(`✓ Applied ${file}`)
console.log(text.length > 2 ? text : '(no rows returned)')
