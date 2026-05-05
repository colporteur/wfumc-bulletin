-- =====================================================================
-- Cleanup: dedupe Wedowee preaching-location variants
--
-- Pastor Todd's Sermon Database XLSX has location entries across years
-- that all refer to the same church but use different strings:
--   2024 yearly sheet:  "Wedowee"
--   2025 yearly sheet:  "Wedowee FUMC"
--   2026 yearly sheet:  "Wedowee First UMC"
--   Master sheet col:   "Wedowee"
--
-- After importing the Master-sheet preachings, we ended up with
-- multiple preaching rows for the same (sermon_id, preached_at) where
-- the only difference is one of these location string variants.
--
-- This migration collapses each such duplicate group down to one row,
-- keeping the most-specific location label (preferred order:
-- "Wedowee First UMC" > "Wedowee FUMC" > "Wedowee"). It scopes
-- aggressively to ONLY rows whose location matches a wedowee pattern,
-- so other churches' duplicates aren't touched.
-- =====================================================================

with wedowee_groups as (
  select
    sermon_id,
    preached_at,
    array_agg(id order by
      case
        when lower(location) like '%first umc%' then 1
        when lower(location) like '%fumc%' then 2
        else 3
      end,
      length(coalesce(location, '')) desc,
      created_at asc
    ) as ids
  from public.preachings
  where preached_at is not null
    and lower(coalesce(location, '')) like 'wedowee%'
  group by sermon_id, preached_at
  having count(*) > 1
),
ids_to_delete as (
  select unnest(ids[2:array_length(ids, 1)]) as id from wedowee_groups
)
delete from public.preachings p
using ids_to_delete d
where p.id = d.id;

-- Optional: while we're here, also pick the most-specific name as the
-- "winner" for the surviving row in each group. This rewrites
-- "Wedowee" → "Wedowee First UMC" on the rows we kept, so the display
-- is consistent.
update public.preachings p
set location = 'Wedowee First UMC'
where preached_at is not null
  and lower(coalesce(location, '')) like 'wedowee%'
  and location <> 'Wedowee First UMC';
