-- =====================================================================
-- Add 'social_media' to allowed staff roles
--
-- Pastor Todd is bringing on a small team to manage WFUMC's social
-- media. They need staff profiles so the apps recognize them, but
-- their role is narrower than office_admin — they only need access
-- to the WFUMC Social app, not the bulletin admin or anything else.
--
-- The other roles in the existing constraint (pastor, music_director,
-- pianist, office_admin, treasurer, staff) are unchanged. The role
-- column drives UI-level gating in each app — see src/lib/permissions.js.
-- =====================================================================

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
    'social_media',
    'staff'
  ));
