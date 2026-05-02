// Claude-powered refinement for the LiturgySection import flows.
//
// The heuristic parsers do a fine job detecting WHICH liturgy_item each
// section/row maps to. Where they fall short is splitting one piece of
// text into the right SUB-FIELDS of that item: the bulletin row has a
// title, a center column, a right column, a "stand if able" star, an
// inline body, and an expanded detail. For hymns there are also
// hymnal_source / hymn_number / hymn_title / tune_name / hymn_bio. For
// scripture there's reference / translation / text. Etc.
//
// This module takes the heuristic-matched rows and asks Claude to
// distribute the source text across those fields in one batched call.
// Result is a per-row "field plan" the UI shows in the preview and
// then writes verbatim on Apply.

import { callClaude } from './supabase';

// JSON schema we ask Claude to return per row, documented in the prompt.
// The shape is intentionally a flat object so the UI can spread it
// straight into a Supabase update.
const FIELDS_BY_TYPE = {
  generic: ['title', 'center_text', 'right_text', 'is_starred', 'inline_body', 'expanded_detail'],
  hymn: [
    'title', 'center_text', 'right_text', 'is_starred',
    'inline_body', 'expanded_detail',
    'hymnal_source', 'hymn_number', 'hymn_title', 'tune_name', 'hymn_bio',
  ],
  music: ['title', 'center_text', 'right_text', 'is_starred', 'inline_body', 'expanded_detail'],
  scripture: [
    'title', 'center_text', 'right_text', 'is_starred',
    'inline_body', 'expanded_detail',
    'scripture_reference', 'scripture_translation', 'scripture_text',
  ],
  prayer_text: ['title', 'center_text', 'right_text', 'is_starred', 'inline_body', 'expanded_detail'],
  responsive_reading: ['title', 'center_text', 'right_text', 'is_starred', 'inline_body', 'expanded_detail'],
  communion: ['title', 'center_text', 'right_text', 'is_starred', 'inline_body', 'expanded_detail'],
  sermon: ['title', 'center_text', 'right_text', 'is_starred', 'inline_body', 'expanded_detail'],
  giving: ['title', 'center_text', 'right_text', 'is_starred', 'inline_body', 'expanded_detail'],
};

const COMMON_GUIDANCE = [
  'You distribute parsed text into structured fields on a UMC bulletin row.',
  '',
  'Field meanings:',
  '  title           — the printed item title (e.g., "Hymn of Praise", "Pastoral Prayer")',
  '  center_text     — middle column. For hymns: the hymn title in quotes.',
  '                    For anthems/music: the piece title. For scripture:',
  '                    the reference (e.g., "Acts 7:55-60").',
  '  right_text      — right column. For hymns: "UMH #545" or "TFWS #2127".',
  '                    For music: the performer ("Chancel Choir", "April',
  '                    Huddleston, Soprano"). For scripture: the translation.',
  '  is_starred      — boolean. True if this is a "stand if able" item',
  '                    (most hymns, affirmations of faith, and the gospel',
  '                    reading). False otherwise.',
  '  inline_body     — short text shown beneath the title in the bulletin.',
  '                    For music: brief composer/arranger ("Arr. by Alan Lohr").',
  '                    Usually empty for prayers (the body goes in expanded_detail).',
  '  expanded_detail — long text shown when worshipper expands the row:',
  '                    full prayer text, hymn bio, scripture text, etc.',
  '',
  'Hymn-specific fields (only set when the item is a hymn):',
  '  hymnal_source   — "UMH" or "TFWS"',
  '  hymn_number     — string, e.g. "545"',
  '  hymn_title      — title of the hymn',
  '  tune_name       — TUNE name (usually all-caps in source docs)',
  '  hymn_bio        — biographical / commentary about the hymn',
  '',
  'Scripture-specific fields:',
  '  scripture_reference  — e.g. "Acts 7:55-60"',
  '  scripture_translation — e.g. "NRSV"',
  '  scripture_text       — the verse text',
  '',
  'Rules:',
  '  - Set a field only when you have content for it. Use null otherwise.',
  '  - DON\'T duplicate data across fields. If you put the title in',
  '    center_text, leave inline_body null.',
  '  - Be conservative with is_starred: only set true when the source clearly',
  '    indicates standing OR for items that are conventionally stood for',
  '    (most hymns, gospel reading, affirmation of faith).',
  '  - Keep title close to the existing bulletin item title unless the',
  '    source clearly suggests a more specific title.',
];

function extractText(response) {
  const block = response?.content?.find((c) => c.type === 'text');
  return block?.text ?? '';
}

function parseJsonArrayLoose(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Limit the field set on returned plans to legal columns for that item
// type. Belt + suspenders against Claude inventing field names.
function sanitizePlan(plan, itemType) {
  if (!plan || typeof plan !== 'object') return null;
  const allowed = new Set(FIELDS_BY_TYPE[itemType] ?? FIELDS_BY_TYPE.generic);
  const out = { idx: typeof plan.idx === 'number' ? plan.idx : null };
  for (const key of allowed) {
    if (key in plan) {
      const v = plan[key];
      // Treat empty strings + the literal "null" as null.
      if (v == null || (typeof v === 'string' && !v.trim())) {
        out[key] = null;
      } else if (key === 'is_starred') {
        out[key] = v === true || v === 'true';
      } else if (typeof v === 'string') {
        out[key] = v.trim();
      } else {
        out[key] = v;
      }
    }
  }
  return out;
}

/**
 * Refine LITURGY import sections. Each input row is:
 *   { idx: number, heading: string, body: string,
 *     item: { id, title, item_type } }   ← already-matched bulletin item
 *
 * Returns: Array of plans keyed by idx (same shape as FIELDS_BY_TYPE
 * for that item's type).
 */
export async function refineLiturgyRows(rows) {
  if (!rows?.length) return [];
  const system = [
    ...COMMON_GUIDANCE,
    '',
    'Input is a list of LITURGY sections — heading + body — with the',
    "matched bulletin item's current title and type.",
    '',
    'For each section, return one JSON object with ALL the fields you want',
    'to set on its item. Always include "idx".',
    '',
    'Return ONLY a JSON array of these objects. No prose, no commentary.',
  ].join('\n');

  const lines = rows.map((r) => [
    `--- idx=${r.idx} ---`,
    `Bulletin item: type=${r.item.item_type} title=${JSON.stringify(r.item.title)}`,
    `Heading from doc: ${r.heading}`,
    `Body:`,
    r.body || '(empty)',
  ].join('\n'));
  const userMessage = `Sections:\n\n${lines.join('\n\n')}`;

  const response = await callClaude(
    {
      system,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 3000,
    },
    { timeoutMs: 120000 }
  );
  const text = extractText(response);
  const parsed = parseJsonArrayLoose(text);
  if (!Array.isArray(parsed)) {
    throw new Error("Couldn't parse Claude's response as a JSON array.");
  }
  // Map back to source rows (preserves idx).
  const out = [];
  for (const plan of parsed) {
    const src = rows.find((r) => r.idx === plan.idx);
    if (!src) continue;
    const sanitized = sanitizePlan(plan, src.item.item_type);
    if (sanitized) out.push(sanitized);
  }
  return out;
}

/**
 * Refine MUSIC import rows. Music rows have one of three kinds:
 *   - music_item   { idx, label, body, item }
 *   - hymn         { idx, hymnal_source, hymn_number, hymn_title, tune_name, item }
 *   - hymn_bio     { idx, hymn_title, body, item }
 *
 * Hymn rows are already fully structured by the parser — Claude only
 * polishes title casing if needed. Music items + bios benefit from the
 * field-distribution treatment.
 */
export async function refineMusicRows(rows) {
  if (!rows?.length) return [];
  const system = [
    ...COMMON_GUIDANCE,
    '',
    'Input is a list of MUSIC rows. Each row has a "kind":',
    '  music_item — single line like "Prelude: Jesus Paid It All – Arr. by Alan Lohr".',
    "                Distribute into title (e.g., 'Prelude'), center_text",
    '                (the piece title), right_text (the performer if any),',
    '                inline_body (composer/arranger info if room).',
    '  hymn       — already structured. Set hymn_* fields verbatim. Also set',
    '                center_text to the hymn title and right_text to',
    "                'UMH #545' style. Set is_starred=true (most hymns are).",
    "                title should match the existing bulletin item's title.",
    '  hymn_bio   — biographical paragraphs about a hymn. Put the FULL bio',
    '                in expanded_detail; leave most other fields null.',
    "                Optionally set hymn_bio to the same content too.",
    '',
    'For each row, return one JSON object including "idx".',
    '',
    'Return ONLY a JSON array. No prose.',
  ].join('\n');

  const lines = rows.map((r) => {
    const parts = [
      `--- idx=${r.idx} kind=${r.kind} ---`,
      `Bulletin item: type=${r.item.item_type} title=${JSON.stringify(r.item.title)}`,
    ];
    if (r.kind === 'music_item') {
      parts.push(`Label: ${r.label}`);
      parts.push(`Body: ${r.body}`);
    } else if (r.kind === 'hymn') {
      parts.push(
        `Hymn: ${r.hymnal_source} #${r.hymn_number} — ${r.hymn_title}` +
          (r.tune_name ? ` (${r.tune_name})` : '')
      );
    } else if (r.kind === 'hymn_bio') {
      parts.push(`Hymn: ${r.hymn_title}`);
      parts.push(`Body:`);
      parts.push(r.body || '(empty)');
    }
    return parts.join('\n');
  });
  const userMessage = `Rows:\n\n${lines.join('\n\n')}`;

  const response = await callClaude(
    {
      system,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 3000,
    },
    { timeoutMs: 120000 }
  );
  const text = extractText(response);
  const parsed = parseJsonArrayLoose(text);
  if (!Array.isArray(parsed)) {
    throw new Error("Couldn't parse Claude's response as a JSON array.");
  }
  const out = [];
  for (const plan of parsed) {
    const src = rows.find((r) => r.idx === plan.idx);
    if (!src) continue;
    const sanitized = sanitizePlan(plan, src.item.item_type);
    if (sanitized) out.push(sanitized);
  }
  return out;
}
