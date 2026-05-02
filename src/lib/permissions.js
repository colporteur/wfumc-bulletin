// Role-based permission helpers for the Bulletin admin.
//
// Permissions are UI-level only. Database RLS still allows any
// staff_profiles row to read/write the bulletin tables — these
// helpers simply hide pages and sections from people who shouldn't
// be working in them. For a small trusted church team this trades
// strict enforcement for simpler RLS and easier collaboration.
//
// Roles (from the staff_profiles.role column):
//   pastor          full access
//   office_admin    full access (right hand to the pastor)
//   music_director  bulletin admin → Order of Worship section only
//   treasurer       bulletin admin → Stewardship section only
//   social_media    Social Media app only — no bulletin admin
//   pianist / staff catch-all; treated as office_admin-lite (full bulletin
//                   admin for now, no special restrictions).

export const ROLE_LABELS = {
  pastor: 'Pastor',
  office_admin: 'Office Admin',
  music_director: 'Music Director',
  treasurer: 'Treasurer',
  social_media: 'Social Media Team',
  pianist: 'Pianist',
  staff: 'Staff',
};

// Sections of the bulletin admin a given role can see/edit.
// Section keys must match BulletinEdit.jsx's SECTIONS array.
const SECTIONS_BY_ROLE = {
  pastor: 'all',
  office_admin: 'all',
  pianist: 'all',
  staff: 'all',
  music_director: ['liturgy'],
  treasurer: ['stewardship'],
  social_media: [], // no bulletin-admin sections
};

export function canSeeBulletinAdmin(role) {
  if (!role) return false;
  if (role === 'social_media') return false;
  return true;
}

export function canSeeBulletinSection(role, sectionKey) {
  if (!role) return false;
  const allowed = SECTIONS_BY_ROLE[role];
  if (!allowed) return false;
  if (allowed === 'all') return true;
  return allowed.includes(sectionKey);
}

export function canManageUsers(role) {
  return role === 'pastor';
}

export function canEditChurchSettings(role) {
  return role === 'pastor';
}

export function canEditParishioners(role) {
  // Pastor + office admin + music director (for parish list at hymns).
  return role === 'pastor' || role === 'office_admin';
}

export function rolesForUserManagement() {
  return [
    'pastor',
    'office_admin',
    'music_director',
    'treasurer',
    'social_media',
    'pianist',
    'staff',
  ];
}
