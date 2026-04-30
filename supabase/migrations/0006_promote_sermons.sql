-- =====================================================================
-- Promote sermons to a first-class entity
--
-- Originally sermon data lived as columns on liturgy_items. That made
-- it a pain to:
--   - Re-preach the same sermon at a future church
--   - Build a separate Sermon Archive app on top
--   - Index/search sermons across the years
--
-- This migration creates a sermons table, moves the data over, links
-- liturgy_items to it via sermon_id, and drops the old columns.
--
-- Step order matters: liturgy_items.sermon_id must exist BEFORE the
-- sermons RLS policies that reference it (Postgres validates policy
-- expressions at CREATE time).
-- =====================================================================

-- 1. Create the sermons table (RLS enabled, but no policies yet).
create table public.sermons (
  id uuid primary key default gen_random_uuid(),
  title text,
  manuscript_text text,
  manuscript_url text,
  scripture_reference text,
  theme text,
  preached_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sermons_updated_at before update on public.sermons
  for each row execute function set_updated_at();

create index sermons_preached_at_idx on public.sermons (preached_at desc nulls last);

alter table public.sermons enable row level security;

-- 2. Add sermon_id FK on liturgy_items (BEFORE the policies below
--    reference it).
alter table public.liturgy_items
  add column if not exists sermon_id uuid references public.sermons(id) on delete set null;

create index liturgy_items_sermon_id_idx on public.liturgy_items (sermon_id);

-- 3. NOW create the sermons policies — li.sermon_id exists, so the
--    USING expression validates.
create policy "Anyone can read sermons of published bulletins"
  on public.sermons for select
  using (
    is_staff()
    or exists (
      select 1
      from public.liturgy_items li
      join public.bulletins b on b.id = li.bulletin_id
      where li.sermon_id = sermons.id
        and b.status = 'published'
    )
  );

create policy "Staff can write sermons"
  on public.sermons for all
  using (is_staff()) with check (is_staff());

-- 4. Migrate existing data: for every liturgy_item that has any sermon
--    field populated, create a sermons row and link it back.
do $$
declare
  rec record;
  new_id uuid;
begin
  for rec in
    select li.id, li.sermon_title, li.sermon_manuscript_text, li.sermon_manuscript_url, b.service_date
    from public.liturgy_items li
    join public.bulletins b on b.id = li.bulletin_id
    where li.item_type = 'sermon'
      and (
        li.sermon_title is not null
        or li.sermon_manuscript_text is not null
        or li.sermon_manuscript_url is not null
      )
  loop
    insert into public.sermons (title, manuscript_text, manuscript_url, preached_at)
    values (rec.sermon_title, rec.sermon_manuscript_text, rec.sermon_manuscript_url, rec.service_date)
    returning id into new_id;

    update public.liturgy_items set sermon_id = new_id where id = rec.id;
  end loop;
end $$;

-- 5. Drop the now-redundant columns from liturgy_items
alter table public.liturgy_items
  drop column if exists sermon_title,
  drop column if exists sermon_manuscript_text,
  drop column if exists sermon_manuscript_url;
