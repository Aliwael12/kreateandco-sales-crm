import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Plus, Trash2, X } from 'lucide-react'
import { useCollection, refreshCollectionByPath } from '@/hooks/useCollection'
import { useIndustries } from '@/hooks/useIndustries'
import { useSubcategories } from '@/hooks/useSubcategories'
import { usePlatforms } from '@/hooks/usePlatforms'
import {
  COL,
  where,
  type Deal,
  type Merchant,
  type MerchantContact,
  type MerchantLink,
  type Project,
  type Stage,
  type User,
} from '@/lib/types'
import { linkIconFor, normalizeUrl } from '@/lib/linkIcons'
import { ProjectBadge } from '@/components/ui/StatusBadge'
import {
  logActivity,
  reassignDeal,
  updateDealField,
  updateMerchant,
} from '@/lib/data'
import { supabase } from '@/lib/supabase'
import { newId } from '@/lib/db'
import { useProfile, isAdmin, canSeeAll, canReassign } from '@/context/auth'
import { useToast } from '@/components/ui/toast-context'
import clsx from 'clsx'

interface Props {
  merchantId: string | null
  onClose: () => void
  projects: Project[]
  stages: Stage[]
  users: User[]
  merchants: Merchant[]
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function strColor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  const palette = [
    '#5B4FCF',
    '#0f9e6e',
    '#1565c0',
    '#e91e63',
    '#b87209',
    '#6d28d9',
    '#d63c2e',
    '#FF6B5E',
  ]
  return palette[Math.abs(h) % palette.length]
}

// Derive the editable contact list. Newer merchants store a `contacts` array;
// older ones only have the flat contact/role/phone/email fields, so we seed a
// single row from those.
function initialContacts(m: Merchant): MerchantContact[] {
  if (m.contacts && m.contacts.length > 0) {
    return m.contacts.map((c) => ({
      name: c.name ?? '',
      role: c.role ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
    }))
  }
  return [
    {
      name: m.contact ?? '',
      role: m.contactRole ?? '',
      phone: m.phone ?? '',
      email: m.email ?? '',
    },
  ]
}

export default function MerchantDetailModal({
  merchantId,
  onClose,
  projects,
  stages,
  users,
  merchants,
}: Props) {
  const merchant = useMemo(
    () => merchants.find((m) => m.id === merchantId) ?? null,
    [merchantId, merchants],
  )
  const { data: deals } = useCollection<Deal>(
    COL.deals,
    merchantId ? [where('merchantId', '==', merchantId)] : [],
    merchantId ? `deals:merchantId=${merchantId}` : undefined,
  )

  if (!merchantId || !merchant) return null

  // Key by id so the draft state resets cleanly when switching merchants.
  return (
    <MerchantDetailContent
      key={merchant.id}
      merchant={merchant}
      deals={deals}
      projects={projects}
      stages={stages}
      users={users}
      onClose={onClose}
    />
  )
}

interface ContentProps {
  merchant: Merchant
  deals: Deal[]
  projects: Project[]
  stages: Stage[]
  users: User[]
  onClose: () => void
}

function MerchantDetailContent({
  merchant,
  deals,
  projects,
  stages,
  users,
  onClose,
}: ContentProps) {
  const toast = useToast()
  const { names: industries } = useIndustries()
  const { namesFor } = useSubcategories()
  const { names: platformNames } = usePlatforms()

  // Draft state — edits live here until "Save changes" persists them.
  const [name, setName] = useState(merchant.name)
  const [industry, setIndustry] = useState(merchant.industry ?? '')
  const [subcategory, setSubcategory] = useState(merchant.subcategory ?? '')
  const [platform, setPlatform] = useState(merchant.platform ?? '')
  const [contacts, setContacts] = useState<MerchantContact[]>(() =>
    initialContacts(merchant),
  )
  const [links, setLinks] = useState<MerchantLink[]>(
    () => merchant.links ?? [],
  )
  // Mount-time snapshot so the Save button only lights up on a real change.
  const [baseline, setBaseline] = useState(() => ({
    name: merchant.name,
    industry: merchant.industry ?? '',
    subcategory: merchant.subcategory ?? '',
    platform: merchant.platform ?? '',
    contacts: JSON.stringify(initialContacts(merchant)),
    links: JSON.stringify(merchant.links ?? []),
  }))
  const [busy, setBusy] = useState(false)

  const subOptions = namesFor(industry)

  const dirty =
    name !== baseline.name ||
    platform !== baseline.platform ||
    industry !== baseline.industry ||
    subcategory !== baseline.subcategory ||
    JSON.stringify(contacts) !== baseline.contacts ||
    JSON.stringify(links) !== baseline.links

  const av = initials(name || merchant.name)
  const avBg = strColor(merchant.name)

  function updateContact(
    idx: number,
    key: keyof MerchantContact,
    value: string,
  ) {
    setContacts((cs) =>
      cs.map((c, i) => (i === idx ? { ...c, [key]: value } : c)),
    )
  }
  function addContact() {
    setContacts((cs) => [...cs, { name: '', role: '', phone: '', email: '' }])
  }
  function removeContact(idx: number) {
    setContacts((cs) => cs.filter((_, i) => i !== idx))
  }

  function updateLink(idx: number, key: keyof MerchantLink, value: string) {
    setLinks((ls) =>
      ls.map((l, i) => (i === idx ? { ...l, [key]: value } : l)),
    )
  }
  function addLink() {
    setLinks((ls) => [...ls, { url: '', label: '' }])
  }
  function removeLink(idx: number) {
    setLinks((ls) => ls.filter((_, i) => i !== idx))
  }

  async function save() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.show("Name can't be empty")
      return
    }
    // Drop fully-blank rows; the first remaining contact mirrors into the flat
    // fields the rest of the app (table, sheet, export) still reads.
    const cleaned = contacts
      .map((c) => ({
        name: c.name.trim(),
        role: c.role.trim(),
        phone: c.phone.trim(),
        email: c.email.trim(),
      }))
      .filter((c) => c.name || c.role || c.phone || c.email)
    const primary = cleaned[0] ?? { name: '', role: '', phone: '', email: '' }
    // Drop links with no URL; trim the rest.
    const cleanedLinks = links
      .map((l) => ({ url: l.url.trim(), label: l.label?.trim() || undefined }))
      .filter((l) => l.url)
    setBusy(true)
    try {
      await updateMerchant(merchant.id, {
        name: trimmedName,
        industry,
        subcategory,
        platform,
        contacts: cleaned,
        links: cleanedLinks,
        contact: primary.name,
        contactRole: primary.role,
        phone: primary.phone,
        email: primary.email,
      })
      // Reflect the cleaned list back into the editor and re-baseline so the
      // form reads as "saved" again (always keep at least one visible row).
      const nextContacts =
        cleaned.length > 0
          ? cleaned
          : [{ name: '', role: '', phone: '', email: '' }]
      setContacts(nextContacts)
      setLinks(cleanedLinks)
      setBaseline({
        name: trimmedName,
        industry,
        subcategory,
        platform,
        contacts: JSON.stringify(nextContacts),
        links: JSON.stringify(cleanedLinks),
      })
      toast.show('Lead updated')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't save lead")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[500] flex items-center justify-center bg-navy/45 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[90vh] w-[660px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_70px_rgba(11,31,75,.25)]">
        <header className="flex items-start gap-3.5 border-b border-line p-6 pb-4">
          <div
            className="font-display flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-[16px] font-extrabold text-white"
            style={{ background: avBg }}
          >
            {av}
          </div>
          <div className="flex-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lead name"
              className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 font-display text-[18px] font-extrabold text-ink-1 outline-none transition-colors hover:border-line focus:border-major focus:bg-white"
            />
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <select
                value={industry}
                onChange={(e) => {
                  // Changing industry clears the subcategory (it belonged to the
                  // old industry).
                  setIndustry(e.target.value)
                  setSubcategory('')
                }}
                className="cursor-pointer rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[12px] text-ink-3 outline-none transition-colors hover:border-line focus:border-major focus:bg-white"
              >
                <option value="">— industry —</option>
                {industries.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
              {subOptions.length > 0 && (
                <select
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className="cursor-pointer rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[12px] text-ink-3 outline-none transition-colors hover:border-line focus:border-major focus:bg-white"
                >
                  <option value="">— subcategory —</option>
                  {subOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              {platformNames.length > 0 && (
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  aria-label="Platform"
                  className="cursor-pointer rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[12px] text-ink-3 outline-none transition-colors hover:border-line focus:border-major focus:bg-white"
                >
                  <option value="">— platform —</option>
                  {platformNames.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer text-ink-3 hover:text-ink-1"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
          <section>
            <div className="mb-2.5 flex items-center justify-between border-b border-line pb-1.5">
              <h3 className="text-[10.5px] font-bold uppercase tracking-widest text-ink-3">
                Contacts ({contacts.length})
              </h3>
              <button
                type="button"
                onClick={addContact}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-major transition-colors hover:bg-major-light"
              >
                <Plus size={12} /> Add another contact
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              {contacts.map((c, i) => (
                <div key={i} className="rounded-[10px] border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-3">
                      Contact {i + 1}
                      {i === 0 && (
                        <span className="rounded bg-major-light px-1.5 py-px text-[9.5px] text-major">
                          primary
                        </span>
                      )}
                    </span>
                    {contacts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeContact(i)}
                        aria-label={`Remove contact ${i + 1}`}
                        title="Remove contact"
                        className="rounded p-1 text-ink-3 transition-colors hover:bg-bad-light hover:text-bad"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <ContactField
                      label="Contact Name"
                      value={c.name}
                      onChange={(v) => updateContact(i, 'name', v)}
                      placeholder="Add a name…"
                    />
                    <ContactField
                      label="Role"
                      value={c.role}
                      onChange={(v) => updateContact(i, 'role', v)}
                      placeholder="e.g. Branch Manager"
                    />
                    <ContactField
                      label="Phone"
                      value={c.phone}
                      onChange={(v) => updateContact(i, 'phone', v)}
                      placeholder="+20 1X XXXX XXXX"
                      mono
                    />
                    <ContactField
                      label="Email"
                      value={c.email}
                      onChange={(v) => updateContact(i, 'email', v)}
                      placeholder="contact@business.com"
                      accent
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2.5 flex items-center justify-between border-b border-line pb-1.5">
              <h3 className="text-[10.5px] font-bold uppercase tracking-widest text-ink-3">
                Links ({links.length})
              </h3>
              <button
                type="button"
                onClick={addLink}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-major transition-colors hover:bg-major-light"
              >
                <Plus size={12} /> Add link
              </button>
            </div>
            {links.length === 0 ? (
              <p className="py-2 text-[12px] italic text-ink-3">
                No links yet. Add a website, social profile, or online menu.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {links.map((l, i) => (
                  <LinkRow
                    key={i}
                    link={l}
                    onChangeUrl={(v) => updateLink(i, 'url', v)}
                    onChangeLabel={(v) => updateLink(i, 'label', v)}
                    onRemove={() => removeLink(i)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2.5 border-b border-line pb-1.5 text-[10.5px] font-bold uppercase tracking-widest text-ink-3">
              Projects &amp; Deals ({deals.length})
            </h3>
            {deals.length === 0 ? (
              <p className="py-3 text-[12.5px] italic text-ink-3">
                No deals yet for this lead.
              </p>
            ) : (
              <ProjectDealList
                deals={deals}
                projects={projects}
                stages={stages}
                users={users}
              />
            )}
            <AddToProjectControl
              merchant={merchant}
              deals={deals}
              projects={projects}
              stages={stages}
              users={users}
            />
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2.5 border-t border-line bg-white px-6 py-3.5">
          {dirty && (
            <span className="mr-auto text-[12px] italic text-ink-3">
              Unsaved changes
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-white px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:border-major hover:text-major"
          >
            Close
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy}
            className="rounded-lg bg-major px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#4a3fb8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}

// Controlled contact field (label + input). Unlike EditableInput it does NOT
// auto-save — edits live in the parent draft until "Save changes" is pressed.
// One editable merchant link: an adaptive brand icon derived from the URL, the
// URL itself, an optional label, an "open" button, and a remove button.
function LinkRow({
  link,
  onChangeUrl,
  onChangeLabel,
  onRemove,
}: {
  link: MerchantLink
  onChangeUrl: (v: string) => void
  onChangeLabel: (v: string) => void
  onRemove: () => void
}) {
  const { Icon, color, label: platform } = linkIconFor(link.url)
  const href = normalizeUrl(link.url)
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-line p-2">
      <span
        title={platform}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${color}1a`, color }}
      >
        <Icon size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          value={link.url}
          onChange={(e) => onChangeUrl(e.target.value)}
          placeholder="Paste a link (e.g. instagram.com/their-handle)"
          className="w-full rounded-md border border-line bg-white px-2 py-1 text-[13px] outline-none transition-colors focus:border-major"
        />
        <input
          value={link.label ?? ''}
          onChange={(e) => onChangeLabel(e.target.value)}
          placeholder={`Label (optional) — defaults to "${platform}"`}
          className="w-full rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[11.5px] text-ink-3 outline-none transition-colors hover:border-line focus:border-major focus:bg-white"
        />
      </div>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${platform} link`}
          title="Open link"
          className="flex-shrink-0 rounded-md p-1.5 text-ink-3 transition-colors hover:bg-ghost hover:text-major"
        >
          <ExternalLink size={14} />
        </a>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove link"
        title="Remove link"
        className="flex-shrink-0 rounded-md p-1.5 text-ink-3 transition-colors hover:bg-bad-light hover:text-bad"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function ContactField({
  label,
  value,
  onChange,
  placeholder,
  mono,
  accent,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  accent?: boolean
}) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] text-ink-3">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(
          'w-full rounded-md border border-line bg-white px-2 py-1.5 text-[13.5px] outline-none transition-colors focus:border-major',
          mono && 'font-mono-num text-[12.5px]',
          accent && 'text-major',
        )}
      />
    </div>
  )
}

// ─── add-to-project (creates a single deal for this merchant) ──────────────

interface AddToProjectControlProps {
  merchant: Merchant
  deals: Deal[]
  projects: Project[]
  stages: Stage[]
  users: User[]
}

// Inline "add this merchant to a project" form inside the merchant card. Mirrors
// BulkAddToProjectModal's write path, but for a single merchant: it creates one
// deal (merchant + project + rep + initial status), attaches the rep to the
// project, and logs the activity.
function AddToProjectControl({
  merchant,
  deals,
  projects,
  stages,
  users,
}: AddToProjectControlProps) {
  const me = useProfile()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [assigneeId, setAssigneeId] = useState(me.id)
  const [statusName, setStatusName] = useState('')
  const [busy, setBusy] = useState(false)

  const orderedStages = useMemo(
    () => stages.slice().sort((a, b) => a.order - b.order),
    [stages],
  )
  const defaultStatus = orderedStages[0]?.name ?? 'Initial Contact'
  const effectiveStatus = statusName || defaultStatus

  // Sales Head / Admin can assign to anyone; reps can only assign to themselves
  // (deals must be owned by the caller per the security rules).
  const canPickAnyAssignee = isAdmin(me.role) || canSeeAll(me.role)

  const assigneeOptions = useMemo(
    () =>
      users
        .filter((u) => !u.disabled)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )

  // Hide projects this merchant already has a deal in — adding again would just
  // create a duplicate — and completed projects (no new work goes to them).
  const availableProjects = useMemo(() => {
    const taken = new Set(deals.map((d) => d.projectId))
    return projects.filter((p) => !taken.has(p.id) && !p.completed)
  }, [deals, projects])

  if (availableProjects.length === 0) {
    return (
      <p className="mt-2.5 text-[11.5px] italic text-ink-3">
        This lead is already in every project.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-semibold text-major transition-colors hover:bg-major-light"
      >
        <Plus size={13} /> Add to a project
      </button>
    )
  }

  async function add() {
    if (!projectId) {
      toast.show('Pick a project first')
      return
    }
    if (!canPickAnyAssignee && assigneeId !== me.id) {
      toast.show('You can only add leads under your own name')
      return
    }
    setBusy(true)
    try {
      const assignee = users.find((u) => u.id === assigneeId)
      const project = projects.find((p) => p.id === projectId)

      const { error } = await supabase.from(COL.deals).insert({
        id: newId(),
        merchant_id: merchant.id,
        merchant_name: merchant.name,
        project_id: projectId,
        rep_id: assigneeId,
        status: effectiveStatus,
        rate: '',
        comments: '',
        created_by: me.id,
        updated_by: me.id,
      })
      if (error) throw new Error(error.message)

      // If the assignee isn't already attached to this project, attach them.
      // Non-fatal — an admin can attach manually if RLS rejects it.
      if (assignee && !(assignee.projectIds ?? []).includes(projectId)) {
        const next = [...(assignee.projectIds ?? []), projectId]
        await supabase
          .from(COL.users)
          .update({ project_ids: next })
          .eq('id', assigneeId)
      }

      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'deal.create',
        text: `added ${merchant.name} to ${project?.name ?? 'a project'} under ${assignee?.name ?? 'rep'}`,
        refId: projectId,
        refKind: 'project',
        meta: { projectId, merchantId: merchant.id },
      })

      void refreshCollectionByPath(COL.deals)
      toast.show(`Added to ${project?.name ?? 'project'}`)

      // Reset for a possible next add; keep the assignee/status picks.
      setProjectId('')
      setOpen(false)
    } catch (err) {
      toast.show(
        err instanceof Error ? err.message : "Couldn't add to project",
      )
    } finally {
      setBusy(false)
    }
  }

  const selectCls =
    'cursor-pointer rounded-md border-[1.5px] border-line bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-major disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="mt-2.5 rounded-[10px] border border-major/40 bg-major-light/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-major">
          Add to a project
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded p-0.5 text-ink-3 hover:text-ink-1"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Project
          </span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={selectCls}
          >
            <option value="">— pick a project —</option>
            {availableProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Rep
          </span>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            disabled={!canPickAnyAssignee}
            className={selectCls}
          >
            {assigneeOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Status
          </span>
          <select
            value={effectiveStatus}
            onChange={(e) => setStatusName(e.target.value)}
            className={selectCls}
          >
            {orderedStages.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={add}
          disabled={busy || !projectId}
          className="rounded-lg bg-major px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#4a3fb8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {!canPickAnyAssignee && (
        <p className="mt-1.5 text-[11px] text-ink-3">
          Reps can only assign to themselves.
        </p>
      )}
    </div>
  )
}

// ─── editable field primitive (deal edits stay live / auto-save) ───────────

interface EditableInputProps {
  initialValue: string
  placeholder?: string
  type?: 'text' | 'email' | 'tel'
  mono?: boolean
  accent?: boolean
  multiline?: boolean
  onCommit: (next: string) => Promise<void>
}

function EditableInput({
  initialValue,
  placeholder,
  type = 'text',
  mono,
  accent,
  multiline,
  onCommit,
}: EditableInputProps) {
  const [local, setLocal] = useState(initialValue)
  const [busy, setBusy] = useState(false)

  // Re-sync if the underlying value changes externally (e.g. after a refresh)
  // — syncing local state to a prop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(initialValue)
  }, [initialValue])

  async function commit() {
    if (local === initialValue) return
    setBusy(true)
    try {
      await onCommit(local)
    } catch {
      setLocal(initialValue) // revert on error
    } finally {
      setBusy(false)
    }
  }

  const className = clsx(
    'w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13.5px] outline-none transition-colors',
    'hover:border-line focus:border-major focus:bg-white',
    mono && 'font-mono-num text-[12.5px]',
    accent && 'text-major',
    busy && 'opacity-60',
    !local && 'italic text-ink-4',
  )

  if (multiline) {
    return (
      <textarea
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        placeholder={placeholder}
        className={clsx(className, 'min-h-[60px] resize-y leading-relaxed')}
      />
    )
  }

  return (
    <input
      type={type}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setLocal(initialValue)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      placeholder={placeholder}
      className={className}
    />
  )
}

// ─── deal blocks (editable) ──────────────────────────────────────────────

interface ProjectDealListProps {
  deals: Deal[]
  projects: Project[]
  stages: Stage[]
  users: User[]
}

function ProjectDealList({
  deals,
  projects,
  stages,
  users,
}: ProjectDealListProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, Deal[]>()
    for (const d of deals) {
      const arr = map.get(d.projectId) ?? []
      arr.push(d)
      map.set(d.projectId, arr)
    }
    return [...map.entries()].sort((a, b) => {
      const aMs = Math.max(
        ...a[1].map((d) => d.updatedAt?.toMillis?.() ?? 0),
      )
      const bMs = Math.max(
        ...b[1].map((d) => d.updatedAt?.toMillis?.() ?? 0),
      )
      return bMs - aMs
    })
  }, [deals])

  return (
    <div className="flex flex-col gap-2.5">
      {grouped.map(([projectId, projectDeals]) => (
        <ProjectDealBlock
          key={projectId}
          projectId={projectId}
          deals={projectDeals}
          projects={projects}
          stages={stages}
          users={users}
        />
      ))}
    </div>
  )
}

interface ProjectDealBlockProps {
  projectId: string
  deals: Deal[]
  projects: Project[]
  stages: Stage[]
  users: User[]
}

function ProjectDealBlock({
  projectId,
  deals,
  projects,
  stages,
  users,
}: ProjectDealBlockProps) {
  const sorted = useMemo(
    () =>
      deals
        .slice()
        .sort(
          (a, b) =>
            (a.createdAt?.toMillis?.() ?? 0) -
            (b.createdAt?.toMillis?.() ?? 0),
        ),
    [deals],
  )
  const [activeIdx, setActiveIdx] = useState(0)
  const active = sorted[Math.min(activeIdx, sorted.length - 1)]

  if (sorted.length === 1) {
    return (
      <div className="rounded-[10px] border border-line p-3">
        <DealEditor
          deal={sorted[0]}
          projects={projects}
          stages={stages}
          users={users}
        />
      </div>
    )
  }

  return (
    <div className="rounded-[10px] border border-major/40 bg-major-light/30">
      <div className="flex items-center gap-2 border-b border-line px-3 pt-2.5">
        <ProjectBadge projectId={projectId} projects={projects} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-major">
          {sorted.length} reps on this merchant
        </span>
        <div className="ml-auto flex gap-1">
          {sorted.map((d, i) => {
            const rep = users.find((u) => u.id === d.repId)
            const isActive = i === activeIdx
            return (
              <button
                key={d.id}
                onClick={() => setActiveIdx(i)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-t-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                  isActive
                    ? 'bg-white text-ink-1 shadow-[0_-1px_0_0_var(--color-major)]'
                    : 'text-ink-3 hover:bg-white/60 hover:text-ink-1',
                )}
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: rep?.color ?? '#999' }}
                >
                  {rep?.name?.[0]?.toUpperCase() ?? '?'}
                </span>
                {rep?.name ?? '—'}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-white px-3 py-3">
        <DealEditor
          deal={active}
          projects={projects}
          stages={stages}
          users={users}
          hideProjectBadge
        />
      </div>
    </div>
  )
}

interface DealEditorProps {
  deal: Deal
  projects: Project[]
  stages: Stage[]
  users: User[]
  hideProjectBadge?: boolean
}

function DealEditor({
  deal,
  projects,
  stages,
  users,
  hideProjectBadge,
}: DealEditorProps) {
  const me = useProfile()
  const toast = useToast()

  // Editing permissions follow the deal rules:
  //   - Admin / Head can edit any deal
  //   - Owner can edit their own deal
  //   - Others get a read-only display
  const canEditDeal = isAdmin(me.role) || canReassign(me.role) || deal.repId === me.id
  const canChangeRep = isAdmin(me.role) || canReassign(me.role) || deal.repId === me.id

  const orderedStages = useMemo(
    () => stages.slice().sort((a, b) => a.order - b.order),
    [stages],
  )

  async function handleRepChange(newRepId: string) {
    if (newRepId === deal.repId) return
    const newRep = users.find((u) => u.id === newRepId)
    try {
      await reassignDeal({
        deal,
        newRepId,
        byUserId: me.id,
        byUserName: me.name,
        newRepName: newRep?.name ?? 'someone',
      })
      toast.show(`Reassigned to ${newRep?.name ?? 'rep'} · they were notified`)
    } catch (err) {
      toast.show(
        err instanceof Error
          ? err.message
          : "Couldn't reassign — check permissions",
      )
    }
  }

  const stageColor = stages.find((s) => s.name === deal.status)?.color ?? '#6b7280'

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {!hideProjectBadge && (
          <ProjectBadge projectId={deal.projectId} projects={projects} />
        )}

        {/* Status select */}
        <select
          value={deal.status}
          disabled={!canEditDeal}
          onChange={async (e) => {
            try {
              await updateDealField(deal.id, 'status', e.target.value, me.id)
            } catch (err) {
              toast.show(
                err instanceof Error ? err.message : 'Failed to update status',
              )
            }
          }}
          className="cursor-pointer rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[12px] font-bold outline-none focus:border-major disabled:cursor-not-allowed"
          style={{ color: stageColor }}
        >
          {orderedStages.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>

        {/* Rep select */}
        <div className="flex items-center gap-1 text-[12px] text-ink-3">
          <span>Rep:</span>
          <select
            value={deal.repId}
            disabled={!canChangeRep}
            onChange={(e) => handleRepChange(e.target.value)}
            className="cursor-pointer rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[12px] font-semibold outline-none hover:border-line focus:border-major focus:bg-white disabled:cursor-not-allowed"
            style={{ color: users.find((u) => u.id === deal.repId)?.color }}
          >
            {users
              .filter((u) => !u.disabled)
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </div>

        {/* Rate inline input */}
        <div className="ml-auto flex items-center gap-1 text-[12px] text-ink-3">
          <span>Rate:</span>
          <div className="w-[100px]">
            <EditableInput
              initialValue={deal.rate ?? ''}
              placeholder="e.g. 10%"
              onCommit={async (next) => {
                await updateDealField(deal.id, 'rate', next, me.id)
              }}
            />
          </div>
        </div>
      </div>

      {/* Comments */}
      <div>
        <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
          Comments
        </div>
        <EditableInput
          initialValue={deal.comments ?? ''}
          placeholder="Add comments…"
          multiline
          onCommit={async (next) => {
            await updateDealField(deal.id, 'comments', next, me.id)
            // Surface comment activity in the (admin/BD-only) Activities feed so
            // admins see when notes are added to a merchant. Skip when the field
            // was merely cleared — that isn't a comment worth flagging.
            if (next.trim()) {
              const merchantName = deal.merchantName || 'a lead'
              await logActivity({
                who: me.id,
                whoName: me.name,
                kind: 'deal.comment',
                text: `commented on ${merchantName}`,
                refId: deal.id,
                refKind: 'deal',
                meta: {
                  merchantId: deal.merchantId,
                  projectId: deal.projectId,
                },
              })
            }
          }}
        />
      </div>
    </div>
  )
}
