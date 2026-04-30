-- =====================================================================
-- Parishioner-matching triggers for prayer_requests and check_ins
--
-- When a worshipper submits with a name, we want to silently link the
-- submission to an existing parishioners row IF an exact (case-
-- insensitive) match exists. Worshippers can't see the parishioners
-- table (it's staff-only RLS), so this matching has to happen in the
-- database via a SECURITY DEFINER function that runs with elevated
-- privileges.
--
-- No match → parishioner_id stays null → the submission shows up in
-- Pastor Todd's future "match queue" UI for manual reconciliation.
--
-- Anonymous submissions skip matching entirely.
-- =====================================================================

-- Helper: try to find a parishioner by case-insensitive full_name.
create or replace function public.try_match_parishioner(name text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.parishioners
  where lower(full_name) = lower(name)
  limit 1;
$$;

-- Trigger function for prayer_requests
create or replace function public.prayer_request_match_parishioner()
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

drop trigger if exists prayer_requests_match_parishioner on public.prayer_requests;
create trigger prayer_requests_match_parishioner
  before insert on public.prayer_requests
  for each row execute function public.prayer_request_match_parishioner();

-- Trigger function for check_ins
create or replace function public.check_in_match_parishioner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parishioner_id is null
     and new.full_name is not null
     and new.is_anonymous is not true
  then
    new.parishioner_id := public.try_match_parishioner(new.full_name);
  end if;
  return new;
end;
$$;

drop trigger if exists check_ins_match_parishioner on public.check_ins;
create trigger check_ins_match_parishioner
  before insert on public.check_ins
  for each row execute function public.check_in_match_parishioner();
