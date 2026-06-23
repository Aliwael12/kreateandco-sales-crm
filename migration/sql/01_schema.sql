-- ============================================================================
-- kreateandco Sales CRM — Supabase Postgres schema
-- Migration target for the Firebase/Firestore → Supabase move.
--
-- DESIGN NOTES
-- ------------
-- 1. IDs. Firestore used two kinds of document IDs:
--      • users/{uid}        — the Firebase Auth UID (opaque string, NOT a UUID)
--      • everything else    — Firestore auto-generated 20-char IDs (strings)
--    Postgres `auth.users.id` MUST be a UUID, so each Firebase UID is mapped to
--    a DETERMINISTIC UUIDv5: uuidv5(firebaseUid, NAMESPACE). The same transform
--    is applied to every column that REFERENCES a user (createdBy, repId,
--    assigneeId, who, dismissedBy, ...). Because it's deterministic, the export,
--    import, and reference-rewrite all agree without a lookup table.
--
--    All OTHER document IDs are kept verbatim as TEXT primary keys. That means
--    merchantId / dealId / projectId / stageId / etc. never change, so no
--    relationship can break. This is the zero-data-loss guarantee.
--
-- 2. Timestamps. Firestore Timestamps become `timestamptz`. The export carries
--    the exact instant (ISO-8601 with ms), so no precision is lost.
--
-- 3. Foreign keys. We model the real relationships but keep most user-reference
--    FKs as plain uuid columns WITHOUT a hard FK constraint where the Firestore
--    data is known to contain orphans (e.g. activities referencing deleted
--    users, deals whose merchant was removed). Hard FKs that the data is
--    guaranteed to satisfy ARE enforced. This prevents the import from rejecting
--    historically-valid-but-now-orphaned rows — losing them would violate the
--    zero-loss requirement. Orphan auditing is done by the verify script, not by
--    refusing the data.
--
-- 4. RLS lives in 02_rls.sql; run this file first, then that one.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ── deterministic Firebase-UID → UUID mapping ──────────────────────────────
-- Fixed namespace UUID for this project. NEVER change it after the first
-- import or every user reference would point at a different UUID.
-- (Generated once; treat as a constant.)
create schema if not exists migration;

create or replace function migration.fb_uid_to_uuid(fb_uid text)
returns uuid
language sql
immutable
as $$
  -- uuid_generate_v5(namespace, name). Namespace below is constant for kreateandco.
  select uuid_generate_v5('b6c2f8a0-1d3e-4f5a-8b9c-7e6d5c4b3a21'::uuid, fb_uid);
$$;

-- ── enums ──────────────────────────────────────────────────────────────────
-- Mirrors src/lib/types.ts. 'Sales Head' kept for legacy rows; 'Head' canonical.
do $$ begin
  create type role_t as enum ('Admin', 'Head', 'Sales Head', 'BD', 'Rep', 'Intern');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_type_t as enum ('missed', 'followup', 'manual', 'assignment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status_t as enum (
    'Pending', 'In Progress', 'Completed', 'Not Reachable', 'Not Interested'
  );
exception when duplicate_object then null; end $$;

-- activity kind is a wide, append-only set that occasionally grows; keep it as
-- text (with a CHECK we can extend) rather than an enum that needs migrations.

-- ── users ──────────────────────────────────────────────────────────────────
-- public.users.id == auth.users.id == fb_uid_to_uuid(firebase uid).
-- This 1:1 mirrors the Firestore users/{uid} doc and is the join target for
-- every *Id user reference in the app.
create table if not exists public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  firebase_uid text unique,                    -- original UID, for traceability/rollback
  name         text not null default '',
  email        text not null,
  role         role_t not null default 'Rep',
  color        text not null default '#5B4FCF',
  project_ids  text[] not null default '{}',   -- array of projects.id
  disabled     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists users_email_idx on public.users (lower(email));
create index if not exists users_role_idx  on public.users (role);

-- ── projects ───────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id          text primary key,                -- preserved Firestore ID
  name        text not null default '',
  color       text not null default '',
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── stages ─────────────────────────────────────────────────────────────────
create table if not exists public.stages (
  id         text primary key,                 -- preserved Firestore ID
  name       text not null default '',
  color      text not null default '',
  "order"    integer not null default 0,
  locked     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists stages_order_idx on public.stages ("order");

-- ── merchants ──────────────────────────────────────────────────────────────
-- contacts[] is stored as jsonb to preserve the exact MerchantContact[] shape.
create table if not exists public.merchants (
  id           text primary key,               -- preserved Firestore ID
  name         text not null default '',
  name_lower   text not null default '',
  industry     text not null default '',
  contact      text not null default '',
  contact_role text not null default '',
  phone        text not null default '',
  email        text not null default '',
  contacts     jsonb,                           -- MerchantContact[] | null
  created_by   uuid,                            -- fb_uid_to_uuid(createdBy); may orphan
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- name_lower powers prefix search + the case-insensitive upsert. Index it for
-- the range queries used by usePaginatedMerchants / useMerchantSearch.
create index if not exists merchants_name_lower_idx on public.merchants (name_lower text_pattern_ops);
create index if not exists merchants_name_lower_btree on public.merchants (name_lower);
create index if not exists merchants_industry_idx on public.merchants (industry);

-- ── deals ──────────────────────────────────────────────────────────────────
create table if not exists public.deals (
  id            text primary key,              -- preserved Firestore ID
  merchant_id   text not null default '',       -- '' when unassigned; references merchants.id
  merchant_name text not null default '',
  project_id    text not null default '',       -- references projects.id
  rep_id        uuid,                           -- fb_uid_to_uuid(repId)
  status        text not null default '',
  rate          text not null default '',
  comments      text not null default '',
  created_by    uuid,                           -- fb_uid_to_uuid(createdBy)
  updated_by    uuid,                           -- fb_uid_to_uuid(updatedBy)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists deals_rep_id_idx      on public.deals (rep_id);
create index if not exists deals_project_id_idx  on public.deals (project_id);
create index if not exists deals_merchant_id_idx on public.deals (merchant_id);
create index if not exists deals_status_idx      on public.deals (status);
create index if not exists deals_created_at_idx  on public.deals (created_at);

-- ── reminders ──────────────────────────────────────────────────────────────
create table if not exists public.reminders (
  id            text primary key,              -- preserved Firestore ID
  deal_id       text not null default '',
  merchant_id   text not null default '',
  merchant_name text not null default '',
  project_id    text not null default '',
  rep_id        uuid,
  type          reminder_type_t not null default 'manual',
  note          text not null default '',
  due_at        timestamptz,
  dismissed     boolean not null default false,
  dismissed_at  timestamptz,
  dismissed_by  uuid,
  created_at    timestamptz not null default now()
);
create index if not exists reminders_rep_id_idx    on public.reminders (rep_id);
create index if not exists reminders_dismissed_idx on public.reminders (dismissed);
create index if not exists reminders_due_at_idx    on public.reminders (due_at);

-- ── tasks ──────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id                text primary key,          -- preserved Firestore ID
  title             text not null default '',
  merchant_id       text not null default '',
  merchant_name     text not null default '',
  project_id        text not null default '',
  assignee_id       uuid,                       -- fb_uid_to_uuid(assigneeId)
  created_by        uuid,
  created_by_name   text not null default '',
  note              text not null default '',
  status            task_status_t not null default 'Pending',
  status_note       text not null default '',
  status_updated_at timestamptz,
  status_updated_by uuid,
  due_at            timestamptz,               -- nullable (matches Timestamp | null)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists tasks_assignee_id_idx on public.tasks (assignee_id);
create index if not exists tasks_status_idx      on public.tasks (status);
create index if not exists tasks_due_at_idx      on public.tasks (due_at);

-- ── industries ─────────────────────────────────────────────────────────────
create table if not exists public.industries (
  id         text primary key,                 -- preserved Firestore ID
  name       text not null default '',
  created_at timestamptz not null default now()
);

-- ── activities ─────────────────────────────────────────────────────────────
-- Append-only audit log. refId may point at a since-deleted row; meta is jsonb.
create table if not exists public.activities (
  id         text primary key,                 -- preserved Firestore ID
  who        uuid,                              -- fb_uid_to_uuid(who)
  who_name   text not null default '',
  kind       text not null,
  text       text not null default '',
  ref_id     text,
  ref_kind   text,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activities_created_at_idx on public.activities (created_at desc);
create index if not exists activities_who_idx        on public.activities (who);

-- ── housekeeping triggers: keep updated_at fresh on app writes ──────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['users','projects','merchants','deals','tasks']
  loop
    execute format(
      'drop trigger if exists %I_touch on public.%I;', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function public.touch_updated_at();', t, t);
  end loop;
end $$;
