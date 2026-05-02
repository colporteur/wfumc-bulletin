-- =====================================================================
-- Worshipper highlights + social media channels
--
-- Two related additions to support the social media team workflow:
--
-- 1. Highlights — a worshipper reading the bulletin can select text
--    (a sermon line, a hymn lyric, a liturgical phrase) and submit it
--    to the social media team with optional commentary. Reuses the
--    `responses` table since the shape (per-bulletin, optional name,
--    free-form text + image) is the same. New columns distinguish a
--    "highlight" submission from a "prompt response":
--      - highlighted_text  the snippet the worshipper selected
--      - source_label      free-form context ("Sermon", "Hymn 314, vs 2",
--                          "Pastoral Prayer") so the social media team
--                          knows where it came from
--
-- 2. social_channels — predefined list of channels the social media team
--    posts to (Facebook, Instagram, plus any user-added). Powers the
--    chip selector on the Social app's post editor and gives the team
--    one place to manage their channel set.
--
--    The social_posts.platforms text[] column stays — channel slugs are
--    written into it. We don't FK because we want posts to keep their
--    history even if a channel is later deleted.
-- =====================================================================

-- 1. Extend responses for highlight submissions
alter table public.responses
  add column if not exists highlighted_text text,
  add column if not exists source_label text;

-- A submission is a highlight when highlighted_text is not null.
-- Useful for filtering in the social app.
create index if not exists responses_highlight_idx
  on public.responses (bulletin_id)
  where highlighted_text is not null;

-- 2. Social channels
create table if not exists public.social_channels (
  id uuid primary key default gen_random_uuid(),
  -- URL/lookup-friendly slug; lowercase, no spaces. e.g., "facebook".
  slug text not null unique,
  -- Display name. e.g., "Facebook".
  name text not null,
  -- Optional small color hint for the chip in the UI ("#1877f2" for
  -- Facebook, etc.). The UI falls back to a neutral chip if null.
  color text,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists social_channels_sort_idx
  on public.social_channels (sort_order, name);

alter table public.social_channels enable row level security;

-- Anyone authenticated can read the channel list (so the Social app
-- can render chips for everyone).
create policy "Channels readable by authenticated"
  on public.social_channels for select
  using (auth.role() = 'authenticated');

-- Staff can manage channels. (Social media team are typically staff;
-- non-staff users posting personally have their own UI flow that just
-- consumes the existing list.)
create policy "Channels writable by staff"
  on public.social_channels for insert
  with check (is_staff());
create policy "Channels updatable by staff"
  on public.social_channels for update
  using (is_staff());
create policy "Channels deletable by staff"
  on public.social_channels for delete
  using (is_staff());

-- 3. Seed Facebook + Instagram so the app has sensible defaults out of
--    the box. Idempotent via slug uniqueness.
insert into public.social_channels (slug, name, color, sort_order)
values
  ('facebook',  'Facebook',  '#1877f2', 10),
  ('instagram', 'Instagram', '#e4405f', 20)
on conflict (slug) do nothing;
