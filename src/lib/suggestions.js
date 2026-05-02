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

import { supabase, withTimeout, callClaude } from './supabase';

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

// =====================================================================
// Smart Add — Claude-assisted incorporation of a suggestion into an
// EXISTING liturgy_item (rather than creating a new one).
//
// Two modes:
//   * overwrite — Claude proposes new values for every editable field
//                 on the target item. Existing content is replaced.
//   * append    — Claude proposes additional text to append to the
//                 target item's inline_body (or expanded_detail if
//                 inline_body is already long). Other fields stay put.
//
// Returns a JSON object of { fieldName: value } keys appropriate to the
// item's type. The modal renders these in editable form fields so the
// pastor can tweak before committing. Then `applySmartEdit` writes the
// final values and links the suggestion → item.
// =====================================================================

// Editable fields per item type. Used to build the prompt schema and
// to filter Claude's response to known columns.
const EDITABLE_FIELDS = {
  // Common across all types
  _common: [
    'title',
    'center_text',
    'right_text',
    'is_starred',
    'inline_body',
    'expanded_detail',
  ],
  hymn: ['hymn_title', 'tune_name', 'hymnal_source', 'hymn_number', 'hymn_bio'],
  scripture: [
    'scripture_reference',
    'scripture_translation',
    'scripture_text',
  ],
  music: [],
  prayer_text: [],
  responsive_reading: [],
  communion: [],
  generic: [],
  giving: [],
  // sermon items have lazy-created sermons + their own sub-fields;
  // smart-add deliberately avoids them to not stomp on Sermon Archive flows.
  sermon: [],
};

export function fieldsForItemType(itemType) {
  const extra = EDITABLE_FIELDS[itemType] ?? [];
  return [...EDITABLE_FIELDS._common, ...extra];
}

// Pull the worship_plan for a service_date so we can give Claude the
// week's theme + scripture as context. Returns null if none exists.
async function loadWorshipPlanForDate(serviceDate) {
  if (!serviceDate) return null;
  try {
    const { data } = await withTimeout(
      supabase
        .from('worship_plans')
        .select('scripture_reference, theme, sermon_topic, lectionary_designation')
        .eq('service_date', serviceDate)
        .maybeSingle()
    );
    return data ?? null;
  } catch {
    return null;
  }
}

// Build a compact JSON snapshot of a liturgy item — only the fields
// we'd consider rewriting. Keeps the prompt small.
function snapshotItem(item) {
  const out = { item_type: item.item_type };
  for (const f of fieldsForItemType(item.item_type)) {
    if (item[f] !== undefined) out[f] = item[f];
  }
  return out;
}

// Ask Claude to fill in the right fields. Returns the parsed JSON
// (validated to only contain known fields).
export async function smartFillSuggestion({
  suggestion,
  targetItem,
  mode,
  serviceDate,
}) {
  if (!suggestion) throw new Error('suggestion required');
  if (!targetItem) throw new Error('targetItem required');
  if (!['overwrite', 'append'].includes(mode)) {
    throw new Error("mode must be 'overwrite' or 'append'");
  }

  const plan = await loadWorshipPlanForDate(serviceDate);
  const fields = fieldsForItemType(targetItem.item_type);
  const itemSnapshot = snapshotItem(targetItem);

  const suggestionPayload = {
    kind: suggestion.suggestion_kind,
    title: suggestion.title,
    body: suggestion.body || null,
    hymnal: suggestion.hymnal || null,
    hymn_number: suggestion.hymn_number || null,
  };

  const planContext = plan
    ? {
        liturgical_designation: plan.lectionary_designation || null,
        theme: plan.theme || null,
        scripture_reference: plan.scripture_reference || null,
        sermon_topic: plan.sermon_topic || null,
      }
    : null;

  const modeInstructions =
    mode === 'overwrite'
      ? `MODE: overwrite. Propose new values for any of the listed fields that you can fill confidently from the suggestion. Set a field to null if it shouldn't be set. Don't fabricate hymn numbers, tune names, or attribution you aren't sure about — leave those null and the pastor will fill in by hand. The pastor will see your proposals in editable form fields and can tweak before committing.`
      : `MODE: append. Keep existing field values as-is. Propose ONLY a string to append to the target item's inline_body (or to expanded_detail if inline_body already has substantial text). Return the FULL new value of inline_body (or expanded_detail) — i.e., existing content + a blank line + your addition. Other fields should be omitted from your response.`;

  const system = `You are helping a pastor prepare a Sunday bulletin for Wedowee First UMC. A worship-team member made a suggestion (a hymn pick, liturgy text, or special-music idea), and the pastor wants to incorporate it into an existing item in the order of worship.

You will be given:
- The suggestion (kind, title, body, optional hymnal info)
- The target liturgy item's current state (item_type and current field values)
- The week's worship-plan context (if available): theme, scripture, sermon topic, lectionary designation
- The mode: overwrite or append

${modeInstructions}

Return ONLY a JSON object — no markdown code fences, no commentary. The keys of the object must be a subset of these allowed fields for this item type:
${JSON.stringify(fields, null, 2)}

Field types and rules:
- "title" (string): the visible title shown in the bulletin
- "center_text" (string|null): centered subtitle (e.g. "UMH 302" under a hymn title)
- "right_text" (string|null): right-aligned text (e.g. tune name)
- "is_starred" (boolean): true if this is a "stand if able" item
- "inline_body" (string|null): visible body text shown directly under the title
- "expanded_detail" (string|null): body shown when worshipper expands the item
${
  targetItem.item_type === 'hymn'
    ? `- "hymn_title" (string|null), "tune_name" (string|null), "hymn_bio" (string|null)
- "hymnal_source" (string|null): MUST be exactly "UMH" or "TFWS" — leave null if neither applies
- "hymn_number" (string|null): just the number as a string`
    : ''
}${
    targetItem.item_type === 'scripture'
      ? `- "scripture_reference" (string|null): e.g. "John 3:1-21"
- "scripture_translation" (string|null): e.g. "NRSVUe"
- "scripture_text" (string|null): the full passage text, with each verse prefixed [N]`
      : ''
  }`;

  const userText = `SUGGESTION:
${JSON.stringify(suggestionPayload, null, 2)}

TARGET LITURGY ITEM (current state):
${JSON.stringify(itemSnapshot, null, 2)}

${planContext ? `WORSHIP PLAN CONTEXT:\n${JSON.stringify(planContext, null, 2)}\n` : 'WORSHIP PLAN CONTEXT: (none)\n'}

Return the JSON now.`;

  const result = await callClaude({
    system,
    messages: [{ role: 'user', content: userText }],
    max_tokens: 1500,
  });

  const text = result?.content?.[0]?.text?.trim();
  if (!text) throw new Error('Claude returned an empty response.');

  let parsed;
  try {
    // Strip stray code fences just in case
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Couldn't parse Claude's response as JSON. Raw: ${text.slice(0, 200)}`
    );
  }

  // Filter to known fields only.
  const allowed = new Set(fields);
  const filtered = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (allowed.has(k)) filtered[k] = v;
  }
  // Hymnal_source must be UMH or TFWS or null — coerce.
  if (
    'hymnal_source' in filtered &&
    filtered.hymnal_source !== null &&
    !['UMH', 'TFWS'].includes(String(filtered.hymnal_source).toUpperCase())
  ) {
    filtered.hymnal_source = null;
  } else if ('hymnal_source' in filtered && filtered.hymnal_source) {
    filtered.hymnal_source = String(filtered.hymnal_source).toUpperCase();
  }

  return filtered;
}

// Apply the user-confirmed edits to the target liturgy_item, and link
// the suggestion to that item so the worship app's /suggestions page
// shows it as added.
export async function applySmartEdit({
  suggestionId,
  bulletinId,
  itemId,
  fields,
}) {
  if (!itemId) throw new Error('itemId required');
  if (!fields || Object.keys(fields).length === 0) {
    throw new Error('No fields to update.');
  }
  const { error: updErr } = await withTimeout(
    supabase.from('liturgy_items').update(fields).eq('id', itemId)
  );
  if (updErr) throw updErr;

  if (suggestionId) {
    const { error: linkErr } = await withTimeout(
      supabase
        .from('element_suggestions')
        .update({
          added_to_bulletin_id: bulletinId,
          added_to_liturgy_item_id: itemId,
          added_at: new Date().toISOString(),
          status: 'accepted',
        })
        .eq('id', suggestionId)
    );
    if (linkErr) throw linkErr;
  }
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
