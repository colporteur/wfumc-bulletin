// Parses a Pastor's liturgy .docx into sections (heading + body) and
// suggests how each section maps to a liturgy_item already in the
// bulletin's order-of-worship.
//
// Pastor Todd's typical doc structure:
//   - First couple of lines are the title / scripture / Sunday name
//   - Section headings like "Call to Worship", "Congregational Prayer",
//     "Children's Sermon", "Benediction" — bare paragraphs, NO bold
//     markup, sandwiched between body content
//   - Body content under each heading until the next heading
//
// We can't rely on paragraph styles (the doc doesn't use them), so we
// detect headings via a known-headings list (with aliases) and a
// fallback heuristic for unknown short standalone lines.

import mammoth from 'mammoth';

// Known section headings the parser will recognize. Each entry maps
// one or more incoming heading variants to a canonical "match key" we
// use to score matches against actual bulletin liturgy_items.
//
// The match key is what we compare bulletin item titles against —
// normalized (lowercase, no punctuation, "the"/"a" stripped).
//
// Aliases handle the cases the pastor mentioned (e.g., he uses
// "Congregational Prayer" interchangeably with "Pastoral Prayer").
const KNOWN_HEADINGS = [
  // [variants...] → canonical match key
  { variants: ['call to worship'], match: 'call to worship' },
  { variants: ['greeting', 'welcome and greeting'], match: 'greeting' },
  { variants: ['welcome', 'welcome and announcements'], match: 'welcome' },
  { variants: ['announcements'], match: 'announcements' },
  {
    variants: [
      'opening hymn',
      'hymn of praise',
      'processional hymn',
      'gathering hymn',
    ],
    match: 'opening hymn',
  },
  {
    variants: ['affirmation of faith', "apostles' creed", 'nicene creed'],
    match: 'affirmation of faith',
  },
  { variants: ['gloria patri'], match: 'gloria patri' },
  { variants: ['doxology'], match: 'doxology' },
  {
    variants: [
      'pastoral prayer',
      'congregational prayer',
      'prayer of the people',
      'prayers of the people',
      'morning prayer',
    ],
    match: 'pastoral prayer',
  },
  { variants: ["the lord's prayer", 'lord prayer'], match: "lord's prayer" },
  {
    variants: ['anthem', 'choir anthem', 'special music', 'musical offering'],
    match: 'anthem',
  },
  {
    variants: [
      "children's time",
      "children's sermon",
      "children's moment",
      'time with the children',
      'time with our children',
    ],
    match: "children's time",
  },
  {
    variants: [
      'scripture reading',
      'scripture',
      'first reading',
      'gospel reading',
      'epistle reading',
      'old testament reading',
      'new testament reading',
    ],
    match: 'scripture reading',
  },
  {
    variants: ['hymn of preparation', 'hymn before sermon'],
    match: 'hymn of preparation',
  },
  { variants: ['sermon', 'message'], match: 'sermon' },
  {
    variants: [
      'hymn of response',
      'hymn of invitation',
      'invitation hymn',
      'closing hymn',
      'hymn of dedication',
    ],
    match: 'hymn of response',
  },
  { variants: ['invitation', 'altar call'], match: 'invitation' },
  {
    variants: [
      'giving statement',
      'offertory',
      'offering',
      'stewardship reflection',
      'stewardship moment',
      'invitation to the offering',
    ],
    match: 'offering',
  },
  {
    variants: [
      'communion',
      "the lord's supper",
      'eucharist',
      'great thanksgiving',
    ],
    match: 'communion',
  },
  {
    variants: ['confession', 'prayer of confession', 'confession and pardon'],
    match: 'confession',
  },
  {
    variants: ['passing of the peace', 'sharing of the peace', 'the peace'],
    match: 'passing of the peace',
  },
  { variants: ['prelude'], match: 'prelude' },
  { variants: ['postlude'], match: 'postlude' },
  { variants: ['introit'], match: 'introit' },
  { variants: ['lighting of candles', 'lighting of the candles'], match: 'lighting of candles' },
  {
    variants: ['benediction', 'closing prayer', 'commissioning', 'sending forth'],
    match: 'benediction',
  },
];

// Build a flat lookup: normalized variant → match key.
const HEADING_LOOKUP = (() => {
  const m = new Map();
  for (const h of KNOWN_HEADINGS) {
    for (const v of h.variants) {
      m.set(normalize(v), h.match);
    }
  }
  return m;
})();

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’]/g, "'") // smart quotes → straight
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-') // en/em dash → hyphen
    .replace(/[^\w\s']/g, ' ')        // strip remaining punctuation
    .replace(/\b(the|a|an|of|to)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Heuristic: is this paragraph likely a heading (not body text)?
// Used only when the line ISN'T in our known list — a defensive net
// for non-standard headings the pastor occasionally uses.
function looksLikeHeading(text) {
  const t = text.trim();
  if (!t) return false;
  if (t.length > 60) return false;
  if (/[.!?…]\s*$/.test(t)) return false;   // body lines usually end with terminal punctuation
  if (/^[—–"'~(]/.test(t)) return false;     // body openers
  if (/^\s*[-•]/.test(t)) return false;      // bullets
  // Title-case-ish: at least one capital letter, mostly letters/spaces
  if (!/[A-Z]/.test(t)) return false;
  if (/\d/.test(t) && t.length > 30) return false; // probably a verse line
  return true;
}

function isKnownHeading(text) {
  return HEADING_LOOKUP.has(normalize(text));
}

/**
 * Parse a .docx file (Blob/File/ArrayBuffer) into:
 *   {
 *     fullText: string,                   // plain text of the whole doc
 *     sections: [
 *       { heading: string,                // exact heading from the doc
 *         matchKey: string|null,          // canonical lookup key (or null if heuristic-only)
 *         body: string }                  // joined body paragraphs
 *     ],
 *   }
 */
export async function parseLiturgyDocx(file) {
  const buf =
    file instanceof ArrayBuffer
      ? file
      : await (file.arrayBuffer ? file.arrayBuffer() : file);
  // mammoth gives us paragraphs as text with newlines; we re-split.
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  const fullText = (result?.value ?? '').trim();
  const lines = fullText.split('\n').map((s) => s.replace(/\s+$/, ''));

  const sections = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      // Blank line → preserve as paragraph break inside body, ignore at top.
      if (current && current.bodyLines.length > 0) {
        current.bodyLines.push('');
      }
      continue;
    }
    const known = isKnownHeading(line);
    const heuristicHeading =
      !known && looksLikeHeading(line) && !current?.bodyLines?.length === false;
    // Always treat known headings as headings. Heuristic only when:
    //   - the line passes the heuristic check
    //   - we're past any preamble (already have at least one section
    //     OR the next line is non-empty body content)
    const isHeading = known || (looksLikeHeading(line) && current !== null);

    if (isHeading) {
      if (current) {
        sections.push(finishSection(current));
      }
      current = {
        heading: line,
        matchKey: known ? HEADING_LOOKUP.get(normalize(line)) : null,
        bodyLines: [],
      };
    } else if (current) {
      current.bodyLines.push(line);
    }
    // Lines before the first heading get dropped (they're title/date/scripture
    // metadata captured in fullText).
  }
  if (current) sections.push(finishSection(current));

  return { fullText, sections };
}

function finishSection(s) {
  // Trim trailing blanks; collapse 3+ blank lines to 2.
  const body = s.bodyLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { heading: s.heading, matchKey: s.matchKey, body };
}

/**
 * Score how well a parsed section's heading matches a bulletin
 * liturgy_item's title. Higher is better; 0 = no match.
 *
 * Strategy:
 *   - 100  exact normalized match (after alias canonicalization)
 *   - 80   the section's matchKey aliases to this item's normalized title
 *   - 60   one is a substring of the other (and both have meaningful length)
 *   - 0    otherwise
 */
export function scoreHeadingAgainstItem(section, item) {
  if (!item?.title) return 0;
  const itemNorm = normalize(item.title);
  if (!itemNorm) return 0;
  const headingNorm = normalize(section.heading);
  if (headingNorm === itemNorm) return 100;
  if (section.matchKey && section.matchKey === itemNorm) return 80;
  // Aliases also work the other way: maybe the bulletin item title is
  // an alias variant the pastor uses, and the heading is canonical.
  const itemAliasKey = HEADING_LOOKUP.get(itemNorm);
  if (itemAliasKey && itemAliasKey === section.matchKey) return 80;
  if (itemAliasKey && itemAliasKey === headingNorm) return 80;
  if (
    headingNorm.length >= 4 &&
    itemNorm.length >= 4 &&
    (itemNorm.includes(headingNorm) || headingNorm.includes(itemNorm))
  ) {
    return 60;
  }
  return 0;
}

/**
 * For each parsed section, pick the best-matching liturgy_item (or
 * null if no item scored above threshold).
 *
 * @param {Array} sections   parsed sections from parseLiturgyDocx
 * @param {Array} items      liturgy_items from the bulletin
 * @returns {Array} same-length as sections, each entry:
 *   { section, suggestedItem, score, alternates }
 *   - alternates: top-N other items with score > 0, for the override dropdown
 */
export function suggestMatches(sections, items) {
  return sections.map((section) => {
    const scored = items
      .map((item) => ({ item, score: scoreHeadingAgainstItem(section, item) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return {
      section,
      suggestedItem: scored[0]?.item ?? null,
      score: scored[0]?.score ?? 0,
      alternates: scored.slice(0, 5).map((x) => x.item),
    };
  });
}
