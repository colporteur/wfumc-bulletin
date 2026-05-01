-- =====================================================================
-- Response Prompt feature
--
-- Per Pastor Todd: each week the pastor / admin / social media team
-- can write a "Response Prompt" — a question or invitation that
-- worshippers can respond to with text, an optional photo, and an
-- optional caption. The social media team uses these as content for
-- the church's social media posts.
--
-- Schema additions:
--   bulletins.response_prompt — the week's prompt text
--   responses                 — worshipper submissions (text + image)
--
-- Privacy:
--   - Anyone can submit (anon worshipper)
--   - Only staff can read/update/delete
--   - Worshippers don't see other worshippers' responses (encourages
--     candor; the social media team curates publicly)
-- =====================================================================

-- 1. Per-bulletin response prompt
alter table public.bulletins
  add column if not exists response_prompt text;

-- 2. Responses table
create table public.responses (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  is_anonymous boolean not null default false,
  submitter_name text,
  parishioner_id uuid references public.parishioners(id) on delete set null,
  response_text text,
  caption text,
  image_url text,
  used_in_social_media boolean not null default false,
  submitted_at timestamptz not null default now()
);

create index responses_bulletin_id_idx on public.responses (bulletin_id, submitted_at desc);
create index responses_used_idx on public.responses (used_in_social_media, submitted_at desc);

alter table public.responses enable row level security;

-- Anyone can submit (anon worshipper through the bulletin)
create policy "Anyone can submit responses"
  on public.responses for insert
  with check (true);

-- Staff can read all responses
create policy "Staff can read responses"
  on public.responses for select
  using (is_staff());

-- Staff can update (mark used_in_social_media, edit fields, etc.)
create policy "Staff can update responses"
  on public.responses for update
  using (is_staff());

-- Staff can delete
create policy "Staff can delete responses"
  on public.responses for delete
  using (is_staff());

-- 3. Parishioner matching trigger (same pattern as prayer_requests + check_ins)
create or replace function public.response_match_parishioner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parishioner_id is null
     and new.submitter_name is not null
     and new.is_anonymous is not true
  then
    new.parishioner_id := public.try_match_parishioner(new.submitter_name);
  end if;
  return new;
end;
$$;

drop trigger if exists responses_match_parishioner on public.responses;
create trigger responses_match_parishioner
  before insert on public.responses
  for each row execute function public.response_match_parishioner();

-- 4. Storage: allow anonymous worshippers to upload response photos.
--    The bucket-wide insert policy requires staff; we add a narrower
--    exception that lets anyone upload IF the path is under responses/.
--    File size is still capped by the bucket's file_size_limit (10 MB),
--    and the random path component prevents overwriting existing files.
drop policy if exists "Anyone can submit response images" on storage.objects;
create policy "Anyone can submit response images"
  on storage.objects for insert
  with check (
    bucket_id = 'bulletin-images'
    and (storage.foldername(name))[1] = 'responses'
  );
