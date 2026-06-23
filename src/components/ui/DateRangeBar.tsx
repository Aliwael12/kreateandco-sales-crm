import { format } from 'date-fns'
import clsx from 'clsx'
import {
  useDateRange,
  type DateRangePreset,
} from '@/context/date-range'

const PRESETS: { id: DateRangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'quarter', label: 'This Quarter' },
  { id: 'year', label: 'This Year' },
  { id: 'all', label: 'All Time' },
]

function dateToInput(d: Date | null): string {
  return d ? format(d, 'yyyy-MM-dd') : ''
}

interface Props {
  /** Optional override of which presets to show, in order. */
  presets?: DateRangePreset[]
}

export default function DateRangeBar({ presets }: Props) {
  const { preset, range, applyPreset, setFrom, setTo } = useDateRange()
  const list = presets
    ? PRESETS.filter((p) => presets.includes(p.id))
    : PRESETS

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-white px-3.5 py-2.5">
      <label className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
        From
      </label>
      <input
        type="date"
        value={dateToInput(range.from)}
        onChange={(e) => setFrom(e.target.value)}
        className="rounded-md border border-line px-2 py-1 text-[12px] outline-none focus:border-major"
      />
      <label className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
        To
      </label>
      <input
        type="date"
        value={dateToInput(range.to)}
        onChange={(e) => setTo(e.target.value)}
        className="rounded-md border border-line px-2 py-1 text-[12px] outline-none focus:border-major"
      />
      <div className="ml-1 flex flex-wrap items-center gap-1.5">
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p.id)}
            className={clsx(
              'rounded-md border-[1.5px] px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
              preset === p.id
                ? 'border-major bg-major text-white'
                : 'border-line bg-white text-ink-2 hover:border-major hover:text-major',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
