#!/usr/bin/env node
// ============================================================================
// Merchant-only bulk import (no deals, no projects, no reps).
//
// Adds rows from a CSV straight into public.merchants so they appear in the
// "All Merchants" tab and nowhere else. Unlike the app's Admin → Import (which
// creates a deal per row tied to a project/rep), this ONLY creates merchants.
//
// • Dedupes by case-insensitive name against existing merchants AND within the
//   file itself — an existing/duplicate name is skipped, not re-added.
// • DRY-RUN BY DEFAULT: prints exactly what it would do and surfaces problems.
//   Re-run with --commit to actually write.
//
// Usage:
//   node migration/import-merchants.mjs <path-to-csv> [--commit] \
//        [--created-by <user-uuid>]
//
//   --created-by  optional public.users.id to record as merchants.created_by.
//                 Defaults to the first Admin found. (created_by is just
//                 provenance here; it does NOT assign the merchant to anyone.)
//
// Reads SUPABASE_DB_URL from migration/.env.
//
// Header mapping is flexible/case-insensitive. Recognised header aliases:
//   name        : name | merchant | business | business name | company
//   industry    : industry | category
//   subcategory : subcategory | sub category | sub-category | subindustry
//   contact     : contact | contact name | primary contact
//   contactRole : role | contact role | title | position
//   phone       : phone | phone number | mobile | tel
//   email       : email | e-mail | mail
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadEnvFile, newIdNode } from './lib/shared.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
loadEnvFile(resolve(HERE, '.env'))

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')
const csvPath = args.find((a) => !a.startsWith('--'))
const createdByArg = (() => {
  const i = args.indexOf('--created-by')
  return i > -1 ? args[i + 1] : null
})()
// Optional: force an industry for EVERY row (use when the file has no industry
// column but all rows share one, e.g. an "F&B" sheet). A per-row industry
// column, if present, takes precedence over this default.
const industryArg = (() => {
  const i = args.indexOf('--industry')
  return i > -1 ? args[i + 1] : null
})()

if (!csvPath) {
  console.error('Usage: node migration/import-merchants.mjs <path-to-csv> [--commit] [--created-by <uuid>]')
  process.exit(1)
}
const csvAbs = resolve(csvPath)
if (!existsSync(csvAbs)) {
  console.error(`✗ CSV not found: ${csvAbs}`)
  process.exit(1)
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('✗ SUPABASE_DB_URL missing (set it in migration/.env).')
  process.exit(1)
}

// ── CSV parser (handles quotes, escaped quotes, CRLF, and TSV) ───────────────
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  // Detect delimiter from the header line: tab if present, else comma.
  const firstLine = text.split(/\r?\n/)[0] ?? ''
  const delim = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ','
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\r') {
      // ignore; \n ends the row
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// ── header aliases → canonical field ─────────────────────────────────────────
const ALIASES = {
  name: ['name', 'merchant', 'business', 'business name', 'company', 'merchant name'],
  industry: ['industry', 'category'],
  subcategory: ['subcategory', 'sub category', 'sub-category', 'subindustry', 'sub industry'],
  contact: ['contact', 'contact name', 'primary contact'],
  contactRole: ['role', 'contact role', 'title', 'position'],
  phone: ['phone', 'phone number', 'mobile', 'tel', 'telephone', 'contact number', 'number'],
  email: ['email', 'e-mail', 'mail'],
}

function mapHeaders(headerCells) {
  const norm = headerCells.map((h) => h.trim().toLowerCase())
  const idx = {}
  for (const [field, names] of Object.entries(ALIASES)) {
    const found = norm.findIndex((h) => names.includes(h))
    if (found >= 0) idx[field] = found
  }
  return idx
}

const text = readFileSync(csvAbs, 'utf8')
const all = parseCsv(text)
if (all.length < 2) {
  console.error('✗ CSV has no data rows (need a header row + at least one row).')
  process.exit(1)
}
const idx = mapHeaders(all[0])
if (idx.name === undefined) {
  console.error(
    '✗ Could not find a "name" column. Header was:\n   ' +
      all[0].join(' | ') +
      '\n  Rename the business-name column to one of: ' +
      ALIASES.name.join(', '),
  )
  process.exit(1)
}

console.log('Header mapping detected:')
for (const f of Object.keys(ALIASES)) {
  console.log(`  ${f.padEnd(12)} ${idx[f] !== undefined ? `column "${all[0][idx[f]].trim()}"` : '(not present)'}`)
}
console.log('')

const get = (cells, f) => (idx[f] !== undefined ? (cells[idx[f]] ?? '').trim() : '')

// ── name cleaning: strip obvious trailing status notes ──────────────────────
// Cuts trailing annotations the team typed into the name cell, e.g.
//   "bowla / not interested" -> "bowla"
//   "Shihlin / Not interested" -> "Shihlin"
//   "Dazzle Egypt signed" -> "Dazzle Egypt"   (only the trailing word "signed")
// Conservative: only removes a KNOWN set of trailing status phrases, never
// interior text, so real names with slashes (e.g. "Tut's Hub/the platter",
// "coco/ pablo & abdo") are left intact.
const TRAILING_NOTE = new RegExp(
  '\\s*(?:[/-]\\s*)?(?:not interested|notinterested|signed|not operating|' +
    'closed|cancelled|canceled|duplicate|dup|left|done)\\s*$',
  'i',
)
function cleanName(raw) {
  let n = raw.trim()
  // Apply repeatedly in case of stacked notes ("x / signed / done").
  let prev
  do {
    prev = n
    n = n.replace(TRAILING_NOTE, '').trim()
    // also drop a dangling separator left behind
    n = n.replace(/[/-]\s*$/, '').trim()
  } while (n !== prev && n.length > 0)
  return n || raw.trim() // never return empty
}

// ── fuzzy key: normalize for near-duplicate detection ───────────────────────
// Lowercase, '&'->'and', strip spaces and most punctuation. So
// "Brunch & Cake" / "Brunch and cake" / "Brunch&Cake" all collapse to the same
// key; "garnel"/"Garnell" do NOT (different letters) — by design we only merge
// punctuation/spacing/&-and differences, not spelling variants.
function fuzzyKey(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')
}

// ── connect + dedupe + insert ────────────────────────────────────────────────
const { Client } = pg
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

try {
  // Resolve created_by (provenance only).
  let createdBy = createdByArg
  if (!createdBy) {
    const { rows } = await client.query(
      "select id from public.users where role = 'Admin' order by created_at limit 1",
    )
    createdBy = rows[0]?.id ?? null
  }
  if (!createdBy) {
    console.warn('⚠ No --created-by and no Admin found; created_by will be null.')
  }

  // Existing names (lowercased) for dedupe.
  const existing = new Set() // exact lowercased names already in DB
  const existingFuzzy = new Set() // fuzzy keys already in DB
  {
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { rows } = await client.query(
        'select name, name_lower from public.merchants order by id offset $1 limit $2',
        [from, PAGE],
      )
      rows.forEach((r) => {
        existing.add(r.name_lower)
        existingFuzzy.add(fuzzyKey(r.name ?? r.name_lower))
      })
      if (rows.length < PAGE) break
    }
  }
  console.log(`Existing merchants in DB: ${existing.size}`)

  const seenFuzzy = new Set() // fuzzy keys seen so far in THIS file
  const toInsert = []
  let skippedDupDb = 0
  let skippedDupFile = 0
  let skippedNoName = 0
  const nameEdits = [] // { from, to } — note-stripping changes (for review)
  const fuzzyMerges = [] // { kept, dropped, reason } — collapsed near-dupes

  for (const cells of all.slice(1)) {
    const rawName = get(cells, 'name')
    if (!rawName) {
      skippedNoName++
      continue
    }
    // 1. strip trailing status notes
    const name = cleanName(rawName)
    if (name !== rawName) nameEdits.push({ from: rawName, to: name })

    const lower = name.toLowerCase()
    const fkey = fuzzyKey(name)

    // 2. dedup vs DB (exact first, then fuzzy)
    if (existing.has(lower)) {
      skippedDupDb++
      continue
    }
    if (existingFuzzy.has(fkey)) {
      skippedDupDb++
      fuzzyMerges.push({ kept: '(existing in DB)', dropped: name, reason: 'fuzzy-matches a DB merchant' })
      continue
    }
    // 3. dedup vs earlier rows in this file (fuzzy covers exact too)
    if (seenFuzzy.has(fkey)) {
      skippedDupFile++
      const keptRow = toInsert.find((m) => fuzzyKey(m.name) === fkey)
      fuzzyMerges.push({ kept: keptRow ? keptRow.name : '(earlier row)', dropped: name, reason: 'fuzzy-matches an earlier row' })
      continue
    }
    seenFuzzy.add(fkey)
    toInsert.push({
      id: newIdNode(),
      name,
      name_lower: lower,
      // Per-row industry wins; otherwise fall back to the --industry default.
      industry: get(cells, 'industry') || industryArg || '',
      subcategory: get(cells, 'subcategory'),
      contact: get(cells, 'contact'),
      contact_role: get(cells, 'contactRole'),
      phone: get(cells, 'phone'),
      email: get(cells, 'email'),
      created_by: createdBy,
    })
  }

  console.log('')
  console.log(`Rows in file (excl. header): ${all.length - 1}`)
  console.log(`  to insert (new merchants):   ${toInsert.length}`)
  console.log(`  skipped — already in DB:     ${skippedDupDb}`)
  console.log(`  skipped — duplicate in file: ${skippedDupFile}`)
  console.log(`  skipped — no name:           ${skippedNoName}`)
  console.log('')

  // ── REVIEW: name edits (note-stripping) ──
  console.log(`Name edits (trailing notes stripped): ${nameEdits.length}`)
  for (const e of nameEdits) console.log(`    "${e.from}"  ->  "${e.to}"`)
  console.log('')

  // ── REVIEW: fuzzy merges (collapsed near-duplicates) ──
  console.log(`Fuzzy near-duplicates collapsed: ${fuzzyMerges.length}`)
  for (const m of fuzzyMerges) console.log(`    dropped "${m.dropped}"  (${m.reason}; kept: ${m.kept})`)
  console.log('')

  // Show a sample so you can eyeball the mapping.
  console.log('Sample of what would be inserted (first 8):')
  for (const m of toInsert.slice(0, 8)) {
    console.log(`  • ${m.name}  [${m.industry || '—'}${m.subcategory ? ' / ' + m.subcategory : ''}]  contact: ${m.contact || '—'}  phone: ${m.phone || '—'}`)
  }
  console.log('')

  if (!COMMIT) {
    console.log('DRY RUN — nothing written. Re-run with --commit to insert.')
    process.exit(0)
  }

  if (toInsert.length === 0) {
    console.log('Nothing to insert.')
    process.exit(0)
  }

  // Bulk insert in chunks, inside a transaction.
  await client.query('begin')
  let inserted = 0
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500)
    const cols = ['id', 'name', 'name_lower', 'industry', 'subcategory', 'contact', 'contact_role', 'phone', 'email', 'created_by']
    const values = []
    const params = []
    chunk.forEach((m, r) => {
      const base = r * cols.length
      values.push('(' + cols.map((_, c) => `$${base + c + 1}`).join(',') + ')')
      params.push(m.id, m.name, m.name_lower, m.industry, m.subcategory, m.contact, m.contact_role, m.phone, m.email, m.created_by)
    })
    await client.query(
      `insert into public.merchants (${cols.join(',')}) values ${values.join(',')}`,
      params,
    )
    inserted += chunk.length
    process.stdout.write(`\r  inserted ${inserted}/${toInsert.length}`)
  }
  await client.query('commit')
  console.log(`\n\n✓ Done. Added ${inserted} merchants (no deals/projects/reps).`)
} catch (err) {
  await client.query('rollback').catch(() => {})
  console.error('\n✗ Failed — rolled back, nothing inserted.')
  console.error(err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
