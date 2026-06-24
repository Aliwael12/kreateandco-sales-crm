import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { UserPlus, Home } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge, { ProjectBadge } from '@/components/ui/StatusBadge'
import { useProfile, isAdmin, canReassign } from '@/context/auth'
import { useToast } from '@/components/ui/toast-context'
import { useMerchantDetail } from '@/context/merchantDetail'
import { reassignDeal, setDealPackage } from '@/lib/data'
import { packageLabel } from '@/lib/packages'
import type { Deal, Package, Project, Stage, User } from '@/lib/types'

interface Props {
  deal: Deal | null
  onClose: () => void
  projects: Project[]
  stages: Stage[]
  users: User[]
}

export default function DealDetailModal({
  deal,
  onClose,
  projects,
  stages,
  users,
}: Props) {
  const me = useProfile()
  const toast = useToast()
  const { open: openMerchantDetail } = useMerchantDetail()

  const [reassignOpen, setReassignOpen] = useState(false)
  const [newRepId, setNewRepId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const project = useMemo(
    () => (deal ? projects.find((p) => p.id === deal.projectId) : null),
    [deal, projects],
  )
  const rep = useMemo(
    () => (deal ? users.find((u) => u.id === deal.repId) : null),
    [deal, users],
  )

  if (!deal) return null

  // Who's allowed to reassign THIS specific deal?
  //   - Admin and Sales Head: any deal
  //   - The current owner: their own deal (can hand it off)
  const allowReassign =
    canReassign(me.role) || isAdmin(me.role) || deal.repId === me.id

  // Candidate reps (excluding the current rep, excluding founders/admins
  // by default since they don't usually take cards — but the picker can
  // show them too in case you want to escalate to an admin).
  const candidates = users
    .filter((u) => !u.disabled && u.id !== deal.repId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  function startReassign() {
    setNewRepId(candidates[0]?.id ?? '')
    setReassignOpen(true)
  }

  async function commitReassign() {
    if (!newRepId || !deal) return
    setBusy(true)
    try {
      const newRep = users.find((u) => u.id === newRepId)
      await reassignDeal({
        deal,
        newRepId,
        byUserId: me.id,
        byUserName: me.name,
        newRepName: newRep?.name ?? 'someone',
      })
      toast.show(`Assigned to ${newRep?.name ?? 'rep'} · they were notified`)
      setReassignOpen(false)
      onClose()
    } catch (err) {
      toast.show(
        err instanceof Error
          ? err.message
          : "Couldn't reassign — check permissions",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={deal.merchantName || 'Untitled deal'}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              if (deal.merchantId) openMerchantDetail(deal.merchantId)
              onClose()
            }}
            disabled={!deal.merchantId}
          >
            <Home size={12} /> Open lead
          </Button>
          {allowReassign && !reassignOpen && (
            <Button onClick={startReassign}>
              <UserPlus size={12} /> Reassign to…
            </Button>
          )}
          {!allowReassign && (
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {project && (
          <ProjectBadge projectId={project.id} projects={projects} />
        )}
        <StatusBadge status={deal.status} stages={stages} />
        <span className="ml-auto text-[12px] font-semibold text-ink-1">
          {deal.rate || 'No rate set'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg bg-ghost px-3.5 py-3">
        <Field label="Currently assigned to">
          {rep ? (
            <span className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: rep.color }}
              >
                {rep.name[0]?.toUpperCase()}
              </span>
              <span className="font-semibold">{rep.name}</span>
              <span className="text-[11px] text-ink-3">· {rep.role}</span>
            </span>
          ) : (
            <span className="italic text-ink-3">unassigned</span>
          )}
        </Field>
        <Field label="Last update">
          <span className="font-mono-num text-[12px]">
            {deal.updatedAt?.toDate?.()
              ? format(deal.updatedAt.toDate(), 'yyyy-MM-dd HH:mm')
              : '—'}
          </span>
        </Field>
      </div>

      {deal.comments && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
            Comments
          </div>
          <div className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
            {deal.comments}
          </div>
        </div>
      )}

      <DealPackagePicker
        deal={deal}
        project={project ?? null}
        canEdit={allowReassign}
        meId={me.id}
      />

      {reassignOpen && (
        <div className="rounded-lg border-[1.5px] border-major bg-major-light/30 px-3.5 py-3">
          <div className="mb-2 flex items-center gap-2">
            <UserPlus size={14} className="text-major" />
            <span className="text-[12.5px] font-semibold text-major">
              Reassign deal
            </span>
          </div>
          {candidates.length === 0 ? (
            <p className="text-[12.5px] italic text-ink-3">
              No other active team members to assign to.
            </p>
          ) : (
            <>
              <select
                value={newRepId}
                onChange={(e) => setNewRepId(e.target.value)}
                className="w-full cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-major"
              >
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.role}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[11.5px] text-ink-3">
                They'll see the deal in their <b>My Projects</b> sheet, and a
                notification appears in their Reminders inbox saying you
                assigned it to them.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setReassignOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={commitReassign}
                  disabled={busy || !newRepId}
                >
                  {busy ? 'Assigning…' : 'Confirm assignment'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <div className="mt-1 text-[13px] text-ink-1">{children}</div>
    </div>
  )
}

// Categorize this deal into one of its project's packages (e.g. a UGC lead is
// the "20" package). Stores a snapshot at pick-time (see setDealPackage) so
// later edits to the project's packages don't rewrite this deal. Read-only for
// users who can't act on the deal.
function DealPackagePicker({
  deal,
  project,
  canEdit,
  meId,
}: {
  deal: Deal
  project: Project | null
  canEdit: boolean
  meId: string
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const available = project?.packages ?? []

  async function pick(pkg: Package | null) {
    if (busy) return
    setBusy(true)
    try {
      await setDealPackage(deal.id, pkg, meId)
      toast.show(pkg ? `Package set: ${packageLabel(pkg)}` : 'Package cleared')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't set package")
    } finally {
      setBusy(false)
    }
  }

  // Nothing to offer and nothing chosen → hide the whole block.
  if (available.length === 0 && !deal.packageSnapshot) return null

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
        Package
      </div>

      {available.length === 0 ? (
        // No packages defined on the project, but this deal has a saved one.
        <div className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-[13px] text-ink-2">
          {deal.packageSnapshot ? packageLabel(deal.packageSnapshot) : '—'}
          {deal.packageSnapshot && (
            <span className="ml-2 text-[11px] text-ink-3">
              (this project has no packages defined)
            </span>
          )}
        </div>
      ) : canEdit ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => pick(null)}
            className={
              'rounded-lg border-[1.5px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50 ' +
              (!deal.packageId
                ? 'border-major bg-major text-white'
                : 'border-line bg-white text-ink-2 hover:border-major')
            }
          >
            None
          </button>
          {available.map((pkg) => {
            const active = pkg.id === deal.packageId
            return (
              <button
                key={pkg.id}
                type="button"
                disabled={busy}
                onClick={() => pick(pkg)}
                className={
                  'rounded-lg border-[1.5px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50 ' +
                  (active
                    ? 'border-major bg-major text-white'
                    : 'border-line bg-white text-ink-2 hover:border-major')
                }
              >
                {packageLabel(pkg)}
                {pkg.price > 0 && (
                  <span
                    className={
                      'ml-1.5 text-[11px] ' +
                      (active ? 'text-white/80' : 'text-ink-3')
                    }
                  >
                    · {pkg.price.toLocaleString()}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        // Read-only viewers see just the chosen package (or a dash).
        <div className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-[13px] text-ink-2">
          {deal.packageSnapshot ? packageLabel(deal.packageSnapshot) : '—'}
        </div>
      )}
    </div>
  )
}
