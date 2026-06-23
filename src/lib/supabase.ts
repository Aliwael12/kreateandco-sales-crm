import { createClient } from '@supabase/supabase-js'

// Supabase client — the single connection the whole app shares. Replaces the
// Firebase app/auth/db trio from the old lib/firebase.ts.
//
// Both values are PUBLIC (the anon key is safe to ship in the client bundle;
// Row Level Security is what actually protects the data — see migration/sql).
// They are inlined by Vite from VITE_-prefixed env vars at build time.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env vars: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env.local and fill in the values from the Supabase ' +
      'dashboard (Project Settings → API).',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Persist the session in localStorage and refresh it automatically — the
    // equivalent of Firebase Auth's default browserLocalPersistence.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
