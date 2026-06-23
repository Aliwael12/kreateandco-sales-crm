import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/auth'
import AccountPendingPage from '@/pages/AccountPendingPage'

interface Props {
  children: React.ReactNode
}

export default function RequireAuth({ children }: Props) {
  const { status, profileError } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-ink-3">
        Loading…
      </div>
    )
  }

  if (status === 'signed-out') {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (
    status === 'no-profile' ||
    status === 'disabled' ||
    status === 'profile-fetch-failed'
  ) {
    return <AccountPendingPage reason={status} error={profileError} />
  }

  return <>{children}</>
}
