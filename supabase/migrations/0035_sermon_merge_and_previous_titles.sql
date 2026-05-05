-- =====================================================================
-- Sermon merge + previous-titles tracking
--
-- 1. previous_titles text[] on sermons — array of former names. Useful
--    when the pastor renames a sermon (and wants to remember the old
--    title for searchability) or when two sermon entries get merged
--    (the loser's title becomes a previous name on the winner).
--
-- 2. merge_sermons(source_id, target_id) — atomically combines two
--    sermon rows into one. The target survives; the source is deleted.
--    All child rows (preachings, liturgy_items, sermon_resources,
--    sermon_revisions, sermon_liturgy_links, worship_plans) get
--    reassigned to the target. Tables with unique-on-(sermon, X)
--    constraints get duplicate rows dropped before reassignment.
--    The source's title (and its own previous_titles) get pushed onto
--    the target's previous_titles. Source notes append to target notes.
--    Source manuscript copies to target ONLY if target has none.
--
--    Ownership safety: refuses to merge sermons owned by different
--    users. RLS additionally enforces visibility — the function runs
--    SECURITY INVOKER so the caller's permissions apply.
-- =====================================================================

-- 1. previous_titles column
alter table public.sermons
  add column if not exists previous_titles text[] not null default '{}';

-- 2. merge_sermons function
create or replace function public.merge_sermons(
  p_source_id uuid,
  p_target_id uuid
)
returns void
language plpgsql
security invoker
as $$
declare
  source_sermon record;
  target_sermon record;
begin
  if p_source_id is null or p_target_id is null then
    raise exception 'Both source and target ids are required.';
  end if;
  if p_source_id = p_target_id then
    raise exception 'Source and target are the same sermon.';
  end if;

  select * into source_sermon from public.sermons where id = p_source_id;
  if not found then raise exception 'Source sermon not found (or not visible to you).'; end if;

  select * into target_sermon from public.sermons where id = p_target_id;
  if not found then raise exception 'Target sermon not found (or not visible to you).'; end if;

  if source_sermon.owner_user_id is distinct from target_sermon.owner_user_id then
    raise exception 'Cannot merge sermons owned by different users.';
  end if;

  -- Reassign children. Tables WITHOUT unique constraints on sermon_id:
  update public.preachings
     set sermon_id = p_target_id
   where sermon_id = p_source_id;

  update public.liturgy_items
     set sermon_id = p_target_id
   where sermon_id = p_source_id;

  update public.sermon_revisions
     set sermon_id = p_target_id
   where sermon_id = p_source_id;

  update public.worship_plans
     set selected_sermon_id = p_target_id
   where selected_sermon_id = p_source_id;

  -- sermon_resources has UNIQUE(sermon_id, resource_id). Drop dups first.
  delete from public.sermon_resources sr
   using public.sermon_resources sr2
   where sr.sermon_id = p_source_id
     and sr2.sermon_id = p_target_id
     and sr.resource_id = sr2.resource_id;
  update public.sermon_resources
     set sermon_id = p_target_id
   where sermon_id = p_source_id;

  -- sermon_liturgy_links has UNIQUE(liturgy_id, sermon_id). Drop dups first.
  delete from public.sermon_liturgy_links sl
   using public.sermon_liturgy_links sl2
   where sl.sermon_id = p_source_id
     and sl2.sermon_id = p_target_id
     and sl.liturgy_id = sl2.liturgy_id;
  update public.sermon_liturgy_links
     set sermon_id = p_target_id
   where sermon_id = p_source_id;

  -- Merge previous_titles: union of (target.previous_titles, source.title,
  -- source.previous_titles), with the target's CURRENT title removed
  -- (no point listing it as a former name).
  update public.sermons t
     set previous_titles = (
       select coalesce(array_agg(distinct x), '{}'::text[])
         from unnest(
                coalesce(t.previous_titles, '{}'::text[])
                || coalesce(source_sermon.previous_titles, '{}'::text[])
                || case
                     when source_sermon.title is not null and source_sermon.title <> ''
                       then array[source_sermon.title]
                     else '{}'::text[]
                   end
              ) as x
        where x is not null
          and x <> ''
          and x <> coalesce(t.title, '')
     )
   where t.id = p_target_id;

  -- Append source notes if present, with a separator so the merge is visible.
  if source_sermon.notes is not null and trim(source_sermon.notes) <> '' then
    update public.sermons
       set notes = case
             when notes is null or trim(notes) = '' then source_sermon.notes
             else notes || E'\n\n--- merged from "'
                  || coalesce(source_sermon.title, 'untitled') || '" ---\n'
                  || source_sermon.notes
           end
     where id = p_target_id;
  end if;

  -- Copy manuscript if target has none AND source has one.
  update public.sermons
     set manuscript_text = source_sermon.manuscript_text,
         manuscript_url = source_sermon.manuscript_url
   where id = p_target_id
     and (manuscript_text is null or trim(manuscript_text) = '')
     and (manuscript_url is null or trim(manuscript_url) = '')
     and (
       (source_sermon.manuscript_text is not null and trim(source_sermon.manuscript_text) <> '')
       or (source_sermon.manuscript_url is not null and trim(source_sermon.manuscript_url) <> '')
     );

  -- Finally, delete the source. (Cascades have already been replaced
  -- above, so nothing of value is lost.)
  delete from public.sermons where id = p_source_id;
end;
$$;

-- Allow authenticated callers to invoke the function (RLS still applies
-- inside it because of SECURITY INVOKER).
grant execute on function public.merge_sermons(uuid, uuid) to authenticated;
