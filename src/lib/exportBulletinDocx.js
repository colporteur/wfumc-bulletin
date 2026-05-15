// Print-ready bulletin → Word document exporter.
//
// Builds a .docx of the WHOLE bulletin (cover, welcome, calendar,
// prayer requests, stewardship/attendance, community blocks,
// announcements, order of worship, sermon-notes filler) sized for a
// half-legal saddle-stitched booklet:
//
//   Page size:    8.5" wide × 7" tall (landscape half-legal)
//   When printed: enable Word's Page Setup → Multiple pages →
//                 "Book fold" with paper size Legal landscape, then
//                 print duplex. Two sheets give you 8 pages of
//                 content folded into a booklet.
//
// Pages render in normal reading order (1, 2, 3, …) — Word's Book
// fold setting handles the imposition at print time.
//
// Sections that have no data are skipped entirely (e.g., empty
// attendance/stewardship → no stewardship page). The Order of
// Worship is skipped only if there are zero liturgy items.
//
// Excluded by design:
//   - expanded_detail / hymn lyrics / full scripture text (the
//     "expand view" content from the digital bulletin)
//   - response prompts, prayer-request submission form, check-in form
//   - QR code, sharing buttons
//
// Hymn bios are inlined under each hymn (in a smaller italic font).

import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  LineRuleType,
  HeadingLevel,
  PageBreak,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
  Packer,
} from 'docx';
import { supabase, withTimeout } from './supabase';

// ----------------------------------------------------------------------
// Style helpers
// ----------------------------------------------------------------------

const FONT_BODY = 'Georgia';
const FONT_HEADING = 'Georgia';
const FONT_SIZE_BODY_PT = 10; // base body text size
const COLOR_HEADING = '5C0F0F'; // umc-900-ish
const COLOR_DIM = '666666';
const COLOR_LINE = 'D0D0D0';

// docx-js measures sizes in half-points and dimensions in twips
// (1/20 of a point, 1440 twips per inch).
const ptToHalfPt = (pt) => Math.round(pt * 2);

// Body paragraph at the default size, optionally bold/italic/sized.
function p(text, opts = {}) {
  return new Paragraph({
    spacing: {
      line: 264, // 1.1× line height
      lineRule: LineRuleType.AUTO,
      after: opts.after ?? 60,
      before: opts.before ?? 0,
    },
    alignment: opts.alignment ?? AlignmentType.LEFT,
    indent: opts.indent
      ? { left: convertInchesToTwip(opts.indent) }
      : undefined,
    keepLines: opts.keepLines ?? true,
    keepNext: opts.keepNext ?? false,
    children: [
      new TextRun({
        text: text || '',
        font: opts.font || FONT_BODY,
        size: ptToHalfPt(opts.size || FONT_SIZE_BODY_PT),
        bold: !!opts.bold,
        italics: !!opts.italics,
        color: opts.color,
      }),
    ],
  });
}

// Section heading (e.g. "Order of Worship", "Prayer Requests").
function sectionHeading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    keepNext: true,
    border: {
      bottom: {
        color: COLOR_HEADING,
        space: 4,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
    children: [
      new TextRun({
        text,
        font: FONT_HEADING,
        size: ptToHalfPt(14),
        bold: true,
        color: COLOR_HEADING,
      }),
    ],
  });
}

// Sub-heading within a section (e.g., a calendar group name, a
// prayer category, an announcement title).
function subHeading(text) {
  return p(text, {
    bold: true,
    size: 11,
    color: COLOR_HEADING,
    keepNext: true,
    after: 40,
  });
}

// Hard page break.
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// Empty spacing paragraph.
function spacer(after = 120) {
  return new Paragraph({ spacing: { after }, children: [new TextRun('')] });
}

// A blank ruled line for the Notes filler.
function notesLine() {
  return new Paragraph({
    spacing: { line: 480, lineRule: LineRuleType.AUTO, after: 0 },
    border: {
      bottom: {
        color: COLOR_LINE,
        space: 1,
        style: BorderStyle.SINGLE,
        size: 4,
      },
    },
    children: [new TextRun('')],
  });
}

// Multi-line body block — splits on \n, each line becomes its own
// paragraph that "keepLines" so it doesn't break mid-line.
function multilineP(text, opts = {}) {
  if (!text || !String(text).trim()) return [];
  return String(text)
    .split('\n')
    .map((line) => p(line, opts));
}

// ----------------------------------------------------------------------
// Data loader — loads everything the printable bulletin needs, scoped
// to a specific bulletin id (works for drafts AND published).
// ----------------------------------------------------------------------

function plusDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadBulletinForPrint(bulletinId) {
  const bulRes = await withTimeout(
    supabase.from('bulletins').select('*').eq('id', bulletinId).single()
  );
  if (bulRes.error) throw bulRes.error;
  const bulletin = bulRes.data;
  const startDate = bulletin.service_date || new Date().toISOString().slice(0, 10);
  const endDate = plusDaysISO(startDate, 14);
  const monthForBdays = new Date(startDate + 'T00:00:00').getMonth() + 1;

  const [
    settingsRes,
    liturgyRes,
    prayerCatsRes,
    prayerReqsRes,
    eventsRes,
    weeklyRes,
    birthdaysRes,
    fundsRes,
    stewEntRes,
    attCatsRes,
    attEntRes,
    rolesRes,
    leadAssignRes,
    greetRes,
    toolsRes,
    annRes,
    otherRes,
  ] = await Promise.all([
    withTimeout(supabase.from('church_settings').select('*').eq('id', 1).maybeSingle()),
    withTimeout(
      supabase
        .from('liturgy_items')
        .select('*, sermon:sermons(*)')
        .eq('bulletin_id', bulletinId)
        .order('position', { ascending: true })
    ),
    withTimeout(
      supabase
        .from('prayer_categories')
        .select('*')
        .eq('is_active', true)
        .order('position', { ascending: true })
    ),
    withTimeout(
      supabase
        .from('prayer_requests')
        .select('*')
        .eq('is_active', true)
        .order('submitted_at', { ascending: false })
    ),
    withTimeout(
      supabase
        .from('calendar_events')
        .select('*')
        .gte('event_date', startDate)
        .lte('event_date', endDate)
        .eq('is_published', true)
        .order('event_date', { ascending: true })
        .order('event_time', { ascending: true })
    ),
    withTimeout(
      supabase
        .from('weekly_schedule_items')
        .select('*')
        .eq('is_active', true)
        .order('day_of_week', { ascending: true })
        .order('position', { ascending: true })
    ),
    withTimeout(
      supabase
        .from('birthdays')
        .select('*')
        .eq('month', monthForBdays)
        .order('day', { ascending: true })
    ),
    withTimeout(
      supabase
        .from('stewardship_funds')
        .select('*')
        .eq('is_active', true)
        .order('position', { ascending: true })
    ),
    withTimeout(
      supabase.from('stewardship_entries').select('*').eq('bulletin_id', bulletinId)
    ),
    withTimeout(
      supabase
        .from('attendance_categories')
        .select('*')
        .eq('is_active', true)
        .order('position', { ascending: true })
    ),
    withTimeout(
      supabase.from('attendance_entries').select('*').eq('bulletin_id', bulletinId)
    ),
    withTimeout(
      supabase
        .from('leading_worship_roles')
        .select('*')
        .eq('is_active', true)
        .order('position', { ascending: true })
    ),
    withTimeout(
      supabase
        .from('leading_worship_assignments')
        .select('*')
        .eq('bulletin_id', bulletinId)
    ),
    withTimeout(
      supabase
        .from('greeters_ushers')
        .select('*')
        .eq('bulletin_id', bulletinId)
        .maybeSingle()
    ),
    withTimeout(
      supabase
        .from('tools_blocks')
        .select('*')
        .eq('bulletin_id', bulletinId)
        .order('position', { ascending: true })
    ),
    withTimeout(
      supabase
        .from('announcements')
        .select('*')
        .eq('bulletin_id', bulletinId)
        .order('position', { ascending: true })
    ),
    withTimeout(
      supabase
        .from('other_blocks')
        .select('*')
        .eq('bulletin_id', bulletinId)
        .order('position', { ascending: true })
    ),
  ]);

  const errs = [
    settingsRes, liturgyRes, prayerCatsRes, prayerReqsRes, eventsRes,
    weeklyRes, birthdaysRes, fundsRes, stewEntRes, attCatsRes, attEntRes,
    rolesRes, leadAssignRes, greetRes, toolsRes, annRes, otherRes,
  ].map((r) => r.error).filter(Boolean);
  if (errs.length) throw errs[0];

  return {
    bulletin,
    settings: settingsRes.data || {},
    liturgy: liturgyRes.data ?? [],
    prayerCategories: prayerCatsRes.data ?? [],
    prayerRequests: prayerReqsRes.data ?? [],
    events: eventsRes.data ?? [],
    weekly: weeklyRes.data ?? [],
    birthdays: birthdaysRes.data ?? [],
    funds: fundsRes.data ?? [],
    stewEntries: stewEntRes.data ?? [],
    attCategories: attCatsRes.data ?? [],
    attEntries: attEntRes.data ?? [],
    roles: rolesRes.data ?? [],
    leadAssignments: leadAssignRes.data ?? [],
    greeters: greetRes.data ?? null,
    toolsBlocks: toolsRes.data ?? [],
    announcements: annRes.data ?? [],
    otherBlocks: otherRes.data ?? [],
  };
}

// ----------------------------------------------------------------------
// Cover image fetching — pulled as ArrayBuffer so docx can embed it.
// ----------------------------------------------------------------------

async function fetchImageBuffer(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}

function imageType(url) {
  const lower = (url || '').toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.gif')) return 'gif';
  if (lower.endsWith('.bmp')) return 'bmp';
  return 'jpg';
}

// ----------------------------------------------------------------------
// Date / time formatting
// ----------------------------------------------------------------------

function fmtServiceDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function fmtEventDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function fmtTime(t) {
  if (!t) return '';
  // Time strings come back as 'HH:MM:SS' from Postgres.
  const [h, m] = String(t).split(':').map((s) => parseInt(s, 10));
  if (isNaN(h)) return '';
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ----------------------------------------------------------------------
// Section builders — each returns an array of docx Paragraphs (or
// an empty array if the section has nothing to render).
// ----------------------------------------------------------------------

function buildInstructionNote() {
  // Tiny note at the very top so the user remembers to enable Book fold
  // the first time they print. Light italic — easy to ignore once known.
  return [
    p(
      'Print tip: For the booklet fold, in Word use Page Setup → Multiple pages → "Book fold" with paper size Legal (landscape), then print duplex. Pages here are in reading order.',
      { italics: true, color: COLOR_DIM, size: 8, after: 60 }
    ),
  ];
}

async function buildCover(data) {
  const out = [];
  const churchName =
    data.settings?.church_name || 'Wedowee First United Methodist Church';

  // Try to embed the cover image at the top of page 1.
  if (data.bulletin.cover_image_url) {
    const buf = await fetchImageBuffer(data.bulletin.cover_image_url);
    if (buf) {
      // Sized to fit the printable width (page is 8.5" wide, ~0.75" margins
      // each side → ~7" usable). Keep it punchy at ~5" tall max.
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new ImageRun({
              data: buf,
              transformation: { width: 480, height: 320 },
              type: imageType(data.bulletin.cover_image_url),
            }),
          ],
        })
      );
    }
  }

  out.push(
    p(churchName, {
      bold: true,
      size: 22,
      alignment: AlignmentType.CENTER,
      color: COLOR_HEADING,
      after: 120,
    })
  );
  if (data.bulletin.service_date) {
    out.push(
      p(fmtServiceDate(data.bulletin.service_date), {
        size: 14,
        alignment: AlignmentType.CENTER,
        after: 60,
      })
    );
  }
  if (data.bulletin.sunday_designation) {
    out.push(
      p(data.bulletin.sunday_designation, {
        italics: true,
        size: 12,
        alignment: AlignmentType.CENTER,
        color: COLOR_DIM,
      })
    );
  }
  out.push(pageBreak());
  return out;
}

function buildWelcome(data) {
  const blurb =
    data.bulletin.welcome_blurb_override?.trim() ||
    data.settings?.welcome_blurb?.trim() ||
    '';
  if (!blurb) return [];
  return [
    sectionHeading('Welcome'),
    ...multilineP(blurb, { after: 100 }),
  ];
}

function buildCalendar(data) {
  const hasEvents = data.events.length > 0;
  const hasWeekly = data.weekly.length > 0;
  const hasBdays = data.birthdays.length > 0;
  if (!hasEvents && !hasWeekly && !hasBdays) return [];

  const out = [sectionHeading('Calendar')];

  if (hasEvents) {
    out.push(subHeading('Upcoming Events'));
    for (const ev of data.events) {
      const date = fmtEventDate(ev.event_date);
      const time = fmtTime(ev.event_time);
      const parts = [date];
      if (time) parts.push(time);
      parts.push(ev.title || '(untitled event)');
      if (ev.location) parts.push(ev.location);
      out.push(p(parts.join('  ·  '), { after: 40 }));
    }
  }

  if (hasWeekly) {
    out.push(subHeading('Weekly Schedule'));
    for (const w of data.weekly) {
      const day = DAYS[w.day_of_week] || '';
      const time = fmtTime(w.time_of_day);
      const parts = [day];
      if (time) parts.push(time);
      parts.push(w.title || '(untitled)');
      if (w.location) parts.push(w.location);
      out.push(p(parts.join('  ·  '), { after: 40 }));
    }
  }

  if (hasBdays) {
    out.push(subHeading('Birthdays This Month'));
    for (const b of data.birthdays) {
      out.push(p(`${b.day} — ${b.name}`, { after: 30 }));
    }
  }

  return out;
}

function buildPrayerRequests(data) {
  const cats = data.prayerCategories;
  const reqs = data.prayerRequests;
  if (cats.length === 0 || reqs.length === 0) return [];

  // Group requests under categories that have at least one request.
  const grouped = cats
    .map((c) => ({ cat: c, reqs: reqs.filter((r) => r.category_id === c.id) }))
    .filter((g) => g.reqs.length > 0);
  if (grouped.length === 0) return [];

  const out = [sectionHeading('Prayer Requests')];

  for (const g of grouped) {
    out.push(subHeading(g.cat.name));
    for (const r of g.reqs) {
      const line = [r.praying_for || ''];
      if (r.situation) line.push(`— ${r.situation}`);
      out.push(p(line.join(' '), { after: 30 }));
      if (!r.is_anonymous && r.submitter_name) {
        out.push(
          p(`(submitted by ${r.submitter_name})`, {
            italics: true,
            size: 8,
            color: COLOR_DIM,
            indent: 0.25,
            after: 60,
          })
        );
      }
    }
  }

  return out;
}

function buildStewardshipAndAttendance(data) {
  // Skip the entire section if there's no actual data on the bulletin.
  const hasFundEntries = data.stewEntries.some((e) =>
    e.amount != null && Number(e.amount) > 0
  );
  const hasAttEntries = data.attEntries.some((e) =>
    e.count != null && Number(e.count) > 0
  );
  const hasRoles = data.leadAssignments.some((a) =>
    (a.assignee_name || '').trim()
  );
  const hasGreeters =
    data.greeters &&
    ((data.greeters.greeters || '').trim() ||
      (data.greeters.ushers || '').trim() ||
      (data.greeters.acolytes || '').trim());
  if (!hasFundEntries && !hasAttEntries && !hasRoles && !hasGreeters) {
    return [];
  }

  const out = [sectionHeading('Stewardship & Attendance')];

  if (hasFundEntries) {
    out.push(subHeading('Stewardship'));
    for (const fund of data.funds) {
      const ent = data.stewEntries.find((e) => e.fund_id === fund.id);
      if (!ent || ent.amount == null) continue;
      const amount = Number(ent.amount);
      if (!amount) continue;
      out.push(
        p(`${fund.name}: $${amount.toLocaleString('en-US')}`, { after: 30 })
      );
    }
  }

  if (hasAttEntries) {
    out.push(subHeading('Attendance'));
    for (const cat of data.attCategories) {
      const ent = data.attEntries.find((e) => e.category_id === cat.id);
      if (!ent || ent.count == null) continue;
      const count = Number(ent.count);
      if (!count) continue;
      out.push(p(`${cat.name}: ${count}`, { after: 30 }));
    }
  }

  if (hasRoles) {
    out.push(subHeading('Leading Worship'));
    for (const role of data.roles) {
      const assigns = data.leadAssignments.filter((a) => a.role_id === role.id);
      const names = assigns
        .map((a) => (a.assignee_name || '').trim())
        .filter(Boolean);
      if (names.length === 0) continue;
      out.push(p(`${role.name}: ${names.join(', ')}`, { after: 30 }));
    }
  }

  if (hasGreeters) {
    out.push(subHeading('Greeters & Ushers'));
    if (data.greeters.greeters)
      out.push(p(`Greeters: ${data.greeters.greeters}`, { after: 30 }));
    if (data.greeters.ushers)
      out.push(p(`Ushers: ${data.greeters.ushers}`, { after: 30 }));
    if (data.greeters.acolytes)
      out.push(p(`Acolytes: ${data.greeters.acolytes}`, { after: 30 }));
  }

  return out;
}

function buildCommunityBlocks(data) {
  const blocks = data.toolsBlocks;
  if (!blocks || blocks.length === 0) return [];
  const out = [sectionHeading('Community')];

  for (const b of blocks) {
    out.push(...renderToolsBlock(b));
  }
  return out;
}

function renderToolsBlock(block) {
  const d = block.data || {};
  const out = [];
  switch (block.block_type) {
    case 'result': {
      const game = d.game_name ? ` — ${d.game_name}` : '';
      out.push(subHeading(`Game Result${game}`));
      const winner = `${d.winner || '—'}: ${d.winner_score ?? ''}`.trim();
      const loser = `${d.loser || '—'}: ${d.loser_score ?? ''}`.trim();
      out.push(p(`${winner}    vs.    ${loser}`, { after: 60 }));
      break;
    }
    case 'quote': {
      out.push(subHeading('Quote'));
      if (d.text) {
        out.push(
          p(`"${d.text}"`, { italics: true, after: 30 })
        );
      }
      if (d.author) {
        out.push(
          p(`— ${d.author}`, {
            color: COLOR_DIM,
            indent: 0.25,
            after: 60,
          })
        );
      }
      break;
    }
    case 'table': {
      const rows = Array.isArray(d.rows) ? d.rows : [];
      if (rows.length > 0) {
        out.push(subHeading(d.title || 'Information'));
        for (const r of rows) {
          if (!r.label && !r.value) continue;
          out.push(p(`${r.label || ''}: ${r.value || ''}`, { after: 30 }));
        }
      }
      break;
    }
    case 'note':
    default: {
      if (d.title) out.push(subHeading(d.title));
      if (d.body) out.push(...multilineP(d.body, { after: 40 }));
      break;
    }
  }
  return out;
}

function buildAnnouncements(data) {
  const annc = data.announcements;
  const others = data.otherBlocks;
  if ((!annc || annc.length === 0) && (!others || others.length === 0)) return [];
  const out = [sectionHeading('Announcements')];

  for (const a of annc || []) {
    if (a.title) out.push(subHeading(a.title));
    if (a.body) out.push(...multilineP(a.body, { after: 40 }));
    if (a.date_text)
      out.push(p(a.date_text, { italics: true, color: COLOR_DIM, after: 60 }));
  }

  for (const ob of others || []) {
    if (ob.block_type === 'image_flyer') {
      // Skip image flyers in print — they're often poster-sized.
      continue;
    }
    if (ob.title) out.push(subHeading(ob.title));
    if (ob.body) out.push(...multilineP(ob.body, { after: 60 }));
  }

  return out;
}

// Build a single liturgy item. Each item is wrapped in keepLines so it
// doesn't split mid-block (when feasible). Title gets keepNext so it
// doesn't strand at the bottom of a page.
function renderLiturgyItem(item, position) {
  const out = [];
  const number = `${position}.`;
  const title = item.title || '(untitled)';
  const star = item.is_starred ? '★ ' : '';
  out.push(
    p(`${number} ${star}${title}`, {
      bold: true,
      size: 11,
      keepNext: true,
      after: 30,
    })
  );

  // center / right text (often performers, hymnal references)
  if (item.center_text || item.right_text) {
    const parts = [];
    if (item.center_text) parts.push(item.center_text);
    if (item.right_text) parts.push(item.right_text);
    out.push(
      p(parts.join('  ·  '), {
        italics: true,
        color: COLOR_DIM,
        size: 9,
        indent: 0.25,
        after: 30,
      })
    );
  }

  // Always-visible inline body (skip the click-to-expand fields).
  if (item.inline_body) {
    out.push(
      ...multilineP(item.inline_body, {
        size: 9,
        indent: 0.25,
        after: 30,
      })
    );
  }

  // Type-specific extras.
  if (item.item_type === 'hymn') {
    const meta = [];
    if (item.hymnal_source && item.hymn_number) {
      meta.push(`${item.hymnal_source} #${item.hymn_number}`);
    }
    if (item.hymn_title) meta.push(item.hymn_title);
    if (item.tune_name) meta.push(`(${item.tune_name})`);
    if (meta.length) {
      out.push(
        p(meta.join(' — '), {
          size: 9,
          indent: 0.25,
          after: 30,
        })
      );
    }
    if (item.hymn_bio) {
      out.push(
        ...multilineP(item.hymn_bio, {
          italics: true,
          size: 8,
          color: COLOR_DIM,
          indent: 0.25,
          after: 60,
        })
      );
    }
  } else if (item.item_type === 'scripture') {
    const ref = [item.scripture_reference, item.scripture_translation]
      .filter(Boolean)
      .join('  ·  ');
    if (ref) {
      out.push(
        p(ref, {
          italics: true,
          color: COLOR_DIM,
          size: 9,
          indent: 0.25,
          after: 30,
        })
      );
    }
  } else if (item.item_type === 'sermon') {
    const s = item.sermon || {};
    const meta = [];
    if (s.title) meta.push(s.title);
    const ref = item.scripture_reference || s.scripture_reference;
    if (ref) meta.push(ref);
    if (meta.length) {
      out.push(
        p(meta.join('  ·  '), {
          italics: true,
          color: COLOR_DIM,
          size: 9,
          indent: 0.25,
          after: 30,
        })
      );
    }
  }

  // Trailing breathing room between items.
  out.push(p('', { after: 80 }));
  return out;
}

function buildOrderOfWorship(data) {
  const items = data.liturgy;
  if (!items || items.length === 0) return [];
  const out = [sectionHeading('Order of Worship')];
  let position = 1;
  for (const it of items) {
    out.push(...renderLiturgyItem(it, position));
    position++;
  }
  return out;
}

function buildNotesFiller(estimatedPagesUsed, targetPages) {
  // Only render if we're under the target. Each filler line is roughly
  // 0.04" tall with 1.1× spacing — about 16 lines per usable page.
  if (estimatedPagesUsed >= targetPages) return [];
  const remainingPages = targetPages - estimatedPagesUsed;
  const linesPerPage = 16;
  const totalLines = Math.max(8, Math.floor(remainingPages * linesPerPage));
  const out = [sectionHeading('Sermon Notes')];
  for (let i = 0; i < totalLines; i++) {
    out.push(notesLine());
  }
  return out;
}

// Crude page-count estimator. Word's actual layout depends on font
// rendering, image sizes, etc., so this is a rough guide for the notes
// filler + the post-build "page count" report.
function estimatePages(paragraphs) {
  // A paragraph with `after: 60` + one line of 10pt text takes ~15pt of
  // vertical space at our spacing. Usable height per page = 7 - 1 (top+
  // bottom margins) = 6 inches × 72pt = 432pt. So ~28 paragraphs/page.
  const PARAGRAPHS_PER_PAGE = 28;
  return Math.max(1, Math.ceil(paragraphs.length / PARAGRAPHS_PER_PAGE));
}

// ----------------------------------------------------------------------
// Public entry — generates the .docx Blob and a count summary.
// ----------------------------------------------------------------------

export async function buildBulletinDocx({ bulletinId }) {
  if (!bulletinId) throw new Error('No bulletin to print.');
  const data = await loadBulletinForPrint(bulletinId);

  const sections = [];
  sections.push(...buildInstructionNote());
  sections.push(...(await buildCover(data)));
  sections.push(...buildWelcome(data));
  sections.push(...buildCalendar(data));
  sections.push(...buildPrayerRequests(data));
  sections.push(...buildStewardshipAndAttendance(data));
  sections.push(...buildCommunityBlocks(data));
  sections.push(...buildAnnouncements(data));
  sections.push(...buildOrderOfWorship(data));

  // Estimate pages used so far (excluding the notes filler), then add
  // the notes section to fill toward 8 pages if there's room.
  const estimatedBeforeNotes = estimatePages(sections);
  sections.push(...buildNotesFiller(estimatedBeforeNotes, 8));

  // Final estimated total — for the post-build summary.
  const finalEstimatedPages = estimatePages(sections);

  const doc = new Document({
    creator: 'WFUMC Bulletin Admin',
    title: `Bulletin ${data.bulletin.service_date || ''}`.trim(),
    styles: {
      default: {
        document: {
          run: {
            font: FONT_BODY,
            size: ptToHalfPt(FONT_SIZE_BODY_PT),
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              // 8.5" wide × 7" tall (half-legal landscape)
              width: convertInchesToTwip(8.5),
              height: convertInchesToTwip(7),
            },
            margin: {
              top: convertInchesToTwip(0.5),
              bottom: convertInchesToTwip(0.5),
              left: convertInchesToTwip(0.6),
              right: convertInchesToTwip(0.6),
            },
          },
        },
        children: sections,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return {
    blob,
    estimatedPages: finalEstimatedPages,
    serviceDate: data.bulletin.service_date,
    sundayDesignation: data.bulletin.sunday_designation,
  };
}

// Browser-side download trigger.
export async function downloadBulletinDocx({ bulletinId }) {
  const result = await buildBulletinDocx({ bulletinId });
  const filename = safeFilename(
    `Bulletin ${result.serviceDate || ''} ${result.sundayDesignation || ''}`.trim()
  ) || 'Bulletin';
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return result;
}

function safeFilename(s) {
  if (!s) return '';
  return s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
