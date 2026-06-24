-- ============================================================================
-- Project packages
--
--  • projects.packages — jsonb array of packages. Each package:
--                          { id, videos: number, price: number }
--                        A project can have many (e.g. a UGC project offering
--                        10 / 20 / 30 videos). Set/edited by admins on the
--                        project form.
--  • deals.package_id        — which project package this lead is categorized
--                              into ('' = none).
--  • deals.package_snapshot  — jsonb snapshot of the chosen package at pick-
--                              time, so later edits to a project's packages do
--                              not retroactively change historical deals.
--
-- Idempotent / re-runnable.
-- ============================================================================

-- ── projects.kind + packages ────────────────────────────────────────────────
-- kind: 'normal' (UGC, Influencers — plain video-count packages) or 'bundle'
-- (a project that mixes videos from several normal projects at one price).
-- Existing projects default to 'normal'.
alter table public.projects
  add column if not exists kind text not null default 'normal';

-- jsonb array of packages; defaults to empty so existing projects are
-- unaffected. For a bundle project this holds a single cross-project package.
alter table public.projects
  add column if not exists packages jsonb not null default '[]'::jsonb;

-- ── deals: package categorization + snapshot ────────────────────────────────
alter table public.deals
  add column if not exists package_id text not null default '';

alter table public.deals
  add column if not exists package_snapshot jsonb;

create index if not exists deals_package_id_idx on public.deals (package_id);

-- ── cleanup: an earlier draft created a video_types table for typed package
--    line-items. Packages are now just a video count, so drop it if present.
drop table if exists public.video_types cascade;
