import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  width?: 'sm' | 'md' | 'lg'
  children: ReactNode
  footer?: ReactNode
}

const WIDTH: Record<NonNullable<Props['width']>, string> = {
  sm: 'w-[400px]',
  md: 'w-[580px]',
  lg: 'w-[680px]',
}

export default function Modal({
  open,
  onClose,
  title,
  width = 'md',
  children,
  footer,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[600] flex items-center justify-center bg-navy/45 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={clsx(
          'flex max-h-[88vh] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_70px_rgba(11,31,75,.25)]',
          WIDTH[width],
        )}
      >
        <header className="flex items-center gap-3 border-b border-line px-6 py-4">
          <h2 className="font-display flex-1 text-[16px] font-bold text-ink-1">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-ghost transition-colors hover:bg-line"
          >
            <X size={12} />
          </button>
        </header>
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-6 py-5">
          {children}
        </div>
        {footer && (
          <footer className="flex justify-end gap-2.5 border-t border-line px-6 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
