-- ── platforms: admin-managed e-commerce platform taxonomy ───────────────────
-- A flat list (Shopify, WooCommerce, …) a merchant can be tagged with on its
-- card. Mirrors the `industries` table and its RLS, plus a `platform` column on
-- merchants (mirrors how `subcategory` was added). Idempotent / re-runnable.

create table if not exists public.platforms (
  id         text primary key,                 -- app-generated id (newId())
  name       text not null default '',
  created_at timestamptz not null default now()
);

-- Merchants gain an optional platform (by name, matching how industry/
-- subcategory are referenced). Empty string = none set.
alter table public.merchants
  add column if not exists platform text not null default '';

create index if not exists merchants_platform_idx on public.merchants (platform);

-- ── RLS: same model as industries — everyone signed in reads; only Admin writes.
alter table public.platforms enable row level security;

drop policy if exists platforms_read on public.platforms;
drop policy if exists platforms_write on public.platforms;

create policy platforms_read on public.platforms
  for select to authenticated using (true);

create policy platforms_write on public.platforms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
