import { useMemo } from 'react'
import type { Deal, Project, Stage, User } from '@/lib/types'

interface Props {
  projects: Project[]
  stages: Stage[]
  deals: Deal[]
  users: User[]
  onPickProject: (projectId: string) => void
}

/** Admin-only project landing view: one card per project showing the
 *  per-stage counts and the team members assigned to that project. Click
 *  a card to drill into that project's merchant sheet. */
export default function ProjectsOverviewGrid({
  projects,
  stages,
  deals,
  users,
  onPickProject,
}: Props) {
  const orderedStages = useMemo(
    () => stages.slice().sort((a, b) => a.order - b.order),
    [stages],
  )

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-white p-10 text-center text-[13px] italic text-ink-3">
        No projects yet. Create one in the Admin page.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
      {projects.map((p) => {
        const projectDeals = deals.filter((d) => d.projectId === p.id)
        const team = users.filter(
          (u) => !u.disabled && u.projectIds?.includes(p.id),
        )
        const counts: Record<string, number> = {}
        for (const s of orderedStages) counts[s.name] = 0
        for (const d of projectDeals) {
          if (counts[d.status] !== undefined) counts[d.status] += 1
        }

        return (
          <button
            key={p.id}
            onClick={() => onPickProject(p.id)}
            className="group flex flex-col gap-3 rounded-xl border border-line bg-white px-4 py-4 text-left transition-all hover:-translate-y-px hover:border-major hover:shadow-[0_4px_16px_rgba(91,79,207,.12)]"
          >
            <header className="flex items-center gap-2">
              <span
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{ background: p.color }}
              />
              <h3 className="font-display text-[18px] font-extrabold text-ink-1">
                {p.name}
              </h3>
              <span className="ml-auto text-[11px] text-ink-3">
                {projectDeals.length} deal{projectDeals.length === 1 ? '' : 's'}
              </span>
            </header>

            <ul className="flex flex-col gap-1 text-[12.5px]">
              {orderedStages.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2"
                  title={s.name}
                >
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="flex-1 truncate text-ink-2">{s.name}</span>
                  <span
                    className={`tabular-nums ${
                      counts[s.name] === 0
                        ? 'text-ink-4'
                        : 'font-semibold text-ink-1'
                    }`}
                  >
                    {counts[s.name] ?? 0}
                  </span>
                </li>
              ))}
            </ul>

            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                Team
              </div>
              {team.length === 0 ? (
                <p className="text-[11.5px] italic text-ink-4">
                  No members yet
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {team.map((m) => (
                    <span
                      key={m.id}
                      className="flex items-center gap-1 rounded-full bg-ghost px-2 py-0.5 text-[11.5px] font-semibold text-ink-2"
                    >
                      <span
                        className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
                        style={{ background: m.color }}
                      >
                        {m.name[0]?.toUpperCase()}
                      </span>
                      {m.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
