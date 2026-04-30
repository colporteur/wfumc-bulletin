-- =====================================================================
-- Worship plans table — long-range planning for upcoming Sundays
--
-- Filled in by the future Worship Planning app (where the pastor and
-- worship team plan themes, scripture, sermon topics weeks or months
-- ahead). When a bulletin is created for a service_date that has a
-- matching worship_plans row, the bulletin will be auto-populated
-- with that plan's data.
--
-- This migration only creates the shape. No UI yet, no auto-populate
-- yet — that lives in the future Worship Planning app and a small
-- hook in BulletinList when "+ New bulletin" is clicked.
-- =====================================================================

create table public.worship_plans (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  theme text,
  scripture_reference text,
  sermon_topic text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger worship_plans_updated_at before update on public.worship_plans
  for each row execute function set_updated_at();

create index worship_plans_service_date_idx on public.worship_plans (service_date);

alter table public.worship_plans enable row level security;

-- Staff-only — these are internal planning notes, not for worshippers.
create policy "Staff can read worship_plans"
  on public.worship_plans for select
  using (is_staff());

create policy "Staff can write worship_plans"
  on public.worship_plans for all
  using (is_staff()) with check (is_staff());
