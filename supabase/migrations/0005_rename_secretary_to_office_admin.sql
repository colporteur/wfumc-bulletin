-- =====================================================================
-- Rename the 'secretary' role to 'office_admin'
--
-- Per Pastor Todd's preference. The role isn't referenced in any
-- client code (only the 'pastor' role gets special treatment via the
-- is_pastor() helper), so this is a straightforward constraint swap.
-- =====================================================================

-- 1. Migrate any existing rows over to the new name.
update public.staff_profiles
set role = 'office_admin'
where role = 'secretary';

-- 2. Replace the CHECK constraint that enumerates valid roles.
alter table public.staff_profiles
  drop constraint if exists staff_profiles_role_check;

alter table public.staff_profiles
  add constraint staff_profiles_role_check
  check (role in (
    'pastor',
    'music_director',
    'pianist',
    'office_admin',
    'treasurer',
    'staff'
  ));
