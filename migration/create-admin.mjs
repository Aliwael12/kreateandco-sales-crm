#!/usr/bin/env node
// One-off: create (or update) an Admin user directly in Supabase.
//
// Creates a matching pair:
//   • auth.users      — email + bcrypt password (via pgcrypto crypt()), email
//                       pre-confirmed, all token columns '' (so GoTrue can scan
//                       the row — see the import.mjs note), an auth.identities
//                       row for email/password sign-in.
//   • public.users    — the app profile with role = 'Admin'.
//
// id is a fresh gen_random_uuid() (a net-new user has no Firebase UID to map).
// Idempotent on email: re-running updates the password + profile.
//
// Reads SUPABASE_DB_URL from migration/.env (loaded by shared.loadEnvFile).
// Run:  node migration/create-admin.mjs
//
// Usage with custom values (else uses the built-in defaults below):
//   ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." node migration/create-admin.mjs

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadEnvFile } from './lib/shared.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
loadEnvFile(resolve(HERE, '.env'))

const NAME = process.env.ADMIN_NAME || 'Ali Wael'
const EMAIL = (process.env.ADMIN_EMAIL || 'a.wael@st-lr.com').toLowerCase()
const PASSWORD = process.env.ADMIN_PASSWORD || 'Wael@kreateandco48'
const COLOR = process.env.ADMIN_COLOR || '#5B4FCF'

if (!process.env.SUPABASE_DB_URL) {
  console.error('✗ SUPABASE_DB_URL missing (set it in migration/.env).')
  process.exit(1)
}

const { Client } = pg
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

try {
  await client.query('begin')

  // Does an auth user with this email already exist? If so, reuse its id.
  const existing = await client.query(
    'select id from auth.users where email = $1',
    [EMAIL],
  )
  let id
  if (existing.rows.length) {
    id = existing.rows[0].id
    // Update password + re-assert token columns + confirm email.
    await client.query(
      `update auth.users set
         encrypted_password = crypt($2, gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now(),
         confirmation_token = '', recovery_token = '', email_change = '',
         email_change_token_new = '', email_change_token_current = '',
         phone_change = '', phone_change_token = '', reauthentication_token = ''
       where id = $1`,
      [id, PASSWORD],
    )
    console.log(`· Updated existing auth user ${EMAIL} (${id})`)
  } else {
    const ins = await client.query(
      `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at,
          confirmation_token, recovery_token, email_change,
          email_change_token_new, email_change_token_current,
          phone_change, phone_change_token, reauthentication_token)
       values
         ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
          'authenticated', 'authenticated', $1,
          crypt($2, gen_salt('bf')),
          now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('name', $3::text),
          now(), now(),
          '', '', '', '', '', '', '', '')
       returning id`,
      [EMAIL, PASSWORD, NAME],
    )
    id = ins.rows[0].id
    console.log(`· Created auth user ${EMAIL} (${id})`)
  }

  // auth.identities row (required for email/password sign-in). $1 is used as
  // both provider_id (text) and user_id (uuid), so cast each use explicitly.
  await client.query(
    `insert into auth.identities
       (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text),
             'email', now(), now(), now())
     on conflict (provider, provider_id) do nothing`,
    [id, EMAIL],
  )

  // public.users profile with role Admin.
  await client.query(
    `insert into public.users
       (id, name, email, role, color, project_ids, disabled, created_at, updated_at)
     values ($1, $2, $3, 'Admin', $4, '{}', false, now(), now())
     on conflict (id) do update set
       name = excluded.name, email = excluded.email, role = 'Admin',
       color = excluded.color, disabled = false, updated_at = now()`,
    [id, NAME, EMAIL, COLOR],
  )

  await client.query('commit')
  console.log(`\n✓ Admin ready: ${NAME} <${EMAIL}> (role=Admin, id=${id})`)
  console.log('  Sign in with the email + the password you provided.')
} catch (err) {
  await client.query('rollback').catch(() => {})
  console.error('\n✗ Failed — rolled back.')
  console.error(err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
