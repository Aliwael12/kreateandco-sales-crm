import type { Stage } from '@/lib/types'

interface Props {
  status: string
  stages: Stage[]
  className?: string
}

function hexToRgba(hex: string, a: number): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return hex
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

export default function StatusBadge({ status, stages, className }: Props) {
  const stage = stages.find((s) => s.name === status)
  const color = stage?.color ?? '#6b7280'
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-px text-[11px] font-semibold ${className ?? ''}`}
      style={{ background: hexToRgba(color, 0.12), color }}
    >
      {status}
    </span>
  )
}

interface ProjectBadgeProps {
  projectId: string
  projects: { id: string; name: string; color: string }[]
  className?: string
}

export function ProjectBadge({
  projectId,
  projects,
  className,
}: ProjectBadgeProps) {
  const p = projects.find((x) => x.id === projectId)
  if (!p) return null
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-px text-[11px] font-semibold ${className ?? ''}`}
      style={{ background: hexToRgba(p.color, 0.12), color: p.color }}
    >
      {p.name}
    </span>
  )
}
