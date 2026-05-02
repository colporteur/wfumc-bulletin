// Element suggestions helper for the bulletin app — Phase 4.
//
// Suggestions are AUTHORED in the worship app (worship team / music
// director / admin from there). The bulletin app reads them, lets
// pastor accept/decline, and turns accepted ones into liturgy_items.
//
// Mapping suggestion_kind → liturgy_item.item_type:
//   hymn          → hymn          (hymnal_source + hymn_number filled)
//   liturgy       → prayer_text   (most flexible; body → inline_body)
//   special_music → music         (body → inline_body for instructions)
//   other         → generic       (body → inline_body)
//
// After an add-to-liturgy, we record both the bulletin and the new
// liturgy_item id on the suggestion so the worship app's /suggestions
// page reflects "used in bulletin for <date>" and we don't accidentally
// add the same suggestion twice.

import { supabase, withTimeout } from './supabase';

export const SUGGESTION_KIND_LABELS = {
  hymn: 'Hymn',
  liturgy: 'Liturgy',
  special_music: 'Special Music',
  other: 'Other',
};

export const SUGGESTION_STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  archived: 'Archived',
};

// Pull suggestions relevant to a specific bulletin. Returns an array of
// suggestion rows with status pending or accepted, sorted with pending
// first then most recently created. Filters:
//   * service_date == bulletin's date OR service_date IS NULL (any-date)
//   * status in ('pending', 'accepted')   — declined/archived hidden
//   * NOT already added to ANY bulletin (added_to_bulletin_id IS NULL)
export async function loadSuggestionsForBulletin(serviceDate) {
  // Two queries (date-specific + any-date). Could be one OR clause but
  // PostgREST .or() with .is.null is fiddlier; two small queries is
  // clearer and the result sets are tiny.
  const [dateRes, anyRes] = await Promise.all([
    withTimeout(
      supabase
        .from('element_suggestions')
        .select('*')
        .eq('service_date', serviceDate)
        .in('status', ['pending', 'accepted'])
        .is('added_to_bulletin_id', null)
    ),
    withTimeout(
      supabase
        .from('element_suggestions')
        .select('*')
        .is('service_date', null)
        .in('status', ['pending', 'accepted'])
        .is('added_to_bulletin_id', null)
    ),
  ]);
  if (dateRes.error) throw dateRes.error;
  if (anyRes.error) throw anyRes.error;

  const merged = [...(dateRes.data ?? []), ...(anyRes.data ?? [])];
  // Sort: pending first, then by created_at desc within each group
  merged.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
  return merged;
}

// Pull suggestions that already landed in this bulletin (so the panel
// can show what's already been incorporated, with a link to the item).
export async function loadAddedSuggestionsForBulletin(bulletinId) {
  const { data, error } = await withTimeout(
    supabase
      .from('element_suggestions')
      .select('*')
      .eq('added_to_bulletin_id', bulletinId)
      .order('added_at', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

export async function reviewSuggestion(id, { status, reviewedBy, notes }) {
  if (!['accepted', 'declined', 'archived', 'pending'].includes(status)) {
    throw new Error('Invalid suggestion status.');
  }
  const payload = {
    status,
    reviewed_by: reviewedBy ?? null,
    reviewed_at: status === 'pending' ? null : new Date().toISOString(),
    review_notes: notes?.trim() || null,
  };
  const { data, error } = await withTimeout(
    supabase
      .from('element_suggestions')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

// Map a suggestion kind into a liturgy_item row payload (without
// bulletin_id or position — caller fills those in).
function suggestionToLiturgyItem(suggestion) {
  const base = {
    is_starred: false,
    inline_body: suggestion.body || null,
  };
  switch (suggestion.suggestion_kind) {
    case 'hymn': {
      // hymnal_source has a strict check constraint — only UMH or TFWS.
      // Coerce: if the suggestion's hymnal matches, use it; otherwise
      // leave null and put the value in title for visibility.
      const validHymnal =
        suggestion.hymnal &&
        ['UMH', 'TFWS'].includes(suggestion.hymnal.toUpperCase())
          ? suggestion.hymnal.toUpperCase()
          : null;
      const titleParts = [suggestion.title];
      if (suggestion.hymnal && !validHymnal) {
        // Stash the unknown hymnal in the title so it's not lost.
        titleParts.push(`(${suggestion.hymnal})`);
      }
      return {
        ...base,
        item_type: 'hymn',
        title: titleParts.join(' '),
        hymn_title: suggestion.title,
        hymnal_source: validHymnal,
        hymn_number: suggestion.hymn_number || null,
      };
    }
    case 'special_music':
      return {
        ...base,
        item_type: 'music',
        title: suggestion.title,
      };
    case 'liturgy':
      return {
        ...base,
        item_type: 'prayer_text',
        title: suggestion.title,
      };
    case 'other':
    default:
      return {
        ...base,
        item_type: 'generic',
        title: suggestion.title,
      };
  }
}

// Add the accepted suggestion to the bulletin's order of worship as a
// new liturgy_item appended at the end. Records the link on the
// suggestion. Returns the new liturgy_item.
export async function addSuggestionToBulletin(suggestion, bulletinId) {
  // Compute next position
  const { data: existing, error: posErr } = await withTimeout(
    supabase
      .from('liturgy_items')
      .select('position')
      .eq('bulletin_id', bulletinId)
      .order('position', { ascending: false })
      .limit(1)
  );
  if (posErr) throw posErr;
  const nextPos =
    existing && existing.length > 0 ? (existing[0].position ?? 0) + 1 : 1;

  const itemPayload = {
    bulletin_id: bulletinId,
    position: nextPos,
    ...suggestionToLiturgyItem(suggestion),
  };

  const { data: newItem, error: insErr } = await withTimeout(
    supabase
      .from('liturgy_items')
      .insert(itemPayload)
      .select()
      .single()
  );
  if (insErr) throw insErr;

  // Link the suggestion to the new item.
  const { error: linkErr } = await withTimeout(
    supabase
      .from('element_suggestions')
      .update({
        added_to_bulletin_id: bulletinId,
        added_to_liturgy_item_id: newItem.id,
        added_at: new Date().toISOString(),
        // If the suggestion was still 'pending', mark it accepted now —
        // adding to a bulletin is an implicit acceptance.
        status: suggestion.status === 'pending' ? 'accepted' : suggestion.status,
      })
      .eq('id', suggestion.id)
  );
  if (linkErr) throw linkErr;

  return newItem;
}

// Quick count of pending suggestions across all dates — for a future
// nav-bar badge if we want one. Returns 0 on error so the nav doesn't
// blow up if the table doesn't exist.
export async function countPendingSuggestions() {
  try {
    const { count, error } = await withTimeout(
      supabase
        .from('element_suggestions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
    );
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
