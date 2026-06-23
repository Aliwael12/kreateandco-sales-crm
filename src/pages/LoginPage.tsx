import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AuthError } from '@supabase/supabase-js'
import { useAuth } from '@/context/auth'

export default function LoginPage() {
  const { signIn, status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const from =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ??
    '/'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      if (err instanceof AuthError) {
        // Supabase returns 'invalid_credentials' for both wrong-password and
        // unknown-email (it intentionally does not distinguish, to avoid leaking
        // which emails exist). Rate limiting surfaces as 429.
        if (err.code === 'invalid_credentials' || err.status === 400) {
          setError('Incorrect email or password.')
        } else if (err.status === 429 || err.code === 'over_request_rate_limit') {
          setError('Too many attempts. Try again in a few minutes.')
        } else if (err.code === 'validation_failed') {
          setError('That email address isn’t valid.')
        } else {
          setError(err.message)
        }
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const loading = busy || status === 'loading'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy">
      <div className="w-[420px] rounded-2xl bg-white p-11 shadow-[0_40px_80px_rgba(0,0,0,.35)]">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-major">
            <svg viewBox="0 0 20 20" className="h-5.5 w-5.5 fill-white">
              <path d="M10 2L3 7v6l7 5 7-5V7L10 2zm0 2.5L15 8v4l-5 3.5L5 12V8l5-3.5z" />
            </svg>
          </div>
          <div>
            <div className="font-display text-[22px] font-extrabold leading-none text-navy">
              kreateandco
            </div>
            <div className="text-[10px] text-ink-3">Sales Platform</div>
          </div>
        </div>

        <h1 className="font-display text-[22px] font-bold text-ink-1">
          Welcome back
        </h1>
        <p className="mb-5 text-[13px] text-ink-3">
          Sign in with your kreateandco work email
        </p>

        <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-2"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[10px] border-[1.5px] border-line bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-major"
              placeholder="name@kreateandco.co"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-2"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[10px] border-[1.5px] border-line bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-major"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-bad-light px-3 py-2 text-[12.5px] font-medium text-bad">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="font-display mt-1 w-full rounded-[10px] bg-major py-3 text-sm font-semibold text-white transition-colors hover:bg-[#4a3fb8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>

        <p className="mt-3 text-center text-[11px] text-ink-4">
          Don’t have an account? Ask your admin for an invite.
        </p>
      </div>
    </div>
  )
}
