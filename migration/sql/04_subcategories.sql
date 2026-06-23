-- ============================================================================
-- Feature: industry subcategories.
--
-- Admins manage subcategories nested under each industry (e.g. F&B -> Chinese,
-- Italian). A merchant may be categorized by industry alone, or industry +
-- subcategory (subcategory nullable).
--
-- `industry` is stored as TEXT (the industry NAME), matching how
-- public.merchants.industry already references industries by name rather than
-- id. This keeps the denormalized model consistent across the app.
-- ============================================================================

create table if not exists public.subcategories (
  id         text primary key,                 -- app-generated id (newId())
  name       text not null default '',
  industry   text not null default '',          -- the parent industry NAME
  created_at timestamptz not null default now()
);

-- Fast lookup of an industry's subcategories (the merchant form filters by this).
create index if not exists subcategories_industry_idx on public.subcategories (industry);
-- Prevent duplicate subcategory names within the same industry (case-insensitive).
create unique index if not exists subcategories_industry_name_uniq
  on public.subcategories (industry, lower(name));

-- Merchant gains an optional subcategory (the subcategory NAME, or NULL/'' ).
alter table public.merchants
  add column if not exists subcategory text not null default '';

-- ── RLS: same model as industries (everyone signed in reads; only Admin writes)
alter table public.subcategories enable row level security;

drop policy if exists subcategories_read on public.subcategories;
drop policy if exists subcategories_write on public.subcategories;

create policy subcategories_read on public.subcategories
  for select to authenticated using (true);

create policy subcategories_write on public.subcategories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
