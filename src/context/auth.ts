import { createContext, useContext } from 'react'
import type { User as SbUser } from '@supabase/supabase-js'
import type { User, Role } from '@/lib/types'

export type AuthStatus =
  | 'loading'
  | 'signed-out'
  | 'no-profile'
  | 'disabled'
  | 'signed-in'
  | 'profile-fetch-failed'

export interface AuthContextValue {
  status: AuthStatus
  // Kept the name `fbUser` so existing consumers don't change; it now holds the
  // Supabase auth user.
  fbUser: SbUser | null
  profile: User | null
  profileError: Error | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

// Context, hooks, and the pure role-permission helpers live in this
// non-component module so AuthContext.tsx can export ONLY the provider
// component (react-refresh/only-export-components).
export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function useProfile() {
  const { profile } = useAuth()
  if (!profile)
    throw new Error('useProfile called outside of a signed-in route')
  return profile
}

/** Sales leadership. Stored as 'Head' in the database; older records and
 * earlier code used 'Sales Head'. Treat both as the same role so permissions
 * work regardless of how a given user happens to be saved. */
export const isHead = (role: Role) => role === 'Head' || role === 'Sales Head'

export const canSeeAll = (role: Role) =>
  role === 'Admin' || isHead(role) || role === 'BD'

// Activity log + Admin tools are Admin-facing. Heads run the task board and
// see all task/reminder data, but the audit log and Admin page are not part
// of their workspace — so neither tab shows for a Head.
export const canSeeActivities = (role: Role) => role === 'Admin' || role === 'BD'

/** Full Admin page access — users, projects CRUD, stages, import. */
export const canSeeAdmin = (role: Role) => role === 'Admin'

/** Can view the Admin page. Admin only — Heads have no Admin tab/route. */
export const canSeeAdminPage = (role: Role) => role === 'Admin'

/** Can add/remove reps to projects. */
export const canManageProjectMembers = (role: Role) =>
  role === 'Admin' || isHead(role)

export const canReassign = (role: Role) => role === 'Admin' || isHead(role)

/** Can create / delete tasks and assign them to reps. Admins and Heads
 * manage the task board; BD keeps read-only-all access, reps/interns
 * only see and update the status of their own tasks. */
export const canManageTasks = (role: Role) =>
  role === 'Admin' || isHead(role)

export const isAdmin = (role: Role) => role === 'Admin'
