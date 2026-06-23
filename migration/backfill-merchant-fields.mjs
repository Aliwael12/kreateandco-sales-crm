#!/usr/bin/env node
// Backfill EMPTY merchant fields (phone, contact, contact_role) from a CSV,
// matching existing merchants by name. ONLY fills blanks — never overwrites a
// value the merchant already has. Matches by exact lowercased name first, then
// by fuzzy key (punctuation/spacing/&-and-insensitive).
//
// DRY-RUN BY DEFAULT. Re-run with --commit to apply.
//
// Usage:
//   node migration/backfill-merchant-fields.mjs <csv> [--commit] [--fields phone,contact,contactRole]
//
// Default fields: phone only (the requested case). Pass --fields to widen.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadEnvFile } from './lib/shared.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
loadEnvFile(resolve(HERE, '.env'))

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')
const csvPath = args.find((a) => !a.startsWith('--'))
const fieldsArg = (() => {
  const i = args.indexOf('--fields')
  return i > -1 ? args[i + 1] : 'phone'
})()
const FIELDS = fieldsArg.split(',').map((f) => f.trim())

if (!csvPath || !existsSync(resolve(csvPath))) {
  console.error('Usage: node migration/backfill-merchant-fields.mjs <csv> [--commit] [--fields phone,contact,contactRole]')
  process.exit(1)
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('✗ SUPABASE_DB_URL missing (set it in migration/.env).')
  process.exit(1)
}

// CSV column → DB column
const COLMAP = { phone: 'phone', contact: 'contact', contactRole: 'contact_role' }

// ── reuse the same CSV parser + header aliases + fuzzy key as the importer ──
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  const first = text.split(/\r?\n/)[0] ?? ''
  const delim = first.includes('\t') && !first.includes(',') ? '\t' : ','
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}
const ALIASES = {
  name: ['name', 'merchant', 'business', 'company', 'merchant name'],
  contact: ['contact', 'contact name', 'primary contact'],
  contactRole: ['role', 'contact role', 'title', 'position'],
  phone: ['phone', 'phone number', 'mobile', 'tel', 'telephone', 'contact number', 'number'],
}
function mapHeaders(cells) {
  const norm = cells.map((h) => h.trim().toLowerCase())
  const idx = {}
  for (const [f, names] of Object.entries(ALIASES)) {
    const i = norm.findIndex((h) => names.includes(h))
    if (i >= 0) idx[f] = i
  }
  return idx
}
const fuzzyKey = (n) => n.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')

const all = parseCsv(readFileSync(resolve(csvPath), 'utf8'))
const idx = mapHeaders(all[0])
if (idx.name === undefined) {
  console.error('✗ no name column. Header: ' + all[0].join(' | '))
  process.exit(1)
}
const get = (cells, f) => (idx[f] !== undefined ? (cells[idx[f]] ?? '').trim() : '')

// Build best CSV value per merchant (first non-empty wins).
const byName = new Map() // lowercased name -> { phone, contact, contactRole }
const byFuzzy = new Map()
for (const cells of all.slice(1)) {
  const name = get(cells, 'name')
  if (!name) continue
  const rec = {
    phone: get(cells, 'phone'),
    contact: get(cells, 'contact'),
    contactRole: get(cells, 'contactRole'),
  }
  const lower = name.toLowerCase()
  const fk = fuzzyKey(name)
  // keep the first row that has the field; merge so a later row can fill a gap
  const cur = byName.get(lower) ?? {}
  for (const f of FIELDS) if (!cur[f] && rec[f]) cur[f] = rec[f]
  byName.set(lower, cur)
  const curF = byFuzzy.get(fk) ?? {}
  for (const f of FIELDS) if (!curF[f] && rec[f]) curF[f] = rec[f]
  byFuzzy.set(fk, curF)
}

const { Client } = pg
const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  const { rows: merchants } = await client.query(
    'select id, name, name_lower, phone, contact, contact_role from public.merchants',
  )
  const updates = [] // { id, name, changes: {col: {from,to}} }
  for (const m of merchants) {
    const src = byName.get(m.name_lower) ?? byFuzzy.get(fuzzyKey(m.name)) ?? null
    if (!src) continue
    const changes = {}
    for (const f of FIELDS) {
      const col = COLMAP[f]
      const dbVal = (m[col] ?? '').trim()
      const csvVal = (src[f] ?? '').trim()
      // ONLY fill when DB is blank and CSV has a value.
      if (!dbVal && csvVal) changes[col] = { from: dbVal, to: csvVal }
    }
    if (Object.keys(changes).length) updates.push({ id: m.id, name: m.name, changes })
  }

  console.log(`Fields backfilled: ${FIELDS.join(', ')}`)
  console.log(`Existing merchants: ${merchants.length}`)
  console.log(`Merchants that would be updated (blank field filled): ${updates.length}\n`)
  for (const u of updates.slice(0, 60)) {
    const parts = Object.entries(u.changes).map(([c, v]) => `${c}: "" -> "${v.to}"`)
    console.log(`  • ${u.name}  |  ${parts.join('  ')}`)
  }
  if (updates.length > 60) console.log(`  … and ${updates.length - 60} more`)
  console.log('')

  if (!COMMIT) {
    console.log('DRY RUN — nothing written. Re-run with --commit to apply.')
    process.exit(0)
  }
  if (!updates.length) { console.log('Nothing to backfill.'); process.exit(0) }

  await client.query('begin')
  let n = 0
  for (const u of updates) {
    const sets = Object.entries(u.changes)
    const setSql = sets.map(([c], i) => `${c} = $${i + 2}`).join(', ')
    const params = [u.id, ...sets.map(([, v]) => v.to)]
    await client.query(`update public.merchants set ${setSql} where id = $1`, params)
    n++
  }
  await client.query('commit')
  console.log(`\n✓ Backfilled ${n} merchant(s).`)
} catch (err) {
  await client.query('rollback').catch(() => {})
  console.error('\n✗ Failed — rolled back.')
  console.error(err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
