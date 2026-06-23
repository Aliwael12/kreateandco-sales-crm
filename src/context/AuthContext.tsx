import { useEffect, useState, type ReactNode } from 'react'
import type { User as SbUser } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { mapUser } from '@/lib/db'
import type { User } from '@/lib/types'
import { AuthContext, type AuthStatus } from '@/context/auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [fbUser, setFbUser] = useState<SbUser | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [profileError, setProfileError] = useState<Error | null>(null)

  useEffect(() => {
    let active = true

    // Load the public.users profile for the signed-in auth user. One-shot fetch
    // (not a live subscription) to keep the read-light posture the app relies
    // on — freshness on profile changes comes on the next sign-in / reload,
    // which matches how the original `disabled` kill-switch behaved in practice.
    async function loadProfile(u: SbUser) {
      setStatus('loading')
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', u.id)
        .maybeSingle()
      if (!active) return
      if (error) {
        setProfile(null)
        setProfileError(error as unknown as Error)
        setStatus('profile-fetch-failed')
        return
      }
      if (!data) {
        setProfile(null)
        setProfileError(null)
        setStatus('no-profile')
        return
      }
      const mapped = mapUser(data)
      setProfile(mapped)
      setProfileError(null)
      setStatus(mapped.disabled ? 'disabled' : 'signed-in')
    }

    function handleSession(u: SbUser | null) {
      setFbUser(u)
      setProfileError(null)
      if (!u) {
        setProfile(null)
        setStatus('signed-out')
        return
      }
      void loadProfile(u)
    }

    // Initial session check + subscribe to future auth changes.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      handleSession(data.session?.user ?? null)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session?.user ?? null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{ status, fbUser, profile, profileError, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}
