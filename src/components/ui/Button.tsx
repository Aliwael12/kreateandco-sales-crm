import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'xs'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-major text-white hover:bg-[#4a3fb8]',
  ghost: 'border-[1.5px] border-line bg-transparent text-ink-2 hover:bg-ghost',
  danger: 'bg-bad-light text-bad hover:bg-[#f8c9c5]',
}

const SIZE: Record<Size, string> = {
  xs: 'px-2.5 py-1 text-[11px]',
  sm: 'px-3 py-1.5 text-[11.5px]',
  md: 'px-4 py-2 text-[12.5px]',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {children}
    </button>
  )
}
