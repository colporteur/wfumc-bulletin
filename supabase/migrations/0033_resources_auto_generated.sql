-- =====================================================================
-- Resources — auto-generated provenance flag
--
-- The Sermons app's "Extract resources from a source" flow lets the
-- pastor paste / upload reading material (articles, book chapters,
-- PDFs) and have Claude propose discrete sermon-illustration resources
-- to import. We want to record on each resulting resource that it came
-- from this auto-extraction pipeline so the pastor knows where it came
-- from later when scanning the library.
--
-- Two columns:
--   auto_generated      — boolean. True for resources created via the
--                         extract pipeline. Pastor can toggle off later
--                         once they've reviewed and "claimed" the
--                         resource as their own.
--   auto_source_label   — short label of the source material — usually
--                         the filename ("Henri-Nouwen-Inner-Voice.pdf"),
--                         a URL, or "Pasted text" if it was raw paste.
--                         Optional. Useful for identifying which import
--                         a resource came from.
--
-- Both nullable; existing rows get auto_generated=false implicitly.
-- =====================================================================

alter table public.resources
  add column if not exists auto_generated boolean not null default false,
  add column if not exists auto_source_label text;

create index if not exists resources_auto_generated_idx
  on public.resources (auto_generated)
  where auto_generated = true;
