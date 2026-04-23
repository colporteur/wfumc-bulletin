-- =====================================================================
-- Wedowee First UMC Bulletin — Initial Schema (v0.1)
--
-- Run this entire file in the Supabase SQL Editor.
-- See docs/SETUP.md, Step 3.
--
-- Tables created:
--   church_settings        (singleton — one row holds church-wide config)
--   staff_profiles         (extends auth.users with role + display name)
--   bulletins              (one row per Sunday service)
--   bulletin_sections      (ordered list of section blocks per bulletin)
--   liturgy_items          (ordered Order of Worship items)
--   prayer_requests        (rolling prayer list across bulletins)
--   prayer_categories      (configurable list of categories)
--   check_ins              (worshipper check-in submissions)
--   calendar_events        (manual + Google-imported)
--   weekly_schedule_items  (Each Week defaults)
--   birthdays              (name + month + day)
--   stewardship_funds      (configurable list of designated funds)
--   stewardship_entries    (per-bulletin per-fund $ amounts)
--   attendance_categories  (configurable list of categories)
--   attendance_entries     (per-bulletin per-category counts)
--   leading_worship_roles  (default roles list)
--   leading_worship_assignments  (per-bulletin overrides)
--   greeters_ushers        (per-bulletin)
--   tools_blocks           (TOOLs section blocks, ordered, JSONB-typed)
--   other_blocks           (Announcements & Other section blocks)
--   announcements          (short bullet announcements)
--
-- Row Level Security:
--   - Public (anon) can read published bulletins and submit prayer requests / check-ins.
--   - Authenticated staff can read/write everything.
--   - Only "pastor" role can update church_settings or staff_profiles.
-- =====================================================================

-- Helpful extensions
create extension if not exists "pgcrypto";

-- =====================================================================
-- Helper: updated_at trigger
-- =====================================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =====================================================================
-- staff_profiles
-- (Created BEFORE the is_staff / is_pastor helper functions that reference it,
--  because Postgres validates `language sql` function bodies at CREATE time.)
-- =====================================================================
create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('pastor', 'music_director', 'pianist', 'secretary', 'treasurer', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger staff_profiles_updated_at before update on public.staff_profiles
  for each row execute function set_updated_at();

alter table public.staff_profiles enable row level security;

-- =====================================================================
-- Helper: is_staff() — true if the authenticated user has a staff_profile
-- =====================================================================
create or replace function is_staff()
returns boolean as $$
  select exists (
    select 1 from public.staff_profiles where user_id = auth.uid()
  );
$$ language sql stable security definer;

-- =====================================================================
-- Helper: is_pastor() — true if the authenticated user has role = 'pastor'
-- =====================================================================
create or replace function is_pastor()
returns boolean as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = auth.uid() and role = 'pastor'
  );
$$ language sql stable security definer;

-- =====================================================================
-- staff_profiles policies (defined AFTER is_staff / is_pastor exist)
-- =====================================================================
create policy "Staff can read all staff_profiles"
  on public.staff_profiles for select
  using (is_staff());

create policy "Pastor can insert staff_profiles"
  on public.staff_profiles for insert
  with check (is_pastor());

create policy "Pastor can update staff_profiles"
  on public.staff_profiles for update
  using (is_pastor());

create policy "Pastor can delete staff_profiles"
  on public.staff_profiles for delete
  using (is_pastor());

-- =====================================================================
-- church_settings (singleton; row id is fixed at 1)
-- =====================================================================
create table public.church_settings (
  id integer primary key default 1 check (id = 1),
  church_name text not null default 'Wedowee First United Methodist Church',
  mission_statement text default 'Loving God, Serving Others, and Growing Disciples',
  street_address text default '116 W Broad Street',
  mailing_address text default 'PO Box 151',
  city text default 'Wedowee',
  state text default 'Alabama',
  zip text default '36278-0151',
  phone text default '256.357.2214',
  fax text default '256.568.8298',
  voice_text text default '(256) 357-2214',
  website text default 'wedoweefumc.org',
  office_email text default 'office@wedoweefumc.org',
  pastor_email text default 'todd.noren-hentz@umcna.org',
  finance_email text default 'finance@wedoweefumc.org',
  office_hours text default '9:00 AM - 4:00 PM Monday - Thursday',
  facebook_url text,
  youtube_channel_url text default 'https://www.youtube.com/@WedoweeFirst',
  youtube_livestream_url text,
  tithely_url text,
  -- License numbers
  ccli_streaming_license text default '20202755',
  ccli_copyright_license text default '11278729',
  onelicense_number text,
  -- Defaults
  default_scripture_translation text default 'NRSVUe',
  -- AI assist (encrypted at rest by Supabase; only readable server-side via Edge Function)
  anthropic_api_key text,
  -- Behavior toggles
  search_indexing_enabled boolean default false,
  bulletin_retention_weeks integer default 4,
  -- Welcome blurb (defaults to current paper version)
  welcome_blurb text default
    'Visitors, longtime congregants, and members, welcome! We are glad you are worshiping with us. Restrooms are through the door at the end of the sanctuary right. Services are livestreamed to our YouTube channel, @WedoweeFirst and to our Facebook page, wedoweefumc. When watching online, please let us know you are with us by commenting in the comments section. If you are with us in person, please let us know in the attendance pad located at one end of your pew.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger church_settings_updated_at before update on public.church_settings
  for each row execute function set_updated_at();

-- Insert the singleton row
insert into public.church_settings (id) values (1);

alter table public.church_settings enable row level security;

-- Anonymous users can read non-sensitive fields. Easiest: expose via a view later.
-- For now: only staff can read directly, and the worshipper UI reads via a public view.
create policy "Staff can read church_settings"
  on public.church_settings for select
  using (is_staff());

create policy "Pastor can update church_settings"
  on public.church_settings for update
  using (is_pastor());

-- Public view of church_settings excluding the API key
create or replace view public.church_settings_public as
  select
    id, church_name, mission_statement, street_address, mailing_address,
    city, state, zip, phone, website, office_email, pastor_email,
    office_hours, facebook_url, youtube_channel_url, youtube_livestream_url,
    tithely_url, ccli_streaming_license, ccli_copyright_license,
    onelicense_number, default_scripture_translation, search_indexing_enabled,
    bulletin_retention_weeks, welcome_blurb
  from public.church_settings;

grant select on public.church_settings_public to anon, authenticated;

-- =====================================================================
-- bulletins
-- =====================================================================
create table public.bulletins (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  service_time time default '10:00:00',
  sunday_designation text,
  cover_image_url text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  footer_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (service_date)
);

create index bulletins_status_idx on public.bulletins (status, service_date desc);

create trigger bulletins_updated_at before update on public.bulletins
  for each row execute function set_updated_at();

alter table public.bulletins enable row level security;

create policy "Anyone can read published bulletins"
  on public.bulletins for select
  using (status = 'published' or is_staff());

create policy "Staff can insert bulletins"
  on public.bulletins for insert
  with check (is_staff());

create policy "Staff can update bulletins"
  on public.bulletins for update
  using (is_staff());

create policy "Staff can delete bulletins"
  on public.bulletins for delete
  using (is_staff());

-- =====================================================================
-- bulletin_sections — ordered section blocks per bulletin
-- =====================================================================
create table public.bulletin_sections (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  section_type text not null check (section_type in (
    'cover', 'welcome_calendar', 'prayer_list', 'liturgy', 'stewardship',
    'community', 'announcements_other', 'footer'
  )),
  title_override text,
  position integer not null,
  is_visible boolean not null default true,
  unique (bulletin_id, position)
);

create index bulletin_sections_bulletin_idx on public.bulletin_sections (bulletin_id, position);

alter table public.bulletin_sections enable row level security;

create policy "Anyone can read sections of published bulletins"
  on public.bulletin_sections for select
  using (
    exists (
      select 1 from public.bulletins b
      where b.id = bulletin_sections.bulletin_id
        and (b.status = 'published' or is_staff())
    )
  );

create policy "Staff can write bulletin_sections"
  on public.bulletin_sections for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- liturgy_items — Order of Worship items
-- =====================================================================
create table public.liturgy_items (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  position integer not null,
  item_type text not null default 'generic' check (item_type in (
    'generic', 'hymn', 'music', 'scripture', 'prayer_text',
    'responsive_reading', 'communion', 'sermon', 'giving'
  )),
  title text not null,
  center_text text,
  right_text text,
  is_starred boolean not null default false,
  inline_body text,
  expanded_detail text,
  -- Hymn-specific fields
  hymn_title text,
  tune_name text,
  hymnal_source text check (hymnal_source in ('UMH', 'TFWS')),
  hymn_number text,
  hymn_bio text,
  -- Scripture-specific
  scripture_reference text,
  scripture_translation text,
  scripture_text text,
  -- Sermon-specific
  sermon_manuscript_url text,
  sermon_manuscript_text text,
  unique (bulletin_id, position)
);

create index liturgy_items_bulletin_idx on public.liturgy_items (bulletin_id, position);

alter table public.liturgy_items enable row level security;

create policy "Anyone can read liturgy of published bulletins"
  on public.liturgy_items for select
  using (
    exists (
      select 1 from public.bulletins b
      where b.id = liturgy_items.bulletin_id
        and (b.status = 'published' or is_staff())
    )
  );

create policy "Staff can write liturgy_items"
  on public.liturgy_items for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- prayer_categories
-- =====================================================================
create table public.prayer_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position integer not null default 0,
  is_active boolean not null default true
);

insert into public.prayer_categories (name, position) values
  ('For Healing and Strength', 1),
  ('For Missionaries and Ministries', 2),
  ('Thanksgivings', 3);

alter table public.prayer_categories enable row level security;

create policy "Anyone can read prayer_categories"
  on public.prayer_categories for select
  using (is_active or is_staff());

create policy "Staff can write prayer_categories"
  on public.prayer_categories for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- prayer_requests
-- =====================================================================
create table public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.prayer_categories(id) on delete set null,
  submitter_name text,
  is_anonymous boolean not null default false,
  request_text text not null,
  removal_mode text not null default 'auto_4weeks' check (removal_mode in (
    'auto_4weeks', 'custom_date', 'staff_discretion', 'until_contacted'
  )),
  remove_after_date date,
  is_active boolean not null default true,
  submitted_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null
);

create index prayer_requests_active_idx on public.prayer_requests (is_active, submitted_at desc);

alter table public.prayer_requests enable row level security;

-- Anyone (anon) can submit a prayer request
create policy "Anyone can submit prayer requests"
  on public.prayer_requests for insert
  with check (true);

-- Anyone can read active prayer requests; staff can see all
create policy "Anyone can read active prayer requests"
  on public.prayer_requests for select
  using (is_active or is_staff());

-- Only staff can update or delete (e.g., remove a request)
create policy "Staff can update prayer requests"
  on public.prayer_requests for update
  using (is_staff());

create policy "Staff can delete prayer requests"
  on public.prayer_requests for delete
  using (is_staff());

-- =====================================================================
-- check_ins
-- =====================================================================
create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid references public.bulletins(id) on delete set null,
  is_anonymous boolean not null default false,
  full_name text,
  email text,
  phone text,
  is_visitor boolean,
  submitted_at timestamptz not null default now()
);

create index check_ins_bulletin_idx on public.check_ins (bulletin_id, submitted_at desc);

alter table public.check_ins enable row level security;

create policy "Anyone can submit check-ins"
  on public.check_ins for insert
  with check (true);

create policy "Staff can read check-ins"
  on public.check_ins for select
  using (is_staff());

create policy "Staff can delete check-ins"
  on public.check_ins for delete
  using (is_staff());

-- =====================================================================
-- calendar_events
-- =====================================================================
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  event_time time,
  title text not null,
  location text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'google')),
  google_event_id text unique,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create index calendar_events_date_idx on public.calendar_events (event_date);

alter table public.calendar_events enable row level security;

create policy "Anyone can read published calendar events"
  on public.calendar_events for select
  using (is_published or is_staff());

create policy "Staff can write calendar_events"
  on public.calendar_events for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- weekly_schedule_items (Each Week recurring)
-- =====================================================================
create table public.weekly_schedule_items (
  id uuid primary key default gen_random_uuid(),
  day_of_week integer not null check (day_of_week between 0 and 6), -- 0 = Sunday
  start_time time,
  title text not null,
  location text,
  position integer not null default 0,
  is_active boolean not null default true
);

alter table public.weekly_schedule_items enable row level security;

create policy "Anyone can read weekly_schedule_items"
  on public.weekly_schedule_items for select
  using (is_active or is_staff());

create policy "Staff can write weekly_schedule_items"
  on public.weekly_schedule_items for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- birthdays
-- =====================================================================
create table public.birthdays (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  month integer not null check (month between 1 and 12),
  day integer not null check (day between 1 and 31)
);

create index birthdays_month_day_idx on public.birthdays (month, day);

alter table public.birthdays enable row level security;

create policy "Anyone can read birthdays"
  on public.birthdays for select
  using (true);

create policy "Staff can write birthdays"
  on public.birthdays for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- stewardship_funds — configurable list (Building, CA, Lighthouse, etc.)
-- =====================================================================
create table public.stewardship_funds (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'other' check (category in ('general', 'other')),
  position integer not null default 0,
  is_active boolean not null default true
);

insert into public.stewardship_funds (name, category, position) values
  ('General Fund', 'general', 1),
  ('Building', 'other', 2),
  ('CA', 'other', 3),
  ('Lighthouse', 'other', 4),
  ('Music', 'other', 5),
  ('Missions', 'other', 6),
  ('Mutual Aid', 'other', 7),
  ('SIFAT', 'other', 8),
  ('TOOLs', 'other', 9);

alter table public.stewardship_funds enable row level security;

create policy "Anyone can read stewardship_funds"
  on public.stewardship_funds for select
  using (is_active or is_staff());

create policy "Staff can write stewardship_funds"
  on public.stewardship_funds for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- stewardship_entries — per-bulletin per-fund $ values
-- =====================================================================
create table public.stewardship_entries (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  fund_id uuid not null references public.stewardship_funds(id) on delete cascade,
  period text not null check (period in ('mtd', 'ytd')),
  received numeric(12, 2),
  expenses numeric(12, 2),
  needed_to_meet_budget numeric(12, 2),
  paid numeric(12, 2),
  -- For non-General "other" funds, only `received` is typically used.
  unique (bulletin_id, fund_id, period)
);

alter table public.stewardship_entries enable row level security;

create policy "Anyone can read stewardship entries of published bulletins"
  on public.stewardship_entries for select
  using (
    exists (
      select 1 from public.bulletins b
      where b.id = stewardship_entries.bulletin_id
        and (b.status = 'published' or is_staff())
    )
  );

create policy "Staff can write stewardship_entries"
  on public.stewardship_entries for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- attendance_categories
-- =====================================================================
create table public.attendance_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position integer not null default 0,
  is_active boolean not null default true
);

insert into public.attendance_categories (name, position) values
  ('Worship', 1),
  ('Online', 2),
  ('Visitors (in-person)', 3),
  ('Visitors (online)', 4),
  ('Children''s School', 5),
  ('Pastor Todd''s Class', 6),
  ('Funky Faith Followers', 7),
  ('Women of Esther', 8),
  ('Mental Wellness', 9),
  ('SOS Bible Study', 10),
  ('TOOL''s', 11);

alter table public.attendance_categories enable row level security;

create policy "Anyone can read attendance_categories"
  on public.attendance_categories for select
  using (is_active or is_staff());

create policy "Staff can write attendance_categories"
  on public.attendance_categories for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- attendance_entries — per-bulletin per-category counts
-- =====================================================================
create table public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  category_id uuid not null references public.attendance_categories(id) on delete cascade,
  count_text text, -- text so that "X" / "—" can also be stored
  unique (bulletin_id, category_id)
);

alter table public.attendance_entries enable row level security;

create policy "Anyone can read attendance entries of published bulletins"
  on public.attendance_entries for select
  using (
    exists (
      select 1 from public.bulletins b
      where b.id = attendance_entries.bulletin_id
        and (b.status = 'published' or is_staff())
    )
  );

create policy "Staff can write attendance_entries"
  on public.attendance_entries for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- leading_worship_roles — default roster (e.g., Music Director: Kathy Murphy)
-- =====================================================================
create table public.leading_worship_roles (
  id uuid primary key default gen_random_uuid(),
  role_label text not null,           -- e.g., "Music Director"
  default_person text,                -- e.g., "Kathy Murphy"
  position integer not null default 0,
  is_active boolean not null default true
);

insert into public.leading_worship_roles (role_label, default_person, position) values
  ('Pastor', 'Todd Noren-Hentz', 1),
  ('Music Director', 'Kathy Murphy', 2),
  ('Pianist', 'Karen Culverhouse', 3),
  ('Acolyte', null, 4),
  ('Song Leader', 'Steve Murphy', 5);

alter table public.leading_worship_roles enable row level security;

create policy "Anyone can read leading_worship_roles"
  on public.leading_worship_roles for select
  using (is_active or is_staff());

create policy "Staff can write leading_worship_roles"
  on public.leading_worship_roles for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- leading_worship_assignments — per-week overrides
-- =====================================================================
create table public.leading_worship_assignments (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  role_id uuid not null references public.leading_worship_roles(id) on delete cascade,
  person_override text not null,
  unique (bulletin_id, role_id)
);

alter table public.leading_worship_assignments enable row level security;

create policy "Anyone can read leading_worship_assignments of published bulletins"
  on public.leading_worship_assignments for select
  using (
    exists (
      select 1 from public.bulletins b
      where b.id = leading_worship_assignments.bulletin_id
        and (b.status = 'published' or is_staff())
    )
  );

create policy "Staff can write leading_worship_assignments"
  on public.leading_worship_assignments for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- greeters_ushers — per-bulletin
-- =====================================================================
create table public.greeters_ushers (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  names_text text not null  -- freeform; e.g., "Wayne Turner, Joe Burns"
);

alter table public.greeters_ushers enable row level security;

create policy "Anyone can read greeters_ushers of published bulletins"
  on public.greeters_ushers for select
  using (
    exists (
      select 1 from public.bulletins b
      where b.id = greeters_ushers.bulletin_id
        and (b.status = 'published' or is_staff())
    )
  );

create policy "Staff can write greeters_ushers"
  on public.greeters_ushers for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- tools_blocks — flexible TOOLs section
-- =====================================================================
create table public.tools_blocks (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  position integer not null,
  block_type text not null check (block_type in ('result', 'quote', 'photo', 'table', 'note')),
  data jsonb not null default '{}'::jsonb,
  unique (bulletin_id, position)
);

alter table public.tools_blocks enable row level security;

create policy "Anyone can read tools_blocks of published bulletins"
  on public.tools_blocks for select
  using (
    exists (
      select 1 from public.bulletins b
      where b.id = tools_blocks.bulletin_id
        and (b.status = 'published' or is_staff())
    )
  );

create policy "Staff can write tools_blocks"
  on public.tools_blocks for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- other_blocks — Announcements & Other section
-- =====================================================================
create table public.other_blocks (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  position integer not null,
  block_type text not null check (block_type in ('heading_body', 'image_flyer', 'personal_note')),
  heading text,
  body text,
  image_url text,
  signature text,
  unique (bulletin_id, position)
);

alter table public.other_blocks enable row level security;

create policy "Anyone can read other_blocks of published bulletins"
  on public.other_blocks for select
  using (
    exists (
      select 1 from public.bulletins b
      where b.id = other_blocks.bulletin_id
        and (b.status = 'published' or is_staff())
    )
  );

create policy "Staff can write other_blocks"
  on public.other_blocks for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- announcements — short bullet announcements for the bulletin
-- =====================================================================
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  position integer not null,
  body text not null,
  unique (bulletin_id, position)
);

alter table public.announcements enable row level security;

create policy "Anyone can read announcements of published bulletins"
  on public.announcements for select
  using (
    exists (
      select 1 from public.bulletins b
      where b.id = announcements.bulletin_id
        and (b.status = 'published' or is_staff())
    )
  );

create policy "Staff can write announcements"
  on public.announcements for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- Storage bucket for cover images and other_block images
-- (Bucket creation must be done via the Supabase dashboard
--  or the storage API; the following is a hint for what to create.)
-- =====================================================================
-- In the Supabase Dashboard → Storage:
--   1. Create a public bucket named "bulletin-images".
--   2. Public read; authenticated insert/update/delete.

-- =====================================================================
-- End of initial schema
-- =====================================================================
