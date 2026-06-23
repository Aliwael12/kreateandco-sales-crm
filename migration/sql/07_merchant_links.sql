-- ── merchants: external links ───────────────────────────────────────────────
-- Adds a `links` jsonb column holding an array of { url, label? } objects —
-- the merchant's website, social profiles, online menu, etc. Shown in the
-- merchant card with an icon derived from each url's domain. Mirrors how the
-- existing `contacts` jsonb column stores MerchantContact[]. Nullable; existing
-- rows default to null (no links). Idempotent / re-runnable.

alter table public.merchants
  add column if not exists links jsonb;
