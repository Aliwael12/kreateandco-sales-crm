import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ui/toast-context'
import Button from '@/components/ui/Button'

export default function SettingsPage() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="font-display text-[18px] font-bold text-ink-1">
          Settings
        </h1>
      </div>

      <ChangePasswordSection />
    </>
  )
}

// ─── change password (all users) ─────────────────────────────────────────

function authErrorMessage(err: unknown): string {
  const code =
    typeof err === 'object' && err && 'code' in err
      ? String((err as { code: unknown }).code)
      : ''
  switch (code) {
    case 'invalid_credentials':
      return 'Current password is incorrect.'
    case 'weak_password':
      return 'New password is too weak — use at least 6 characters.'
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a bit and try again.'
    case 'same_password':
      return 'The new password must be different from the current one.'
    default:
      return err instanceof Error ? err.message : "Couldn't update password."
  }
}

function ChangePasswordSection() {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (next.length < 6) {
      setError('New password must be at least 6 characters.')
      return
    }
    if (next !== confirm) {
      setError('New passwords do not match.')
      return
    }
    const { data: sessionData } = await supabase.auth.getSession()
    const email = sessionData.session?.user.email
    if (!email) {
      setError('You appear to be signed out. Refresh the page and try again.')
      return
    }
    setBusy(true)
    try {
      // Verify the current password by re-signing-in with it first. Supabase's
      // updateUser does NOT re-check the old password, so this preserves the
      // "must know your current password" guarantee the Firebase flow had.
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      })
      if (reauthErr) throw reauthErr
      const { error: updErr } = await supabase.auth.updateUser({ password: next })
      if (updErr) throw updErr
      toast.show('Password updated')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <header className="mb-3 flex items-center gap-2">
        <KeyRound size={16} className="text-major" />
        <h2 className="font-display text-[15px] font-bold text-ink-1">
          Change password
        </h2>
      </header>
      <div className="flex max-w-[380px] flex-col gap-3">
        <PasswordField
          label="Current password"
          value={current}
          onChange={setCurrent}
        />
        <PasswordField
          label="New password"
          value={next}
          onChange={setNext}
        />
        <PasswordField
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          onEnter={submit}
        />
        {error && (
          <div className="rounded-lg bg-bad-light px-3 py-2 text-[12.5px] font-medium text-bad">
            {error}
          </div>
        )}
        <div>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </div>
    </section>
  )
}

function PasswordField({
  label,
  value,
  onChange,
  onEnter,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter()
        }}
        autoComplete="new-password"
        className="w-full rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-major"
      />
    </label>
  )
}
