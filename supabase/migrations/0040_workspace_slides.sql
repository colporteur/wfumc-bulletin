-- =====================================================================
-- Workspace slides
--
-- Per-sermon slides authored alongside the manuscript in the Sermon
-- Workspace. Stored separately from the manuscript text so we can
-- generate a real .pptx deck later without trying to parse content
-- back out of the manuscript prose.
--
-- Each slide can be ANCHORED to a paragraph in the manuscript by
-- storing a copy of that paragraph's text. After Claude revises the
-- manuscript, the workspace re-resolves anchors against the new
-- paragraph list:
--
--   * exact match on normalized fingerprint  → still anchored, no change
--   * high-similarity match (Jaccard >= 0.5) → anchor moved + flagged "modified"
--   * no match                               → "stranded" — surface for triage
--
-- The relationship to the inline `<SLIDE #N – Description>` markers
-- the pastor types in the manuscript is intentionally loose. Those
-- markers are navigation cues for the printed manuscript; this table
-- holds the actual slide content for the pptx export. Numbering is
-- by sort_order here; the pastor manages the corresponding inline
-- markers in the manuscript text by hand.
-- =====================================================================

create table if not exists public.workspace_slides (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  -- Denormalized owner for cheap RLS (matches parent sermon's owner;
  -- enforced at the app layer).
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Ordering within the sermon. Slide 1 is sort_order 0, etc.
  sort_order int not null default 0,

  -- What kind of slide this is — drives template selection in the
  -- pptx exporter (e.g. title-slide layout vs scripture-quote layout).
  slide_type text not null default 'content'
    check (slide_type in (
      'title', 'scripture', 'quote', 'image', 'content', 'blank'
    )),

  -- Slide text. title is the heading on the slide; body is the main
  -- content; notes are speaker notes / context (not shown on the slide
  -- itself but appear in the pptx speaker-notes pane).
  title text,
  body text,
  notes text,

  -- Anchor: a copy of the manuscript paragraph this slide is pinned
  -- to, captured at pin time. The workspace re-resolves it against
  -- the current manuscript on every load. NULL = unanchored slide
  -- (a deck-level slide that doesn't correspond to a specific moment
  -- in the manuscript, e.g. an opening title slide).
  anchor_paragraph_text text,
  -- Cached index for fast initial render. Refreshed whenever the
  -- workspace re-resolves the anchor against the live manuscript.
  -- Doesn't have to be authoritative — anchor_paragraph_text is.
  anchor_paragraph_idx int,

  -- Image slides can pin to a resource (typically a photo resource).
  -- ON DELETE SET NULL so removing a resource doesn't nuke the slide.
  image_resource_id uuid references public.resources(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspace_slides_updated_at
  before update on public.workspace_slides
  for each row execute function set_updated_at();

create index if not exists workspace_slides_sermon_idx
  on public.workspace_slides (sermon_id, sort_order);
create index if not exists workspace_slides_owner_idx
  on public.workspace_slides (owner_user_id);

alter table public.workspace_slides enable row level security;

create policy "Workspace slides read by owner or staff"
  on public.workspace_slides for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Workspace slides insert by owner or staff"
  on public.workspace_slides for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Workspace slides update by owner or staff"
  on public.workspace_slides for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Workspace slides delete by owner or staff"
  on public.workspace_slides for delete
  using (auth.uid() = owner_user_id or is_staff());
