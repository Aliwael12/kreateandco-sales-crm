import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'

interface Props {
  value: string
  placeholder: string
  readOnly?: boolean
  mono?: boolean
  /** Render as a textarea that wraps and auto-grows with content, used
   * for long-form fields like Comments. Read-only display also wraps. */
  multiline?: boolean
  onCommit: (next: string) => void | Promise<void>
}

export default function EditableCell({
  value,
  placeholder,
  readOnly,
  mono,
  multiline,
  onCommit,
}: Props) {
  const [local, setLocal] = useState(value)

  // Re-sync the editable buffer when the underlying cell value changes
  // externally (e.g. after a refresh) — syncing local state to a prop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(value)
  }, [value])

  if (readOnly) {
    return (
      <div
        className={clsx(
          'px-3.5 py-2.5 text-[13px]',
          // Single-line cells keep their vertical-centered, fixed-height feel;
          // multi-line cells just wrap.
          multiline
            ? 'min-h-[42px] whitespace-pre-wrap break-words leading-relaxed'
            : 'flex min-h-[42px] items-center',
          mono && 'font-mono-num text-[12px]',
          !value && 'italic text-ink-4',
        )}
      >
        {value || '—'}
      </div>
    )
  }

  const commit = () => {
    if (local !== value) onCommit(local)
  }

  const sharedClass = clsx(
    'w-full border-0 bg-transparent px-3.5 py-2.5 text-[13px] outline-none placeholder:italic placeholder:text-ink-4',
    'focus:bg-major-light focus:shadow-[inset_0_0_0_2px_var(--color-major)]',
    mono && 'font-mono-num text-[12px]',
    !local &&
      'shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] focus:shadow-[inset_0_0_0_2px_var(--color-major)]',
  )

  if (multiline) {
    return (
      <AutoGrowTextarea
        value={local}
        placeholder={placeholder}
        onChange={setLocal}
        onCommit={commit}
        onRevert={() => setLocal(value)}
        sharedClass={sharedClass}
      />
    )
  }

  return (
    <input
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          setLocal(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className={clsx('min-h-[42px]', sharedClass)}
    />
  )
}

/**
 * Textarea that resizes its own height to fit its content — works in
 * every browser regardless of CSS field-sizing support. The height is
 * reset to auto on every value change so shrinking works too (e.g. you
 * delete a long comment, the textarea shrinks back down).
 */
function AutoGrowTextarea({
  value,
  placeholder,
  onChange,
  onCommit,
  onRevert,
  sharedClass,
}: {
  value: string
  placeholder: string
  onChange: (v: string) => void
  onCommit: () => void
  onRevert: () => void
  sharedClass: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const ta = ref.current
    if (!ta) return
    // Skip the synchronous reflow when there's nothing to measure — CSS
    // min-h-[42px] already handles the empty single-row case. This avoids
    // thousands of layout passes when a large sheet mounts with mostly
    // blank Comments cells.
    if (!value) {
      ta.style.height = ''
      return
    }
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        // Plain Enter inserts a newline (default textarea behavior).
        // Cmd/Ctrl+Enter commits + blurs. Escape reverts.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          ;(e.target as HTMLTextAreaElement).blur()
        } else if (e.key === 'Escape') {
          onRevert()
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
      rows={1}
      className={clsx(
        sharedClass,
        'min-h-[42px] resize-none overflow-hidden whitespace-pre-wrap leading-relaxed',
      )}
    />
  )
}
