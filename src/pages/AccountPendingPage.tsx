import { useAuth } from '@/context/auth'

// Supabase/Postgres errors carry a string `code` (e.g. '42501' for
// insufficient_privilege / RLS denial) plus a `message`. We type loosely.
type DbError = { code?: string; message?: string } | null

interface Props {
  reason: 'no-profile' | 'disabled' | 'profile-fetch-failed'
  error?: DbError
}

interface Variant {
  title: string
  body: string
  tip?: string
}

function variantFor(
  reason: Props['reason'],
  error: DbError | undefined,
): Variant {
  if (reason === 'disabled') {
    return {
      title: 'Your account has been disabled',
      body:
        'Your access has been revoked. Please contact your admin if you think this is a mistake.',
    }
  }
  if (reason === 'profile-fetch-failed') {
    // RLS denial / insufficient privilege.
    if (error?.code === '42501' || error?.code === 'PGRST301') {
      return {
        title: 'Not allowed to read your profile',
        body:
          "The database rejected the request for your team profile. The row-level security policies may not be deployed, or your profile row is missing.",
        tip: 'Ask an admin to confirm the migration ran (schema + RLS) and that your user row exists.',
      }
    }
    return {
      title: "Couldn't load your profile",
      body:
        error?.message ??
        'Something went wrong reading your team profile. Try refreshing.',
    }
  }
  // no-profile
  return {
    title: 'Awaiting admin approval',
    body:
      'Your sign-in worked, but no team profile is linked to your account yet. Ask an admin to add you in the Admin page.',
  }
}

export default function AccountPendingPage({ reason, error }: Props) {
  const { fbUser, signOut } = useAuth()
  const { title, body, tip } = variantFor(reason, error)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy">
      <div className="w-[460px] rounded-2xl bg-white p-10 shadow-[0_40px_80px_rgba(0,0,0,.35)]">
        <h1 className="font-display text-2xl font-bold text-ink-1">{title}</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{body}</p>
        {tip && (
          <p className="mt-3 rounded-lg bg-ghost px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
            <b>Fix:</b> {tip}
          </p>
        )}
        {fbUser?.email && (
          <p className="mt-4 text-[12px] text-ink-3">
            Signed in as <span className="font-medium">{fbUser.email}</span>
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex-1 rounded-[10px] bg-major py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4a3fb8]"
          >
            Retry
          </button>
          <button
            onClick={signOut}
            className="rounded-[10px] border-[1.5px] border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink-2 transition-colors hover:bg-ghost"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
