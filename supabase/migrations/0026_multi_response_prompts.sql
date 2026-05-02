-- =====================================================================
-- Multiple response prompts per bulletin
--
-- Replaces the single bulletins.response_prompt text column with a
-- proper response_prompts table so a bulletin can carry several prompts
-- (e.g., one tied to the sermon, one to the choir anthem, one open).
--
-- Each worshipper response now optionally links to the specific prompt
-- it answers, so the social media team knows which prompt drew which
-- responses. Highlights and legacy responses keep prompt_id = NULL.
--
-- Migration is non-destructive on read: existing rows in
-- bulletins.response_prompt become a single row in the new table per
-- bulletin (sort_order = 0), then the column is dropped.
-- =====================================================================

create table if not exists public.response_prompts (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  text text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger response_prompts_updated_at before update on public.response_prompts
  for each row execute function set_updated_at();

create index if not exists response_prompts_bulletin_idx
  on public.response_prompts (bulletin_id, sort_order);

alter table public.response_prompts enable row level security;

-- Read: anyone can read prompts for published bulletins (worshippers
-- need to see them); staff can read all (for admin work on drafts).
create policy "Prompts readable on published bulletins or by staff"
  on public.response_prompts for select
  using (
    is_staff()
    or exists (
      select 1 from public.bulletins b
      where b.id = response_prompts.bulletin_id
        and b.status = 'published'
    )
  );

-- Write: staff only.
create policy "Prompts writable by staff"
  on public.response_prompts for insert
  with check (is_staff());
create policy "Prompts updatable by staff"
  on public.response_prompts for update
  using (is_staff());
create policy "Prompts deletable by staff"
  on public.response_prompts for delete
  using (is_staff());

-- Backfill: every existing bulletin with a non-empty response_prompt
-- becomes a single row in the new table.
insert into public.response_prompts (bulletin_id, text, sort_order)
select id, response_prompt, 0
from public.bulletins
where response_prompt is not null
  and length(trim(response_prompt)) > 0
  and not exists (
    select 1 from public.response_prompts rp
    where rp.bulletin_id = bulletins.id
  );

-- Drop the old single-prompt column.
alter table public.bulletins drop column if exists response_prompt;

-- Link responses to the prompt they answered. Nullable: highlights
-- aren't tied to a prompt, and legacy responses (pre-this migration)
-- can't be retroactively linked.
alter table public.responses
  add column if not exists prompt_id uuid
    references public.response_prompts(id) on delete set null;

create index if not exists responses_prompt_idx
  on public.responses (prompt_id) where prompt_id is not null;
