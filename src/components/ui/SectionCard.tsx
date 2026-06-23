import clsx from 'clsx'

interface Props {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export default function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
}: Props) {
  return (
    <section
      className={clsx(
        'rounded-xl border border-line bg-white px-5 py-4',
        className,
      )}
    >
      <header className="mb-3.5 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="font-display text-[13.5px] font-bold text-ink-1">
            {title}
          </h2>
          {subtitle && (
            <span className="text-[11px] text-ink-3">{subtitle}</span>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}
