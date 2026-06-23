import clsx from 'clsx'

type Variant = 'blue' | 'green' | 'purple' | 'bitter'

const STRIPE: Record<Variant, string> = {
  blue: 'before:bg-info',
  green: 'before:bg-ok',
  purple: 'before:bg-major',
  bitter: 'before:bg-bitter',
}

// The `bitter` accent is now the secondary yellow-green, which is too light for
// text on a white card — keep the metric value dark and let the top stripe carry
// the accent color instead.
const VALUE_COLOR: Partial<Record<Variant, string>> = {}

interface Props {
  label: string
  value: number | string
  delta?: { text: string; positive?: boolean }
  variant: Variant
}

export default function MetricCard({ label, value, delta, variant }: Props) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-xl border border-line bg-white px-5 py-4',
        'before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px]',
        STRIPE[variant],
      )}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <div
        className={clsx(
          'font-display mt-1 text-[30px] font-bold leading-none',
          VALUE_COLOR[variant] ?? 'text-ink-1',
        )}
      >
        {value}
      </div>
      {delta && (
        <div
          className={clsx(
            'mt-0.5 text-[11.5px]',
            delta.positive === false ? 'text-bad' : 'text-ok',
          )}
        >
          {delta.text}
        </div>
      )}
    </div>
  )
}
