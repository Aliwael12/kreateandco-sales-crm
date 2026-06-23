import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { newId } from '@/lib/db'
import { refreshCollectionByPath } from '@/hooks/useCollection'
import { COL, type Project, type Stage } from '@/lib/types'
import { useCollection } from '@/hooks/useCollection'
import { useProfile } from '@/context/auth'
import { logActivity } from '@/lib/data'
import { useToast } from '@/components/ui/toast-context'
import Button from '@/components/ui/Button'

// Canonical column keys. NOTE: the `Merchant` key is an internal identifier
// kept for stability — it is *displayed* to users as "Lead" via LABELS below,
// and the CSV parser also accepts a legacy "Merchant" header (see ALIASES) so
// older exported files keep importing after the Merchant→Lead UI rename.
const COLUMNS = [
  'Merchant',
  'Industry',
  'Subcategory',
  'Contact',
  'Role',
  'Phone',
  'Email',
  'Status',
  'Rate',
  'Comments',
] as const

type ColumnKey = (typeof COLUMNS)[number]
type ParsedRow = Record<ColumnKey, string>

// User-facing label for each column key (only the renamed one differs).
const LABELS: Record<ColumnKey, string> = {
  Merchant: 'Lead',
  Industry: 'Industry',
  Subcategory: 'Subcategory',
  Contact: 'Contact',
  Role: 'Role',
  Phone: 'Phone',
  Email: 'Email',
  Status: 'Status',
  Rate: 'Rate',
  Comments: 'Comments',
}

// Extra header spellings accepted on import, mapped to a column key. Lets a CSV
// use the new "Lead" header (matching the UI) while still accepting the legacy
// "Merchant" header from previously-exported files.
const HEADER_ALIASES: Record<string, ColumnKey> = {
  lead: 'Merchant',
}

/** RFC-ish CSV parser. Handles quoted fields, escaped quotes, and CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
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
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        row.push(field)
        field = ''
      } else if (ch === '\r') {
        // skip; \n handles it
      } else if (ch === '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      } else if (ch === '\t' && row.length === 0 && field === '') {
        // tab-separated row start — treat as TSV
        row.push('')
      } else if (ch === '\t') {
        // TSV separator
        row.push(field)
        field = ''
      } else {
        field += ch
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

interface MappedRow extends ParsedRow {
  _line: number
  _errors: string[]
}

export default function ImportSection() {
  const me = useProfile()
  const toast = useToast()
  const { data: projects } = useCollection<Project>(COL.projects)
  const { data: stages } = useCollection<Stage>(COL.stages)

  const [projectId, setProjectId] = useState<string>('')
  const [text, setText] = useState<string>('')
  const [showPreview, setShowPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const validStatuses = useMemo(() => stages.map((s) => s.name), [stages])
  const defaultStatus =
    stages.slice().sort((a, b) => a.order - b.order)[0]?.name ??
    'Initial Contact'

  const parsed = useMemo<MappedRow[]>(() => {
    if (!text.trim()) return []
    const all = parseCsv(text)
    if (all.length === 0) return []
    const header = all[0].map((h) => h.trim())
    const colIdx: Partial<Record<ColumnKey, number>> = {}
    for (const col of COLUMNS) {
      const idx = header.findIndex((h) => {
        const lc = h.toLowerCase()
        return lc === col.toLowerCase() || HEADER_ALIASES[lc] === col
      })
      if (idx >= 0) colIdx[col] = idx
    }
    return all.slice(1).map((cells, i) => {
      const row: MappedRow = {
        Merchant: cells[colIdx.Merchant ?? -1]?.trim() ?? '',
        Industry: cells[colIdx.Industry ?? -1]?.trim() ?? '',
        Subcategory: cells[colIdx.Subcategory ?? -1]?.trim() ?? '',
        Contact: cells[colIdx.Contact ?? -1]?.trim() ?? '',
        Role: cells[colIdx.Role ?? -1]?.trim() ?? '',
        Phone: cells[colIdx.Phone ?? -1]?.trim() ?? '',
        Email: cells[colIdx.Email ?? -1]?.trim() ?? '',
        Status: cells[colIdx.Status ?? -1]?.trim() ?? defaultStatus,
        Rate: cells[colIdx.Rate ?? -1]?.trim() ?? '',
        Comments: cells[colIdx.Comments ?? -1]?.trim() ?? '',
        _line: i + 2,
        _errors: [],
      }
      if (!row.Merchant) row._errors.push('Lead name required')
      if (row.Status && !validStatuses.includes(row.Status)) {
        row._errors.push(`Unknown status "${row.Status}"`)
      }
      return row
    })
  }, [text, defaultStatus, validStatuses])

  const validRows = parsed.filter((r) => r._errors.length === 0)
  const invalidRows = parsed.filter((r) => r._errors.length > 0)

  async function runImport() {
    if (!projectId) {
      setResult('Pick a target project first.')
      return
    }
    if (validRows.length === 0) {
      setResult('Nothing to import — no valid rows.')
      return
    }
    setBusy(true)
    setResult(null)
    try {
      // Dedupe new rows against existing merchants by name. We fetch just the
      // id + name_lower of the merchants collection HERE (only when an admin
      // actually runs an import), rather than loading it on every page mount.
      const existingByName = new Map<string, string>()
      {
        const PAGE = 1000
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from(COL.merchants)
            .select('id, name_lower')
            .range(from, from + PAGE - 1)
          if (error) throw new Error(error.message)
          for (const d of data ?? []) {
            if (d.name_lower) existingByName.set(d.name_lower, d.id)
          }
          if (!data || data.length < PAGE) break
        }
      }

      // Build all new merchant + deal rows, then bulk-insert in chunks.
      let createdMerchants = 0
      let createdDeals = 0
      const newMerchants: Record<string, unknown>[] = []
      const newDeals: Record<string, unknown>[] = []
      for (const r of validRows) {
        const lower = r.Merchant.toLowerCase()
        let merchantId = existingByName.get(lower)
        if (!merchantId) {
          merchantId = newId()
          newMerchants.push({
            id: merchantId,
            name: r.Merchant,
            name_lower: lower,
            industry: r.Industry,
            subcategory: r.Subcategory,
            contact: r.Contact,
            contact_role: r.Role,
            phone: r.Phone,
            email: r.Email,
            created_by: me.id,
          })
          existingByName.set(lower, merchantId)
          createdMerchants++
        }
        newDeals.push({
          id: newId(),
          merchant_id: merchantId,
          merchant_name: r.Merchant,
          project_id: projectId,
          rep_id: me.id,
          status: r.Status,
          rate: r.Rate,
          comments: r.Comments,
          created_by: me.id,
          updated_by: me.id,
        })
        createdDeals++
      }

      // Merchants first (deals reference them by id), then deals. Chunked.
      for (let i = 0; i < newMerchants.length; i += 500) {
        const { error } = await supabase
          .from(COL.merchants)
          .insert(newMerchants.slice(i, i + 500))
        if (error) throw new Error(error.message)
      }
      for (let i = 0; i < newDeals.length; i += 500) {
        const { error } = await supabase
          .from(COL.deals)
          .insert(newDeals.slice(i, i + 500))
        if (error) throw new Error(error.message)
      }
      void refreshCollectionByPath(COL.merchants)
      void refreshCollectionByPath(COL.deals)

      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'merchant.create',
        text: `imported ${createdMerchants} leads and ${createdDeals} deals from CSV`,
        refKind: 'project',
        refId: projectId,
        meta: { projectId },
      })
      toast.show(
        `Imported ${createdDeals} deals (${createdMerchants} new leads)`,
      )
      setText('')
      setShowPreview(false)
      setResult(
        `Done — ${createdDeals} deals added, ${createdMerchants} new leads created.`,
      )
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white px-5 py-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[14px] font-bold">
          Import from Google Sheets / CSV
        </h2>
      </header>

      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-3">
        Paste a CSV (or copy-paste straight from Google Sheets — tab-separated
        also works). The header row is required. Recognised columns:{' '}
        <code className="font-mono-num text-[11.5px] text-ink-2">
          {COLUMNS.map((c) => LABELS[c]).join(', ')}
        </code>
        . Status must match one of your configured deal stages. Each row
        creates a deal owned by you on the chosen project. New leads get
        created automatically; existing ones are linked by name.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2.5">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
            Target Project *
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-major"
          >
            <option value="">— pick a project —</option>
            {/* Don't import merchants into a finished project. */}
            {projects
              .filter((p) => !p.completed)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Lead,Industry,Contact,Phone,Status,Rate,Comments\nFlippin' Burger,F&B,Ahmed Khalil,+20 100 123 4567,Negotiating,8% rev share,HQ approval pending\n…`}
        className="font-mono-num min-h-[150px] w-full resize-y rounded-lg border-[1.5px] border-line bg-ghost px-3 py-2 text-[12px] outline-none focus:border-major focus:bg-white"
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-[12px] text-ink-3">
          {parsed.length === 0
            ? 'No rows parsed yet.'
            : `${validRows.length} valid row${validRows.length === 1 ? '' : 's'}, ${invalidRows.length} with issues.`}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview((v) => !v)}
            disabled={parsed.length === 0}
          >
            {showPreview ? 'Hide preview' : 'Preview'}
          </Button>
          <Button
            size="sm"
            onClick={runImport}
            disabled={busy || validRows.length === 0 || !projectId}
          >
            {busy ? 'Importing…' : `Import ${validRows.length}`}
          </Button>
        </div>
      </div>

      {result && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] ${
            result.startsWith('Done')
              ? 'bg-ok-light text-ok'
              : 'bg-bad-light text-bad'
          }`}
        >
          {result}
        </div>
      )}

      {showPreview && parsed.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="min-w-full text-[12px]">
            <thead>
              <tr>
                {['#', ...COLUMNS.map((c) => LABELS[c]), 'Errors'].map((h) => (
                  <th
                    key={h}
                    className="border-b border-line bg-ghost px-2.5 py-1.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-ink-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.map((r) => (
                <tr
                  key={r._line}
                  className={
                    r._errors.length > 0 ? 'bg-bad-light/40' : 'hover:bg-ghost'
                  }
                >
                  <td className="px-2.5 py-1.5 text-ink-3">{r._line}</td>
                  {COLUMNS.map((c) => (
                    <td key={c} className="px-2.5 py-1.5">
                      {r[c] || (
                        <span className="italic text-ink-4">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-2.5 py-1.5 text-bad">
                    {r._errors.join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
