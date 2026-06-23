import type { Stage, Deal } from '@/lib/types'

interface Props {
  stages: Stage[]
  deals: Deal[]
}

export default function PipelineByStage({ stages, deals }: Props) {
  const counts = new Map<string, number>()
  for (const s of stages) counts.set(s.name, 0)
  for (const d of deals) counts.set(d.status, (counts.get(d.status) ?? 0) + 1)
  const total = Math.max(deals.length, 1)

  if (stages.length === 0) {
    return (
      <p className="py-6 text-center text-[12.5px] italic text-ink-3">
        No deal stages set up yet — add some in the Admin page.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {stages
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) => {
          const c = counts.get(s.name) ?? 0
          const pct = Math.round((c / total) * 100)
          return (
            <div key={s.id} className="flex items-center gap-2.5">
              <div className="w-[160px] flex-shrink-0 text-[12px] font-medium text-ink-2">
                {s.name}
              </div>
              <div className="h-2.5 flex-1 overflow-hidden rounded bg-ghost">
                <div
                  className="h-full rounded transition-[width] duration-300"
                  style={{ width: `${pct}%`, background: s.color }}
                />
              </div>
              <div className="w-[24px] text-right text-[12px] text-ink-3">
                {c}
              </div>
            </div>
          )
        })}
    </div>
  )
}
