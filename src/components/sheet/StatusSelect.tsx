import type { Stage } from '@/lib/types'

interface Props {
  value: string
  /** Must be pre-sorted by caller. Avoids per-row sorting in large sheets. */
  stages: Stage[]
  disabled?: boolean
  onChange: (next: string) => void
}

export default function StatusSelect({
  value,
  stages,
  disabled,
  onChange,
}: Props) {
  const current = stages.find((s) => s.name === value)
  const color = current?.color ?? '#6b7280'
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border-[1.5px] border-line bg-white px-2 py-1.5 text-[12px] font-bold outline-none transition-colors focus:border-major disabled:cursor-not-allowed"
      style={{ color }}
    >
      {stages.map((s) => (
        <option key={s.id} value={s.name}>
          {s.name}
        </option>
      ))}
    </select>
  )
}
