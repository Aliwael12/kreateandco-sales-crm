import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import clsx from 'clsx'
import { useCollection } from '@/hooks/useCollection'
import { useScopedDeals } from '@/hooks/useScopedCollections'
import {
  COL,
  type Deal,
  type Project,
  type Stage,
  type User,
} from '@/lib/types'
import { ProjectBadge } from '@/components/ui/StatusBadge'
import DealDetailModal from '@/components/pipeline/DealDetailModal'
import { useProfile, canReassign } from '@/context/auth'
import { useToast } from '@/components/ui/toast-context'
import { useDateRange } from '@/context/date-range'
import DateRangeBar from '@/components/ui/DateRangeBar'
import {
  createReminder,
  logActivity,
  updateDealField,
} from '@/lib/data'

const REMINDER_OFFSETS_MS: Record<string, number> = {
  'Missed Call': 3 * 60 * 60 * 1000,
  'Follow Up': 2 * 24 * 60 * 60 * 1000,
}

export default function PipelinePage() {
  const me = useProfile()
  const toast = useToast()
  const { inRange } = useDateRange()
  const { data: deals } = useScopedDeals()
  const { data: stages } = useCollection<Stage>(COL.stages)
  const { data: projects } = useCollection<Project>(COL.projects)
  const { data: users } = useCollection<User>(COL.users)

  const [projectFilter, setProjectFilter] = useState('all')
  const [repFilter, setRepFilter] = useState('all')
  const [openDealId, setOpenDealId] = useState<string | null>(null)
  const [activeDealId, setActiveDealId] = useState<string | null>(null)
  // Holds a local override of deal status while the Firestore write is in
  // flight, so the card "stays" in the new column the instant you drop.
  const [pendingStatus, setPendingStatus] = useState<Record<string, string>>(
    {},
  )

  const orderedStages = useMemo(
    () => stages.slice().sort((a, b) => a.order - b.order),
    [stages],
  )

  const visibleDeals = useMemo(() => {
    return deals.filter((d) => {
      if (projectFilter !== 'all' && d.projectId !== projectFilter) return false
      if (repFilter !== 'all' && d.repId !== repFilter) return false
      if (!inRange(d.createdAt?.toMillis?.())) return false
      return true
    })
  }, [deals, projectFilter, repFilter, inRange])

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>()
    for (const s of orderedStages) map.set(s.name, [])
    for (const d of visibleDeals) {
      const effectiveStatus = pendingStatus[d.id] ?? d.status
      const arr = map.get(effectiveStatus)
      if (arr) arr.push(d)
    }
    return map
  }, [orderedStages, visibleDeals, pendingStatus])

  // Admins and Heads can drag any deal (matches the deal security rules and
  // the merchant modal); reps can only move their own.
  const canEdit = (d: Deal) => canReassign(me.role) || d.repId === me.id

  const sensors = useSensors(
    // 8px activation distance — click still opens the modal, only a real
    // drag motion triggers dnd.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const activeDeal = useMemo(
    () => (activeDealId ? deals.find((d) => d.id === activeDealId) : null),
    [activeDealId, deals],
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id))
  }

  async function handleDragEnd(event: DragEndEvent) {
    const dealId = String(event.active.id)
    setActiveDealId(null)
    if (!event.over) return
    const newStatus = String(event.over.id)
    const deal = deals.find((d) => d.id === dealId)
    if (!deal) return
    if (deal.status === newStatus) return
    if (!canEdit(deal)) {
      toast.show("You can't edit this deal")
      return
    }

    // Optimistic update — keep the card in the new column while we write.
    setPendingStatus((p) => ({ ...p, [dealId]: newStatus }))

    try {
      await updateDealField(dealId, 'status', newStatus, me.id)
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'deal.status',
        text: `${deal.merchantName || 'New deal'} → ${newStatus}`,
        refId: deal.id,
        refKind: 'deal',
      })

      const offset = REMINDER_OFFSETS_MS[newStatus]
      if (offset && deal.merchantName) {
        await createReminder({
          dealId: deal.id,
          merchantId: deal.merchantId,
          merchantName: deal.merchantName,
          projectId: deal.projectId,
          repId: deal.repId,
          type: newStatus === 'Missed Call' ? 'missed' : 'followup',
          note: `Auto-created when status changed to ${newStatus}`,
          dueAt: new Date(Date.now() + offset),
        })
        toast.show('Status updated · Reminder created')
      } else {
        toast.show('Status updated')
      }
    } catch (err) {
      toast.show(
        err instanceof Error ? err.message : 'Failed to update status',
      )
      // Revert the optimistic update on error.
      setPendingStatus((p) => {
        const next = { ...p }
        delete next[dealId]
        return next
      })
    }
    // Clear the pending entry once the snapshot reflects the new value.
    // We wait one tick so Firestore's onSnapshot has time to emit, but
    // even without that, dealsByStage just falls back to deal.status if
    // pendingStatus doesn't override it.
    setTimeout(() => {
      setPendingStatus((p) => {
        if (p[dealId] !== newStatus) return p
        const next = { ...p }
        delete next[dealId]
        return next
      })
    }, 1500)
  }

  return (
    <>
      <DateRangeBar />

      <div className="flex flex-wrap items-center gap-2.5">
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
        >
          <option value="all">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={repFilter}
          onChange={(e) => setRepFilter(e.target.value)}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
        >
          <option value="all">All Reps</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <div className="ml-auto text-[12px] text-ink-3">
          {visibleDeals.length} deals · drag a card to change status
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <PipelineBoard orderedStages={orderedStages}>
          {orderedStages.map((stage) => {
            const items = dealsByStage.get(stage.name) ?? []
            return (
              <DroppableColumn key={stage.id} stage={stage} count={items.length}>
                {items.length === 0 ? (
                  <div className="py-5 text-center text-[12px] italic text-ink-3">
                    No deals
                  </div>
                ) : (
                  items.map((d) => (
                    <DraggableCard
                      key={d.id}
                      deal={d}
                      rep={users.find((u) => u.id === d.repId)}
                      projects={projects}
                      onOpen={() => setOpenDealId(d.id)}
                      canEdit={canEdit(d)}
                    />
                  ))
                )}
              </DroppableColumn>
            )
          })}
        </PipelineBoard>

        <DragOverlay dropAnimation={null}>
          {activeDeal ? (
            <div className="pointer-events-none rounded-lg border border-major bg-white px-3.5 py-2.5 shadow-[0_8px_24px_rgba(91,79,207,.25)]">
              <div className="text-[13px] font-semibold text-ink-1">
                {activeDeal.merchantName || (
                  <span className="italic text-ink-3">(unnamed)</span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-3">
                {users.find((u) => u.id === activeDeal.repId)?.name ?? '—'}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <DealDetailModal
        deal={openDealId ? deals.find((d) => d.id === openDealId) ?? null : null}
        onClose={() => setOpenDealId(null)}
        projects={projects}
        stages={stages}
        users={users}
      />
    </>
  )
}

interface DroppableColumnProps {
  stage: Stage
  count: number
  children: React.ReactNode
}

function DroppableColumn({ stage, count, children }: DroppableColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.name })
  return (
    <div className="flex w-[212px] flex-shrink-0 flex-col">
      <header
        className="flex items-center gap-1.5 rounded-t-lg border border-line border-b-[3px] bg-white px-3 py-2"
        style={{ borderBottomColor: stage.color }}
      >
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: stage.color }}
        />
        <span className="font-display flex-1 text-[11px] font-bold text-ink-2">
          {stage.name}
        </span>
        <span className="rounded-lg bg-ghost px-2 py-px text-[11px] text-ink-3">
          {count}
        </span>
      </header>
      <div
        ref={setNodeRef}
        className={clsx(
          'flex flex-1 flex-col gap-2 rounded-b-lg border border-t-0 p-2 transition-colors',
          isOver
            ? 'border-major bg-major-light/60'
            : 'border-line bg-[#f0f1f8]',
        )}
      >
        {children}
      </div>
    </div>
  )
}

interface DraggableCardProps {
  deal: Deal
  rep: User | undefined
  projects: Project[]
  onOpen: () => void
  canEdit: boolean
}

function DraggableCard({
  deal,
  rep,
  projects,
  onOpen,
  canEdit,
}: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: !canEdit,
  })

  // The whole card is the drag target so users can grab it anywhere.
  // PointerSensor's activationConstraint (distance: 8) ensures a click
  // without movement still falls through to onClick.
  return (
    <div
      ref={setNodeRef}
      {...(canEdit ? listeners : {})}
      {...(canEdit ? attributes : {})}
      onClick={onOpen}
      className={clsx(
        'select-none rounded-lg border border-line bg-white px-3.5 py-2.5 text-left transition-all',
        canEdit
          ? 'cursor-grab hover:-translate-y-px hover:border-major hover:shadow-[0_3px_12px_rgba(91,79,207,.12)] active:cursor-grabbing'
          : 'cursor-pointer opacity-90',
        isDragging && 'opacity-30',
      )}
      title={canEdit ? 'Drag to a column to change status' : 'Click to view'}
    >
      <div className="text-[13px] font-semibold text-ink-1">
        {deal.merchantName || (
          <span className="italic text-ink-3">(unnamed)</span>
        )}
      </div>
      <div className="mt-0.5 mb-1.5 text-[11px] text-ink-3">
        {rep?.name ?? '—'}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ProjectBadge projectId={deal.projectId} projects={projects} />
        <span className="ml-auto truncate text-[11px] text-ink-3">
          {deal.rate}
        </span>
      </div>
    </div>
  )
}

interface PipelineBoardProps {
  children: React.ReactNode
  orderedStages: Stage[]
}

/** Wraps the kanban columns with prev/next chevron buttons that
 *  horizontally scroll the inner row, and a permanently-visible
 *  thick scrollbar. Chevrons hide when there's nothing left to scroll. */
function PipelineBoard({ children, orderedStages }: PipelineBoardProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function updateState() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    updateState()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateState, { passive: true })
    const ro = new ResizeObserver(updateState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateState)
      ro.disconnect()
    }
  }, [orderedStages.length])

  function scrollBy(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => scrollBy(-440)}
        className={clsx(
          'pointer-events-none absolute left-0 top-1/2 z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink-2 shadow-md transition-opacity hover:border-major hover:text-major',
          canScrollLeft ? 'pointer-events-auto opacity-100' : 'opacity-0',
        )}
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => scrollBy(440)}
        className={clsx(
          'pointer-events-none absolute right-0 top-1/2 z-10 flex h-9 w-9 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink-2 shadow-md transition-opacity hover:border-major hover:text-major',
          canScrollRight ? 'pointer-events-auto opacity-100' : 'opacity-0',
        )}
      >
        <ChevronRight size={18} />
      </button>
      <div
        ref={scrollRef}
        className="pipeline-scroll flex min-h-[440px] gap-3 overflow-x-auto pb-3"
      >
        {orderedStages.length === 0 ? (
          <div className="flex h-[200px] w-full items-center justify-center text-[13px] italic text-ink-3">
            No stages configured yet. Add some in the Admin page.
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
