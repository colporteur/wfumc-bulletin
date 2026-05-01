-- =====================================================================
-- Convert sermons.original_sermon_number's partial unique INDEX
-- into a real unique CONSTRAINT.
--
-- The XLSX import uses Supabase's .upsert({ onConflict: 'col' }) which
-- under the hood emits "INSERT ... ON CONFLICT (col) DO UPDATE ...".
-- That requires a unique CONSTRAINT (or full unique index without a
-- WHERE clause) that PostgreSQL can name as the arbiter. A *partial*
-- unique index can't be used by Supabase's upsert syntax.
--
-- PostgreSQL's default UNIQUE constraint allows multiple NULL values
-- (NULLs are treated as distinct), so this still permits sermons that
-- have no original_sermon_number (e.g., sermons created via the
-- bulletin app's Order of Worship instead of imported from XLSX).
-- =====================================================================

drop index if exists public.sermons_original_number_uniq;

alter table public.sermons
  drop constraint if exists sermons_original_number_uniq;

alter table public.sermons
  add constraint sermons_original_number_uniq
  unique (original_sermon_number);
