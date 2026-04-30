-- =====================================================================
-- Parishioners table + foreign keys on prayer_requests / check_ins
--
-- Privacy stance from Pastor Todd:
--   - Table starts empty. Never preemptively populated from member rolls.
--   - Grows organically as people self-identify by submitting prayer
--     requests, checking in, etc.
--   - No worshipper-facing UI ever lists or autocompletes from this
--     table. Always free-text input. Submitted names get matched
--     server-side or queued for manual review.
--   - Staff-only RLS — never readable by anonymous worshippers.
--
-- This migration just creates the shape. The match-queue UI lives in
-- the future Pastoral Visitation app; the prayer-submission and
-- check-in forms (also future) will write text names today and link
-- to parishioner_id once we add the matching logic.
-- =====================================================================

create table public.parishioners (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  is_member boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger parishioners_updated_at before update on public.parishioners
  for each row execute function set_updated_at();

create index parishioners_full_name_idx on public.parishioners (lower(full_name));

alter table public.parishioners enable row level security;

-- Staff-only. No public read, no public write.
create policy "Staff can read parishioners"
  on public.parishioners for select
  using (is_staff());

create policy "Staff can write parishioners"
  on public.parishioners for all
  using (is_staff()) with check (is_staff());

-- Add nullable parishioner_id FK to prayer_requests
alter table public.prayer_requests
  add column if not exists parishioner_id uuid references public.parishioners(id) on delete set null;

create index if not exists prayer_requests_parishioner_id_idx
  on public.prayer_requests (parishioner_id);

-- Add nullable parishioner_id FK to check_ins
alter table public.check_ins
  add column if not exists parishioner_id uuid references public.parishioners(id) on delete set null;

create index if not exists check_ins_parishioner_id_idx
  on public.check_ins (parishioner_id);
