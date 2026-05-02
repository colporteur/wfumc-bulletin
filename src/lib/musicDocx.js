// Parses the music director's weekly .docx into rows that map to
// liturgy_items in the bulletin's order of worship.
//
// Recognized line patterns (real example, slightly munged from Pastor
// Todd's actual file):
//
//   MUSIC FOR WORSHIP – May 3                       (header, ignored)
//   Prelude:  Jesus Paid it All – Arr. by Alan Lohr
//   Offertory: Where No One Stands Alone By Mosie...    April Huddleston, Soprano
//   Anthem:  You Are the Bread from THE LIVING LAST SUPPER...   Chancel Choir
//   Hymns:
//     UMH #545 The Church's One Foundation (AURELIA)
//     UMH #618 Let Us Break Bread Together (LET US BREAK BREAD TOGETHER)
//     UMH #172 My Jesus, I Love Thee (GORDON)
//
//   HYMN BIO….My Jesus, I Love Thee By William Ralph Featherston (1846-1873)
//   <bio paragraph>
//   <bio paragraph>
//
// Output is a flat list of rows, each with `kind`:
//   - 'music_item'  Prelude / Offertory / Anthem / etc.
//                   { kind, label, body, suggestedItem }
//                   body fills inline_body of the matched item.
//   - 'hymn'        a single hymn line within the Hymns block
//                   { kind, hymnal_source, hymn_number, hymn_title,
//                     tune_name, suggestedItem }
//                   patches hymn_* fields on the matched item.
//   - 'hymn_bio'    a HYMN BIO… block
//                   { kind, hymn_title, body, suggestedItem }
//                   patches hymn_bio + appends to expanded_detail.

import mammoth from 'mammoth';

// Music-item types we recognize on the left of "Type: ..."
const MUSIC_LABELS = [
  'prelude',
  'postlude',
  'offertory',
  'anthem',
  'introit',
  'choral call to worship',
  'choral response',
  'special music',
  'musical offering',
  'doxology',
];

const HYMNAL_SOURCES = ['UMH', 'TFWS'];

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\w\s']/g, ' ')
    .replace(/\b(the|a|an|of|to)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Try to parse a hymn line like "UMH #545 The Church's One Foundation (AURELIA)"
// Returns null if it doesn't match.
function parseHymnLine(line) {
  // Tolerate whitespace, leading list markers, and missing components.
  // Pattern: optional bullet/spaces → SOURCE → optional # → number → title → optional (TUNE)
  const m = line
    .replace(/^\s*[\-•·*]?\s*/, '')
    .match(/^(UMH|TFWS)\s*#?\s*(\d+[a-z]?)\s+(.+?)(?:\s*\(([^()]+)\))?\s*$/i);
  if (!m) return null;
  const source = m[1].toUpperCase();
  const number = m[2];
  const title = m[3].trim();
  const tune = m[4]?.trim() || null;
  if (!HYMNAL_SOURCES.includes(source)) return null;
  return {
    hymnal_source: source,
    hymn_number: number,
    hymn_title: title,
    tune_name: tune,
  };
}

// Detect the "Type: content" lines at the top of the doc.
function parseMusicItem(line) {
  const m = line.match(/^([A-Za-z][A-Za-z\s]+?):\s+(.+)$/);
  if (!m) return null;
  const label = m[1].trim();
  if (!MUSIC_LABELS.includes(normalize(label))) return null;
  // Squash multiple whitespace runs (the real doc uses tabs to push the
  // performer to the right margin — collapse them for readability).
  const body = m[2].replace(/\s{2,}/g, '   ').trim();
  return { label, body };
}

function isHymnsHeader(line) {
  return /^hymns?\s*:\s*$/i.test(line.trim());
}

// HYMN BIO….My Jesus, I Love Thee By Author (1846-1873)
// We extract the hymn title — what's between "BIO" and "By".
function parseHymnBioHeader(line) {
  const m = line.match(/^HYMN\s*BIO[\s.…]+(.+?)(?:\s+By\s+.+)?$/i);
  if (!m) return null;
  return { hymn_title: m[1].trim() };
}

/**
 * Parse a music-director .docx into typed rows.
 *
 * @returns {{ fullText: string, rows: Array }}
 */
export async function parseMusicDocx(file) {
  const buf =
    file instanceof ArrayBuffer
      ? file
      : await (file.arrayBuffer ? file.arrayBuffer() : file);
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  const fullText = (result?.value ?? '').trim();
  const lines = fullText.split('\n').map((s) => s.replace(/\s+$/, ''));

  const rows = [];
  let inHymnsBlock = false;
  let bioBuf = null; // { hymn_title, bodyLines }

  const flushBio = () => {
    if (!bioBuf) return;
    const body = bioBuf.bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (body) {
      rows.push({
        kind: 'hymn_bio',
        hymn_title: bioBuf.hymn_title,
        body,
      });
    }
    bioBuf = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (bioBuf) bioBuf.bodyLines.push('');
      continue;
    }

    // HYMN BIO header always closes any prior bio + starts a new one.
    const bioHeader = parseHymnBioHeader(line);
    if (bioHeader) {
      flushBio();
      bioBuf = { hymn_title: bioHeader.hymn_title, bodyLines: [] };
      inHymnsBlock = false;
      continue;
    }

    // While accumulating a bio, everything goes into its body.
    if (bioBuf) {
      bioBuf.bodyLines.push(line);
      continue;
    }

    // "Hymns:" header opens the hymn list block.
    if (isHymnsHeader(line)) {
      inHymnsBlock = true;
      continue;
    }

    // Inside the hymns block, try to parse hymn lines.
    if (inHymnsBlock) {
      const hymn = parseHymnLine(line);
      if (hymn) {
        rows.push({ kind: 'hymn', ...hymn });
        continue;
      }
      // Unrecognized line inside the block — close the block and try
      // matching against music-item or fall through.
      inHymnsBlock = false;
    }

    // Music item ("Prelude: ...", "Offertory: ...", etc.)
    const musicItem = parseMusicItem(line);
    if (musicItem) {
      rows.push({ kind: 'music_item', ...musicItem });
      continue;
    }
    // Lines we don't recognize get dropped (they're title/header text).
  }
  flushBio();

  return { fullText, rows };
}

/**
 * For each parsed row, suggest the best-matching liturgy_item.
 *
 *   music_item  → match by label (e.g., "Prelude" → item titled "Prelude")
 *   hymn        → assign in order to the bulletin's hymn-type items
 *   hymn_bio    → match by hymn_title (case-insensitive contains)
 *
 * Returns the same rows enriched with { suggestedItem, alternates }.
 */
export function suggestMusicMatches(rows, items) {
  // Build pools we use across rows.
  const hymnItems = items.filter((it) => it.item_type === 'hymn');
  // Track which hymn items we've already paired so consecutive hymn rows
  // fill different slots in order.
  const usedHymnItemIds = new Set();
  let hymnSlotCursor = 0;

  return rows.map((row) => {
    if (row.kind === 'music_item') {
      const want = normalize(row.label);
      const scored = items
        .map((it) => ({
          item: it,
          score: scoreLabelAgainstItem(want, it),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      return {
        ...row,
        suggestedItem: scored[0]?.item ?? null,
        score: scored[0]?.score ?? 0,
        alternates: scored.slice(0, 5).map((x) => x.item),
      };
    }
    if (row.kind === 'hymn') {
      // Order-based: take the next unused hymn slot.
      let candidate = null;
      while (hymnSlotCursor < hymnItems.length) {
        const c = hymnItems[hymnSlotCursor++];
        if (!usedHymnItemIds.has(c.id)) {
          candidate = c;
          usedHymnItemIds.add(c.id);
          break;
        }
      }
      // Score = 60 (positional) — gives the user a clear "fuzzy" match
      // signal so they can override per row.
      return {
        ...row,
        suggestedItem: candidate,
        score: candidate ? 60 : 0,
        alternates: hymnItems,
      };
    }
    if (row.kind === 'hymn_bio') {
      const want = normalize(row.hymn_title);
      // Match against any hymn item whose hymn_title or title contains
      // the bio's hymn_title (or vice versa).
      const scored = items
        .filter((it) => it.item_type === 'hymn')
        .map((it) => {
          const hymnTitleNorm = normalize(it.hymn_title);
          const titleNorm = normalize(it.title);
          let score = 0;
          if (want && (hymnTitleNorm === want || titleNorm === want))
            score = 100;
          else if (
            want &&
            (hymnTitleNorm.includes(want) ||
              titleNorm.includes(want) ||
              (hymnTitleNorm && want.includes(hymnTitleNorm)))
          )
            score = 80;
          return { item: it, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      return {
        ...row,
        suggestedItem: scored[0]?.item ?? null,
        score: scored[0]?.score ?? 0,
        alternates: hymnItems,
      };
    }
    return row;
  });
}

function scoreLabelAgainstItem(wantNormLabel, item) {
  if (!item?.title) return 0;
  const titleNorm = normalize(item.title);
  if (!titleNorm) return 0;
  if (titleNorm === wantNormLabel) return 100;
  if (titleNorm.includes(wantNormLabel) || wantNormLabel.includes(titleNorm))
    return 70;
  return 0;
}
