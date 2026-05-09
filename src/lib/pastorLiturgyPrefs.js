// Per-user "Pastor's Liturgy Sheet" print preferences.
//
// Backed by the pastor_liturgy_print_preferences table. One row per
// user, upserted via owner_user_id.

import { supabase, withTimeout } from './supabase';

// Defaults that match the column defaults in migration 0045 — used as
// the fallback when no row exists yet for a user.
export const PASTOR_LITURGY_PREFS_DEFAULTS = {
  font_family: 'Cambria',
  font_size_pt: 12,
  line_spacing: 1.15,
  margin_top_in: 0.75,
  margin_bottom_in: 0.75,
  margin_left_in: 0.75,
  margin_right_in: 0.75,
  page_number_position: 'bottom_right',
  header_content: '{church} — {sunday} {date}',
  footer_content: '',
};

const FONT_OPTIONS = [
  'Cambria',
  'Calibri',
  'Times New Roman',
  'Georgia',
  'Garamond',
  'Arial',
  'Helvetica',
  'Verdana',
  'Albertus Medium',
];

export const PASTOR_LITURGY_FONT_OPTIONS = FONT_OPTIONS;

const PAGE_NUMBER_POSITIONS = [
  { value: 'none', label: 'None' },
  { value: 'top_left', label: 'Top left' },
  { value: 'top_center', label: 'Top center' },
  { value: 'top_right', label: 'Top right' },
  { value: 'bottom_left', label: 'Bottom left' },
  { value: 'bottom_center', label: 'Bottom center' },
  { value: 'bottom_right', label: 'Bottom right' },
];

export const PASTOR_LITURGY_PAGE_NUMBER_POSITIONS = PAGE_NUMBER_POSITIONS;

export async function loadPastorLiturgyPrefs(userId) {
  if (!userId) return { ...PASTOR_LITURGY_PREFS_DEFAULTS };
  const { data, error } = await withTimeout(
    supabase
      .from('pastor_liturgy_print_preferences')
      .select('*')
      .eq('owner_user_id', userId)
      .maybeSingle()
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('loadPastorLiturgyPrefs:', error.message);
    return { ...PASTOR_LITURGY_PREFS_DEFAULTS };
  }
  return data ? { ...PASTOR_LITURGY_PREFS_DEFAULTS, ...data } : { ...PASTOR_LITURGY_PREFS_DEFAULTS };
}

export async function upsertPastorLiturgyPrefs(userId, patch) {
  if (!userId) throw new Error('No user.');
  const payload = {
    owner_user_id: userId,
    ...patch,
  };
  const { data, error } = await withTimeout(
    supabase
      .from('pastor_liturgy_print_preferences')
      .upsert(payload, { onConflict: 'owner_user_id' })
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

// Resolve {token} substitutions in header/footer text against a small
// context map. Unknown tokens are left as-is so the pastor sees them
// in the output rather than being silently dropped.
export function applyTokens(text, ctx) {
  if (!text) return '';
  return text.replace(/\{(\w+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) {
      return ctx[key] ?? '';
    }
    return m;
  });
}
