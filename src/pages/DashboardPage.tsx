import { useMemo } from 'react'
import { format } from 'date-fns'
import clsx from 'clsx'
import { useCollection } from '@/hooks/useCollection'
import { useCollectionCount } from '@/hooks/useCollectionCount'
import { useScopedDeals } from '@/hooks/useScopedCollections'
import { COL, type Deal, type Stage, type User } from '@/lib/types'
import { useProfile, isAdmin } from '@/context/auth'
import MetricCard from '@/components/ui/MetricCard'
import SectionCard from '@/components/ui/SectionCard'
import PipelineByStage from '@/components/dashboard/PipelineByStage'
import MyTasksCard from '@/components/dashboard/MyTasksCard'
import DateRangeBar from '@/components/ui/DateRangeBar'
import {
  useDateRange,
  type DateRange,
  type DateRangePreset,
} from '@/context/date-range'

export default function DashboardPage() {
  const me = useProfile()
  const { data: deals } = useScopedDeals()
  // Only the total count is needed here — use a server-side aggregation instead
  // of loading every merchant document.
  const { count: merchantCount } = useCollectionCount(COL.merchants)
  const { data: stages } = useCollection<Stage>(COL.stages)
  const { data: users } = useCollection<User>(COL.users)
  const { preset, range, inRange } = useDateRange()
  const showMyTasks = !isAdmin(me.role)

  const filteredDeals = useMemo(
    () => deals.filter((d) => inRange(d.createdAt?.toMillis?.())),
    [deals, inRange],
  )

  const orderedStages = useMemo(
    () => stages.slice().sort((a, b) => a.order - b.order),
    [stages],
  )

  const metrics = useMemo(() => {
    const active = filteredDeals.filter(
      (d) => d.status !== 'Signed' && d.status !== 'Not Interested',
    ).length
    const signed = filteredDeals.filter((d) => d.status === 'Signed').length
    const followUp = filteredDeals.filter((d) => d.status === 'Follow Up').length
    return { active, total: merchantCount, signed, followUp }
  }, [filteredDeals, merchantCount])

  const nonFounders = useMemo(
    () => users.filter((u) => u.role !== 'Admin'),
    [users],
  )

  return (
    <>
      <DateRangeBar />

      <div className="grid grid-cols-4 gap-3.5">
        <MetricCard
          label="Active Deals"
          value={metrics.active}
          variant="blue"
          delta={
            metrics.active > 0
              ? { text: `${metrics.active} in pipeline`, positive: true }
              : undefined
          }
        />
        <MetricCard
          label="Total Leads"
          value={metrics.total}
          variant="green"
        />
        <MetricCard
          label="Signed"
          value={metrics.signed}
          variant="purple"
          delta={
            metrics.signed > 0
              ? { text: `${metrics.signed} closed`, positive: true }
              : undefined
          }
        />
        <MetricCard
          label="Pending Follow-up"
          value={metrics.followUp}
          variant="bitter"
          delta={
            metrics.followUp > 0
              ? { text: 'Needs attention', positive: false }
              : undefined
          }
        />
      </div>

      {showMyTasks && <MyTasksCard />}

      <div className="grid grid-cols-[1.5fr_1fr] gap-3.5">
        <SectionCard title="Pipeline by Stage">
          <PipelineByStage stages={stages} deals={filteredDeals} />
        </SectionCard>

        <SectionCard title="Quick Glance">
          <ul className="flex flex-col gap-2 text-[13px]">
            <li className="flex justify-between text-ink-2">
              <span>Total team</span>
              <span className="font-semibold">{users.length}</span>
            </li>
            <li className="flex justify-between text-ink-2">
              <span>Active stages</span>
              <span className="font-semibold">{stages.length}</span>
            </li>
            <li className="flex justify-between text-ink-2">
              <span>Leads (total)</span>
              <span className="font-semibold">{merchantCount}</span>
            </li>
            <li className="flex justify-between text-ink-2">
              <span>Deals in range</span>
              <span className="font-semibold">{filteredDeals.length}</span>
            </li>
          </ul>
        </SectionCard>
      </div>

      <SectionCard
        title="Team Performance"
        subtitle={
          preset === 'all'
            ? '(all time, excluding founders)'
            : `(${rangeLabel(preset, range)}, excluding founders)`
        }
      >
        {nonFounders.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] italic text-ink-3">
            No team members yet. Add them in the Admin page.
          </p>
        ) : (
          <TeamPerformanceTable
            stages={orderedStages}
            users={nonFounders}
            deals={filteredDeals}
          />
        )}
      </SectionCard>
    </>
  )
}

function rangeLabel(preset: DateRangePreset, range: DateRange): string {
  if (preset === 'today') return 'today'
  if (preset === 'week') return 'this week'
  if (preset === 'month') return 'this month'
  if (preset === 'quarter') return 'this quarter'
  if (preset === 'year') return 'this year'
  if (preset === 'all') return 'all time'
  const f = range.from ? format(range.from, 'MMM d') : '—'
  const t = range.to ? format(range.to, 'MMM d') : '—'
  return `${f} → ${t}`
}

interface TPRow {
  user: User
  byStage: Record<string, number>
  total: number
  conversion: number | null
}

function TeamPerformanceTable({
  stages,
  users,
  deals,
}: {
  stages: Stage[]
  users: User[]
  deals: Deal[]
}) {
  const rows = useMemo<TPRow[]>(() => {
    return users.map((u) => {
      const mine = deals.filter((d) => d.repId === u.id)
      const byStage: Record<string, number> = {}
      for (const s of stages) byStage[s.name] = 0
      for (const d of mine) {
        if (byStage[d.status] !== undefined) byStage[d.status] += 1
      }
      const initial = byStage['Initial Contact'] ?? 0
      const signed = byStage['Signed'] ?? 0
      const conversion = initial > 0 ? (signed / initial) * 100 : null
      return { user: u, byStage, total: mine.length, conversion }
    })
  }, [users, stages, deals])

  const grandByStage: Record<string, number> = {}
  for (const s of stages) grandByStage[s.name] = 0
  for (const r of rows) {
    for (const s of stages) {
      grandByStage[s.name] += r.byStage[s.name] ?? 0
    }
  }
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  const grandInitial = grandByStage['Initial Contact'] ?? 0
  const grandSigned = grandByStage['Signed'] ?? 0
  const grandConversion =
    grandInitial > 0 ? (grandSigned / grandInitial) * 100 : null

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr>
            <Th sticky>Employee</Th>
            <Th>Role</Th>
            {stages.map((s) => (
              <Th key={s.id} center>
                <span
                  className="inline-flex items-center gap-1"
                  title={s.name}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: s.color }}
                  />
                  {abbrev(s.name)}
                </span>
              </Th>
            ))}
            <Th center>Total</Th>
            <Th center>Conv. %</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user.id} className="border-b border-line last:border-0">
              <Td sticky>
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: r.user.color }}
                  >
                    {r.user.name[0]?.toUpperCase()}
                  </div>
                  <span className="font-medium">{r.user.name}</span>
                </div>
              </Td>
              <Td>
                <span className="text-[11.5px] text-ink-2">{r.user.role}</span>
              </Td>
              {stages.map((s) => (
                <Td key={s.id} center>
                  <span
                    className={clsx(
                      'tabular-nums',
                      r.byStage[s.name] === 0 && 'text-ink-4',
                    )}
                  >
                    {r.byStage[s.name] ?? 0}
                  </span>
                </Td>
              ))}
              <Td center>
                <span className="font-semibold tabular-nums">{r.total}</span>
              </Td>
              <Td center>
                <ConversionCell value={r.conversion} />
              </Td>
            </tr>
          ))}

          <tr className="border-t-2 border-line bg-ghost/60">
            <Td sticky>
              <span className="font-display text-[12px] font-bold uppercase tracking-wider text-ink-2">
                Total
              </span>
            </Td>
            <Td>
              <span className="text-[11.5px] text-ink-3">—</span>
            </Td>
            {stages.map((s) => (
              <Td key={s.id} center>
                <span className="font-semibold tabular-nums">
                  {grandByStage[s.name] ?? 0}
                </span>
              </Td>
            ))}
            <Td center>
              <span className="font-semibold tabular-nums">{grandTotal}</span>
            </Td>
            <Td center>
              <ConversionCell value={grandConversion} bold />
            </Td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function ConversionCell({
  value,
  bold,
}: {
  value: number | null
  bold?: boolean
}) {
  if (value === null) {
    return <span className="text-[11.5px] italic text-ink-4">—</span>
  }
  const color =
    value >= 50
      ? 'text-ok'
      : value >= 20
        ? 'text-warn'
        : value > 0
          ? 'text-ink-2'
          : 'text-ink-4'
  return (
    <span
      className={clsx('tabular-nums', color, bold && 'font-bold')}
      title="Signed ÷ Initial Contact"
    >
      {value.toFixed(1)}%
    </span>
  )
}

function Th({
  children,
  center,
  sticky,
}: {
  children: React.ReactNode
  center?: boolean
  sticky?: boolean
}) {
  return (
    <th
      className={clsx(
        'border-b-2 border-line bg-ghost px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3 whitespace-nowrap',
        center ? 'text-center' : 'text-left',
        sticky && 'sticky left-0 z-10',
      )}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  center,
  sticky,
}: {
  children: React.ReactNode
  center?: boolean
  sticky?: boolean
}) {
  return (
    <td
      className={clsx(
        'px-3 py-2.5 text-[12.5px]',
        center && 'text-center',
        sticky && 'sticky left-0 z-10 bg-white',
      )}
    >
      {children}
    </td>
  )
}

function abbrev(name: string): string {
  const map: Record<string, string> = {
    'Initial Contact': 'Initial',
    'Missed Call': 'Missed',
    'Follow Up': 'Follow Up',
    'Not Interested': 'Not Int.',
    Negotiating: 'Negotiating',
    'Waiting for Requirements': 'Wait. Req.',
    Signed: 'Signed',
  }
  return map[name] ?? name
}
