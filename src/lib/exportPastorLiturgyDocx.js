// Pastor's Liturgy Sheet — Word document exporter.
//
// Generates a .docx containing every liturgy_item the pastor has
// flagged for inclusion (pastor_print_include = true), in
// order-of-worship sequence, with every populated field expanded.
// This is the pastor's at-the-pulpit reference sheet — terse, dense,
// utilitarian — not a public-facing bulletin print.
//
// Style + layout come from the user's pastor_liturgy_print_preferences
// row (font, margins, header/footer, page numbers). Defaults if no row.
//
// The exporter is self-contained: it loads everything it needs from
// Supabase given a bulletinId and userId.

import {
  Document,
  Paragraph,
  TextRun,
  Header,
  Footer,
  PageNumber,
  AlignmentType,
  LineRuleType,
  HeadingLevel,
  convertInchesToTwip,
  Packer,
} from 'docx';
import { supabase, withTimeout } from './supabase';
import {
  loadPastorLiturgyPrefs,
  applyTokens,
  PASTOR_LITURGY_PREFS_DEFAULTS,
} from './pastorLiturgyPrefs';

// Friendly labels for liturgy item types — same wording as the editor.
const TYPE_LABELS = {
  generic: 'Generic',
  hymn: 'Hymn',
  music: 'Music',
  scripture: 'Scripture',
  prayer_text: 'Prayer / Responsive Text',
  responsive_reading: 'Responsive Reading',
  communion: 'Communion',
  sermon: 'Sermon',
  giving: 'Giving / Offering',
};

// Pull the bulletin + the items the pastor flagged.
async function loadBulletinAndItems(bulletinId) {
  const [bulletinRes, itemsRes] = await Promise.all([
    withTimeout(
      supabase
        .from('bulletins')
        .select('id, service_date, sunday_designation, status')
        .eq('id', bulletinId)
        .single()
    ),
    withTimeout(
      supabase
        .from('liturgy_items')
        .select('*, sermon:sermons(*)')
        .eq('bulletin_id', bulletinId)
        .eq('pastor_print_include', true)
        .order('position', { ascending: true })
    ),
  ]);
  if (bulletinRes.error) throw bulletinRes.error;
  if (itemsRes.error) throw itemsRes.error;
  return { bulletin: bulletinRes.data, items: itemsRes.data ?? [] };
}

// Pull the church name from church_settings (id=1 singleton). Best-
// effort — header just shows blank if missing.
async function loadChurchName() {
  const { data, error } = await withTimeout(
    supabase
      .from('church_settings')
      .select('church_name')
      .eq('id', 1)
      .maybeSingle()
  );
  if (error) return '';
  return data?.church_name || '';
}

// Map prefs.page_number_position → { alignment, position }
function pageNumberAlignment(pos) {
  if (pos.endsWith('left')) return AlignmentType.LEFT;
  if (pos.endsWith('right')) return AlignmentType.RIGHT;
  return AlignmentType.CENTER;
}

// Build the docx Header object from prefs + token context. Returns a
// blank header (single empty paragraph) when the pref is empty AND
// page-number position isn't in the top.
function buildHeader(prefs, ctx) {
  const headerText = applyTokens(prefs.header_content, ctx);
  const wantsPageNumberInHeader = prefs.page_number_position.startsWith('top');
  const paragraphs = [];

  if (headerText) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: headerText,
            font: prefs.font_family,
            size: Math.round(prefs.font_size_pt * 2 * 0.85),
            color: '555555',
          }),
        ],
      })
    );
  }

  if (wantsPageNumberInHeader) {
    paragraphs.push(
      new Paragraph({
        alignment: pageNumberAlignment(prefs.page_number_position),
        children: [
          new TextRun({
            text: 'Page ',
            font: prefs.font_family,
            size: Math.round(prefs.font_size_pt * 2 * 0.85),
            color: '777777',
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: prefs.font_family,
            size: Math.round(prefs.font_size_pt * 2 * 0.85),
            color: '777777',
          }),
        ],
      })
    );
  }

  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ children: [] }));
  }
  return new Header({ children: paragraphs });
}

function buildFooter(prefs, ctx) {
  const footerText = applyTokens(prefs.footer_content, ctx);
  const wantsPageNumberInFooter =
    prefs.page_number_position.startsWith('bottom');
  const paragraphs = [];

  if (footerText) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: footerText,
            font: prefs.font_family,
            size: Math.round(prefs.font_size_pt * 2 * 0.85),
            color: '777777',
          }),
        ],
      })
    );
  }

  if (wantsPageNumberInFooter) {
    paragraphs.push(
      new Paragraph({
        alignment: pageNumberAlignment(prefs.page_number_position),
        children: [
          new TextRun({
            text: 'Page ',
            font: prefs.font_family,
            size: Math.round(prefs.font_size_pt * 2 * 0.85),
            color: '777777',
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: prefs.font_family,
            size: Math.round(prefs.font_size_pt * 2 * 0.85),
            color: '777777',
          }),
        ],
      })
    );
  }

  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ children: [] }));
  }
  return new Footer({ children: paragraphs });
}

// Build the doc-level title block: church + date + sunday designation.
function buildTitleBlock(bulletin, churchName, prefs) {
  const out = [];
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: 'Pastor’s Liturgy Sheet',
          font: prefs.font_family,
          size: Math.round(prefs.font_size_pt * 2 * 1.6),
          bold: true,
        }),
      ],
    })
  );
  const subtitleParts = [];
  if (churchName) subtitleParts.push(churchName);
  if (bulletin.service_date) subtitleParts.push(bulletin.service_date);
  if (bulletin.sunday_designation)
    subtitleParts.push(bulletin.sunday_designation);
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: subtitleParts.join('  ·  '),
          font: prefs.font_family,
          size: Math.round(prefs.font_size_pt * 2 * 1.0),
          italics: true,
          color: '555555',
        }),
      ],
    })
  );
  return out;
}

// Helpers for building body paragraphs at the doc's normal text size.
function bodyParagraph(text, prefs, opts = {}) {
  return new Paragraph({
    spacing: {
      line: Math.round(prefs.line_spacing * 240),
      lineRule: LineRuleType.AUTO,
      after: opts.after ?? 80,
    },
    alignment: opts.alignment ?? AlignmentType.LEFT,
    children: [
      new TextRun({
        text: text || '',
        font: prefs.font_family,
        size: prefs.font_size_pt * 2,
        bold: opts.bold || false,
        italics: opts.italics || false,
        color: opts.color,
      }),
    ],
  });
}

// "Label: value" line with bold label and regular value.
function fieldLine(label, value, prefs) {
  return new Paragraph({
    spacing: {
      line: Math.round(prefs.line_spacing * 240),
      lineRule: LineRuleType.AUTO,
      after: 60,
    },
    children: [
      new TextRun({
        text: `${label}: `,
        font: prefs.font_family,
        size: prefs.font_size_pt * 2,
        bold: true,
      }),
      new TextRun({
        text: value || '',
        font: prefs.font_family,
        size: prefs.font_size_pt * 2,
      }),
    ],
  });
}

// Multi-line value: emit the bold label, then a fresh paragraph per
// line of the value at normal weight. Used for long fields like
// inline_body, expanded_detail, manuscript_text where wrapping matters.
function fieldBlock(label, value, prefs) {
  if (!value || !String(value).trim()) return [];
  const out = [];
  out.push(
    new Paragraph({
      spacing: {
        line: Math.round(prefs.line_spacing * 240),
        lineRule: LineRuleType.AUTO,
        after: 40,
      },
      children: [
        new TextRun({
          text: `${label}:`,
          font: prefs.font_family,
          size: prefs.font_size_pt * 2,
          bold: true,
        }),
      ],
    })
  );
  // Split the value on newlines so multi-paragraph content is preserved.
  const lines = String(value).split('\n');
  for (const line of lines) {
    out.push(
      new Paragraph({
        spacing: {
          line: Math.round(prefs.line_spacing * 240),
          lineRule: LineRuleType.AUTO,
          after: 60,
        },
        indent: { left: convertInchesToTwip(0.25) },
        children: [
          new TextRun({
            text: line,
            font: prefs.font_family,
            size: prefs.font_size_pt * 2,
          }),
        ],
      })
    );
  }
  return out;
}

// Build the docx paragraphs for a single liturgy item: a header row
// (number / title / type / star) followed by every populated field
// for that item type.
function buildItemBlock(item, displayPos, prefs) {
  const out = [];
  const typeLabel = TYPE_LABELS[item.item_type] || item.item_type;
  const titleText =
    `${displayPos}. ${item.is_starred ? '★ ' : ''}${item.title || '(untitled)'}` +
    `   [${typeLabel}]`;
  out.push(
    new Paragraph({
      spacing: {
        line: Math.round(prefs.line_spacing * 240),
        lineRule: LineRuleType.AUTO,
        before: 200,
        after: 80,
      },
      children: [
        new TextRun({
          text: titleText,
          font: prefs.font_family,
          size: Math.round(prefs.font_size_pt * 2 * 1.15),
          bold: true,
          color: '1A1A1A',
        }),
      ],
    })
  );
  // Optional center / right text from the printed bulletin layout.
  if (item.center_text)
    out.push(fieldLine('Center text', item.center_text, prefs));
  if (item.right_text)
    out.push(fieldLine('Right text', item.right_text, prefs));

  // Type-agnostic body fields.
  out.push(...fieldBlock('Inline text', item.inline_body, prefs));
  out.push(...fieldBlock('Expanded detail', item.expanded_detail, prefs));

  // Type-specific fields.
  switch (item.item_type) {
    case 'hymn': {
      if (item.hymn_title) out.push(fieldLine('Hymn title', item.hymn_title, prefs));
      if (item.hymnal_source || item.hymn_number) {
        out.push(
          fieldLine(
            'Hymnal',
            [item.hymnal_source, item.hymn_number].filter(Boolean).join(' #'),
            prefs
          )
        );
      }
      if (item.tune_name) out.push(fieldLine('Tune', item.tune_name, prefs));
      out.push(...fieldBlock('Hymn bio', item.hymn_bio, prefs));
      break;
    }
    case 'scripture': {
      if (item.scripture_reference)
        out.push(fieldLine('Reference', item.scripture_reference, prefs));
      if (item.scripture_translation)
        out.push(
          fieldLine('Translation', item.scripture_translation, prefs)
        );
      out.push(...fieldBlock('Scripture text', item.scripture_text, prefs));
      break;
    }
    case 'sermon': {
      // Some sermon data lives on the sermons row (joined as item.sermon).
      const s = item.sermon || {};
      const ref = item.scripture_reference || s.scripture_reference;
      const title = s.title;
      const theme = s.theme;
      const manuscript =
        item.sermon_manuscript_text || s.manuscript_text;
      if (title) out.push(fieldLine('Sermon title', title, prefs));
      if (ref) out.push(fieldLine('Scripture', ref, prefs));
      if (theme) out.push(fieldLine('Theme', theme, prefs));
      out.push(...fieldBlock('Manuscript', manuscript, prefs));
      break;
    }
    case 'communion':
    case 'prayer_text':
    case 'responsive_reading':
    case 'giving':
    case 'music':
    case 'generic':
    default:
      // Inline + expanded already covered above.
      break;
  }
  return out;
}

// Public entry — generates the .docx blob.
//
// Options:
//   userId     - required (used for prefs)
//   bulletinId - required
//   prefsOverride - optional partial prefs object
//   churchOverride - optional override for the {church} token
export async function buildPastorLiturgyDocx({
  userId,
  bulletinId,
  prefsOverride,
  churchOverride,
}) {
  if (!bulletinId) throw new Error('No bulletin to print.');

  const [{ bulletin, items }, churchName, basePrefs] = await Promise.all([
    loadBulletinAndItems(bulletinId),
    loadChurchName(),
    loadPastorLiturgyPrefs(userId),
  ]);

  if (!items || items.length === 0) {
    throw new Error(
      'No liturgy items are flagged for the pastor sheet. ' +
        'Check the boxes next to the items you want to include in the bulletin editor.'
    );
  }

  const prefs = {
    ...PASTOR_LITURGY_PREFS_DEFAULTS,
    ...basePrefs,
    ...(prefsOverride || {}),
  };

  // Tokens for header / footer substitution.
  const ctx = {
    date: bulletin.service_date || '',
    sunday: bulletin.sunday_designation || '',
    church: churchOverride || churchName || '',
  };

  const header = buildHeader(prefs, ctx);
  const footer = buildFooter(prefs, ctx);
  const titleBlock = buildTitleBlock(bulletin, ctx.church, prefs);

  const itemBlocks = [];
  // Use the item's actual bulletin position so the pastor can find
  // each item in the printed bulletin without counting checked items.
  for (const it of items) {
    itemBlocks.push(...buildItemBlock(it, it.position + 1, prefs));
  }

  const doc = new Document({
    creator: 'WFUMC Bulletin Admin',
    title: `Pastor Liturgy ${bulletin.service_date || ''}`.trim(),
    styles: {
      default: {
        document: {
          run: {
            font: prefs.font_family,
            size: prefs.font_size_pt * 2,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertInchesToTwip(8.5),
              height: convertInchesToTwip(11),
            },
            margin: {
              top: convertInchesToTwip(prefs.margin_top_in),
              bottom: convertInchesToTwip(prefs.margin_bottom_in),
              left: convertInchesToTwip(prefs.margin_left_in),
              right: convertInchesToTwip(prefs.margin_right_in),
            },
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children: [...titleBlock, ...itemBlocks],
      },
    ],
  });

  return Packer.toBlob(doc);
}

function safeFilename(s) {
  if (!s) return '';
  return s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

// One-shot: build the docx + trigger a browser download. Filename
// pattern:  {Date} - {Sunday Designation} - PASTOR LITURGY.docx
export async function downloadPastorLiturgyDocx(opts) {
  const blob = await buildPastorLiturgyDocx(opts);
  // Re-fetch the bulletin lightly for the filename. Simpler than
  // restructuring buildPastorLiturgyDocx to return both.
  const { data: b } = await withTimeout(
    supabase
      .from('bulletins')
      .select('service_date, sunday_designation')
      .eq('id', opts.bulletinId)
      .maybeSingle()
  );
  const dateStr = b?.service_date || '';
  const sundayStr = b?.sunday_designation || '';
  const parts = [
    safeFilename(dateStr),
    safeFilename(sundayStr),
    'PASTOR LITURGY',
  ].filter(Boolean);
  const fname = parts.join(' - ') + '.docx';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fname;
}
