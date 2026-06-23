import { useEffect, useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge, { ProjectBadge } from '@/components/ui/StatusBadge'
import { useProfile } from '@/context/auth'
import { useToast } from '@/components/ui/toast-context'
import { reassignDeal } from '@/lib/data'
import type { Deal, Merchant, Project, Stage, User } from '@/lib/types'

interface Props {
  merchant: Merchant | null
  deals: Deal[]
  onClose: () => void
  projects: Project[]
  stages: Stage[]
  users: User[]
}

export default function ReassignMerchantDealsModal({
  merchant,
  deals,
  onClose,
  projects,
  stages,
  users,
}: Props) {
  const me = useProfile()
  const toast = useToast()

  // Local state: { dealId -> chosen new repId } — defaults to current repId
  // so unchanged rows are no-ops.
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const merchantDeals = useMemo(
    () => (merchant ? deals.filter((d) => d.merchantId === merchant.id) : []),
    [merchant?.id, deals], // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    if (!merchant) return
    const initial: Record<string, string> = {}
    for (const d of merchantDeals) initial[d.id] = d.repId
    // Seeding the per-deal rep picks from the opened merchant's deals —
    // syncing local state to external props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicks(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant?.id, merchantDeals])

  if (!merchant) return null

  const activeUsers = users
    .filter((u) => !u.disabled)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  // Pending changes — only deals whose pick differs from current repId.
  const changes = merchantDeals.filter((d) => picks[d.id] && picks[d.id] !== d.repId)

  async function commit() {
    if (changes.length === 0) {
      onClose()
      return
    }
    setBusy(true)
    try {
      for (const d of changes) {
        const newRepId = picks[d.id]
        const newRep = users.find((u) => u.id === newRepId)
        await reassignDeal({
          deal: d,
          newRepId,
          byUserId: me.id,
          byUserName: me.name,
          newRepName: newRep?.name ?? 'someone',
        })
      }
      toast.show(
        `Reassigned ${changes.length} deal${changes.length === 1 ? '' : 's'} · ${changes.length} rep${changes.length === 1 ? '' : 's'} notified`,
      )
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
      title={`Reassign deals — ${merchant.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={busy || changes.length === 0}>
            {busy
              ? 'Reassigning…'
              : `Confirm ${changes.length} change${changes.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <p className="text-[12.5px] text-ink-3">
        Pick a new rep for each deal. The new rep will get an{' '}
        <b>Assigned</b> notification in their Reminders inbox.
      </p>

      {merchantDeals.length === 0 ? (
        <p className="text-[13px] italic text-ink-3">
          No deals to reassign on this lead.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {merchantDeals.map((d) => {
            const currentRep = users.find((u) => u.id === d.repId)
            return (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5"
              >
                <ProjectBadge projectId={d.projectId} projects={projects} />
                <StatusBadge status={d.status} stages={stages} />
                <span className="ml-1 text-[11.5px] text-ink-3">
                  was{' '}
                  <b className="text-ink-2" style={{ color: currentRep?.color }}>
                    {currentRep?.name ?? '—'}
                  </b>
                </span>
                <select
                  value={picks[d.id] ?? d.repId}
                  onChange={(e) =>
                    setPicks((p) => ({ ...p, [d.id]: e.target.value }))
                  }
                  className="ml-auto cursor-pointer rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[12px] outline-none focus:border-major"
                >
                  {activeUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
