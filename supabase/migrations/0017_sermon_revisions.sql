-- =====================================================================
-- Sermon revisions: snapshot prior versions of a sermon
--
-- Background: When Pastor Todd preaches a sermon at a new location, he
-- often makes major revisions — sometimes even changing the title. He
-- wants the canonical sermon row to hold the *most recent* version, but
-- with the option to snapshot earlier versions when there's material he
-- might want to revive later.
--
-- A few imported titles encode the rename inline, e.g.
--   "Walking with Jesus / The Long Road Home"
--   "The Long Road Home | Retitled: Walking with Jesus"
-- This migration also splits those: the right side becomes the canonical
-- title, the left side is preserved as a revision row.
--
-- Concept:
--   sermon_revisions — full snapshots of a sermon's editable state at a
--                      point in time, with an optional human label
--                      ("Pre-Wedowee rewrite", "Original 2014 version").
--
-- Snapshot fields mirror the user-editable text columns on `sermons`.
-- They're intentionally NOT a foreign reference to the current row — a
-- revision is meant to survive future edits, including title changes.
-- =====================================================================

create table if not exists public.sermon_revisions (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  -- Frozen snapshot of the sermon's editable text at this revision.
  snapshot_title text,
  snapshot_manuscript_text text,
  snapshot_scripture_reference text,
  snapshot_theme text,
  snapshot_notes text,
  -- Optional human-readable label, e.g. "Pre-Wedowee rewrite".
  label text,
  -- When this snapshot was taken (not when the sermon was first preached).
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists sermon_revisions_sermon_idx
  on public.sermon_revisions (sermon_id, taken_at desc);

create index if not exists sermon_revisions_owner_idx
  on public.sermon_revisions (owner_user_id);

alter table public.sermon_revisions enable row level security;

-- Owner OR staff can read.
create policy "Sermon revision read by owner or staff"
  on public.sermon_revisions for select
  using (auth.uid() = owner_user_id or is_staff());

-- Owner OR staff can insert (new row must be stamped to the owner).
create policy "Sermon revision insert by owner or staff"
  on public.sermon_revisions for insert
  with check (auth.uid() = owner_user_id or is_staff());

-- Owner OR staff can update (label edits, etc).
create policy "Sermon revision update by owner or staff"
  on public.sermon_revisions for update
  using (auth.uid() = owner_user_id or is_staff());

-- Owner OR staff can delete.
create policy "Sermon revision delete by owner or staff"
  on public.sermon_revisions for delete
  using (auth.uid() = owner_user_id or is_staff());

-- =====================================================================
-- Backfill: split inline-renamed titles
--
-- Patterns we rewrite:
--   "<old> / <new>"               → canonical = <new>, revision = <old>
--   "<new> | Retitled: <old>"     → canonical = <new>, revision = <old>
--
-- Both patterns require literal spaces around the separator so we don't
-- mangle titles that legitimately contain "/" (e.g., scripture refs)
-- or "|" without intent to mark a rename.
-- =====================================================================

do $$
declare
  r record;
  old_title text;
  new_title text;
  sep_pos int;
begin
  -- Pattern 1: " / " separator. Right side wins.
  for r in
    select id, owner_user_id, title, manuscript_text, scripture_reference,
           theme, notes
    from public.sermons
    where title is not null
      and title like '% / %'
      -- Skip if a revision already exists for this sermon (idempotent
      -- re-run safety).
      and not exists (
        select 1 from public.sermon_revisions sr
        where sr.sermon_id = sermons.id
      )
  loop
    sep_pos := position(' / ' in r.title);
    if sep_pos > 0 then
      old_title := trim(substring(r.title from 1 for sep_pos - 1));
      new_title := trim(substring(r.title from sep_pos + 3));
      if length(new_title) > 0 and length(old_title) > 0 then
        insert into public.sermon_revisions
          (sermon_id, owner_user_id, snapshot_title, snapshot_manuscript_text,
           snapshot_scripture_reference, snapshot_theme, snapshot_notes,
           label)
        values
          (r.id, r.owner_user_id, old_title, r.manuscript_text,
           r.scripture_reference, r.theme, r.notes,
           'Earlier title from import');
        update public.sermons
        set title = new_title
        where id = r.id;
      end if;
    end if;
  end loop;

  -- Pattern 2: " | Retitled: " separator. Left side wins.
  for r in
    select id, owner_user_id, title, manuscript_text, scripture_reference,
           theme, notes
    from public.sermons
    where title is not null
      and title ilike '% | Retitled: %'
      and not exists (
        select 1 from public.sermon_revisions sr
        where sr.sermon_id = sermons.id
      )
  loop
    sep_pos := position(' | Retitled: ' in r.title);
    -- Try case-insensitive fallback if exact match failed (ilike was
    -- the filter; position is case-sensitive).
    if sep_pos = 0 then
      sep_pos := position(' | retitled: ' in lower(r.title));
    end if;
    if sep_pos > 0 then
      new_title := trim(substring(r.title from 1 for sep_pos - 1));
      old_title := trim(substring(r.title from sep_pos + 13));
      if length(new_title) > 0 and length(old_title) > 0 then
        insert into public.sermon_revisions
          (sermon_id, owner_user_id, snapshot_title, snapshot_manuscript_text,
           snapshot_scripture_reference, snapshot_theme, snapshot_notes,
           label)
        values
          (r.id, r.owner_user_id, old_title, r.manuscript_text,
           r.scripture_reference, r.theme, r.notes,
           'Earlier title from import');
        update public.sermons
        set title = new_title
        where id = r.id;
      end if;
    end if;
  end loop;
end $$;
