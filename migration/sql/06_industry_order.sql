-- ── industries: admin-controlled display order ──────────────────────────────
-- Adds an `order` column so admins can drag-and-drop to reorder the industry
-- list on the Admin page (previously the list was always alphabetical). Lower
-- values sort first. Existing rows are backfilled with sequential values
-- following the current alphabetical order, so nothing visibly jumps on first
-- load. New rows are appended at the end by the app. Idempotent / re-runnable.
--
-- `order` is a reserved word in SQL, so it is always double-quoted.

alter table public.industries
  add column if not exists "order" integer not null default 0;

-- Backfill: assign 0,1,2,… by current name order, but only on first run —
-- guarded so a re-run does not clobber an order the admin has since arranged.
do $$
begin
  if not exists (
    select 1 from public.industries where "order" <> 0
  ) then
    update public.industries i
    set "order" = ranked.rn
    from (
      select id, (row_number() over (order by name) - 1) as rn
      from public.industries
    ) ranked
    where i.id = ranked.id;
  end if;
end $$;

-- Cheap ordered reads.
create index if not exists industries_order_idx on public.industries ("order");
