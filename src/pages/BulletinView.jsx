import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { supabase, withTimeout } from '../lib/supabase';
import { prepareImageForUpload } from '../lib/imageHelpers';
import HighlightShare from '../components/HighlightShare.jsx';
import ManuscriptWithSlides from '../components/ManuscriptWithSlides.jsx';
import { fetchSlideImagesForSermon } from '../lib/sermonSlideImages';

const PRAYER_TEXT_LIMIT = 60;
const RESPONSE_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// =====================================================================
// Worshipper-facing bulletin display.
//
// Receives all loaded data as `data` prop from Home.jsx.
// Renders each section in order with a sticky in-page nav at the top.
//
// Deferred to follow-up sessions:
//   - Check-in form (button is wired but the form is a stub)
//   - Prayer-request submission form (placeholder)
//   - QR code generator
//   - Print stylesheet polish
// =====================================================================

const SECTIONS = [
  { id: 'cover', label: 'Cover' },
  { id: 'welcome', label: 'Welcome' },
  { id: 'checkin', label: 'Check In' },
  { id: 'response', label: 'Response' },
  { id: 'liturgy', label: 'Order of Worship' },
  { id: 'prayer', label: 'Prayer' },
  { id: 'stewardship', label: 'Stewardship' },
  { id: 'community', label: 'Community' },
  { id: 'announcements', label: 'Announcements' },
];

function fmtDateLong(yyyymmdd) {
  if (!yyyymmdd) return '';
  return new Date(yyyymmdd + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
function fmtDateShort(yyyymmdd) {
  if (!yyyymmdd) return '';
  return new Date(yyyymmdd + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${m} ${ampm}`;
}
function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number(n));
}

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function BulletinView({ data, onPrayerSubmitted }) {
  const { isStaff } = useAuth();
  // When the user prints, force-expand all liturgy items so hymn lyrics,
  // scripture text, sermon manuscript, etc. all show up on paper.
  const [printMode, setPrintMode] = useState(false);
  useEffect(() => {
    const onBefore = () => setPrintMode(true);
    const onAfter = () => setPrintMode(false);
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    };
  }, []);

  if (!data?.bulletin) return <NoPublishedBulletin settings={data?.settings} />;

  return (
    <div className="space-y-6" data-bulletin-body>
      {/* Floating "share with social media" button on text selection.
          Listens for selectionchange and pops up near the highlight. */}
      <HighlightShare bulletinId={data.bulletin.id} />
      {isStaff && (
        <div className="no-print bg-umc-50 border border-umc-200 rounded-md px-3 py-2 text-sm flex items-center justify-between">
          <span className="text-umc-900">
            You're signed in as staff.
          </span>
          <Link
            to={`/admin/bulletins/${data.bulletin.id}`}
            className="text-umc-700 underline whitespace-nowrap"
          >
            Edit this bulletin →
          </Link>
        </div>
      )}
      <SectionNav />
      <div className="no-print flex justify-end">
        <button
          type="button"
          onClick={() => window.print()}
          className="text-sm text-gray-500 hover:text-umc-700 underline"
        >
          🖨️ Print bulletin
        </button>
      </div>
      <CoverSection settings={data.settings} bulletin={data.bulletin} />
      <WatchLiveButton settings={data.settings} bulletin={data.bulletin} />
      <WelcomeSection
        settings={data.settings}
        bulletin={data.bulletin}
        events={data.events}
        weekly={data.weekly}
        birthdays={data.birthdays}
      />
      <CheckInSection bulletin={data.bulletin} />
      <ResponsePromptSection bulletin={data.bulletin} />
      <LiturgySection
        items={data.liturgy}
        bulletin={data.bulletin}
        funds={data.funds}
        stewEntries={data.stewEntries}
        settings={data.settings}
        printMode={printMode}
      />
      <PrayerSection
        categories={data.prayerCategories}
        requests={data.prayerRequests}
        onPrayerSubmitted={onPrayerSubmitted}
      />
      <StewardshipSection
        funds={data.funds}
        entries={data.stewEntries}
        attCategories={data.attCategories}
        attEntries={data.attEntries}
        roles={data.roles}
        leadAssignments={data.leadAssignments}
        greeters={data.greeters}
      />
      <CommunitySection blocks={data.toolsBlocks} />
      <AnnouncementsSection
        announcements={data.announcements}
        otherBlocks={data.otherBlocks}
      />
      <Footer settings={data.settings} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Sticky section nav (in-page anchors)
// ---------------------------------------------------------------------
function SectionNav() {
  return (
    <nav className="no-print sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-gray-200 overflow-x-auto">
      <ul className="flex gap-3 text-xs whitespace-nowrap">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="text-gray-500 hover:text-umc-700"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------
function CoverSection({ settings, bulletin }) {
  return (
    <section id="cover" className="text-center space-y-3">
      {bulletin.cover_image_url && (
        <img
          src={bulletin.cover_image_url}
          alt=""
          className="mx-auto rounded-lg max-h-72 w-full object-cover"
        />
      )}
      <h1 className="font-serif text-2xl text-umc-900">
        {settings?.church_name ?? 'Wedowee First United Methodist Church'}
      </h1>
      {settings?.mission_statement && (
        <p className="text-sm italic text-gray-600">
          {settings.mission_statement}
        </p>
      )}
      <div className="pt-3">
        {bulletin.sunday_designation && (
          <p className="font-serif text-xl text-umc-900">
            {bulletin.sunday_designation}
          </p>
        )}
        <p className="text-sm text-gray-600 mt-1">
          {fmtDateLong(bulletin.service_date)}
          {bulletin.service_time && (
            <span className="ml-2">at {fmtTime(bulletin.service_time)}</span>
          )}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Watch Live (Sunday-only big button; otherwise smaller channel link)
// ---------------------------------------------------------------------
function WatchLiveButton({ settings, bulletin }) {
  if (!settings?.youtube_channel_url && !settings?.youtube_livestream_url)
    return null;

  const isSunday = new Date().getDay() === 0;
  const showLive =
    isSunday && settings?.youtube_livestream_url;

  return (
    <section className="no-print text-center">
      {showLive ? (
        <a
          href={settings.youtube_livestream_url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary inline-flex items-center gap-2"
        >
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          Watch Live on YouTube
        </a>
      ) : settings?.youtube_channel_url ? (
        <a
          href={settings.youtube_channel_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-umc-700 underline"
        >
          Watch on our YouTube channel
        </a>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------
// Welcome (blurb + calendar + each week + birthdays)
// ---------------------------------------------------------------------
function WelcomeSection({ settings, bulletin, events, weekly, birthdays }) {
  const monthName = MONTHS[new Date().getMonth()];
  const weeklyByDay = DAYS.map((dayName, idx) => ({
    dayName,
    items: weekly.filter((w) => w.day_of_week === idx),
  })).filter((d) => d.items.length > 0);

  // Per-bulletin override wins over the church-wide default
  const blurb = bulletin?.welcome_blurb || settings?.welcome_blurb;

  return (
    <section id="welcome" className="space-y-4">
      <SectionHeading>Welcome</SectionHeading>

      {blurb && (
        <div className="card">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{blurb}</p>
        </div>
      )}

      {events.length > 0 && (
        <div className="card">
          <h3 className="font-serif text-lg text-umc-900 mb-2">
            This Week's Calendar
          </h3>
          <ul className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <div className="text-gray-700">
                  <span className="font-medium">
                    {fmtDateShort(e.event_date)}
                  </span>
                  {e.event_time && (
                    <span className="text-gray-500 ml-2">
                      {fmtTime(e.event_time)}
                    </span>
                  )}
                </div>
                <div className="text-gray-800">{e.title}</div>
                {e.location && (
                  <div className="text-xs text-gray-500">{e.location}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {weeklyByDay.length > 0 && (
        <div className="card">
          <h3 className="font-serif text-lg text-umc-900 mb-2">Each Week</h3>
          <div className="space-y-2 text-sm">
            {weeklyByDay.map(({ dayName, items }) => (
              <div key={dayName}>
                <div className="font-medium text-gray-700">{dayName}</div>
                <ul className="ml-3">
                  {items.map((w) => (
                    <li key={w.id} className="text-gray-700">
                      {w.start_time && (
                        <span className="text-gray-500 mr-2">
                          {fmtTime(w.start_time)}
                        </span>
                      )}
                      {w.title}
                      {w.location && (
                        <span className="text-xs text-gray-500 ml-1">
                          ({w.location})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {birthdays.length > 0 && (
        <div className="card">
          <h3 className="font-serif text-lg text-umc-900 mb-2">
            {monthName} Birthdays
          </h3>
          <ul className="text-sm space-y-1">
            {birthdays.map((b) => (
              <li key={b.id} className="text-gray-700">
                <span className="text-gray-500 mr-2 inline-block w-6 text-right">
                  {b.day}
                </span>
                {b.full_name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Liturgy / Order of Worship
// ---------------------------------------------------------------------
function LiturgySection({ items, bulletin, funds, stewEntries, settings, printMode }) {
  if (items.length === 0) return null;
  return (
    <section id="liturgy" className="space-y-3">
      <SectionHeading>Order of Worship</SectionHeading>
      <p className="text-xs text-gray-500 no-print">
        <span className="font-semibold text-umc-700">*</span> = please stand if
        able. Tap any item with a ▸ to expand.
      </p>
      <div className="card divide-y divide-gray-100 p-0">
        {items.map((it) => (
          <LiturgyRow
            key={it.id}
            item={it}
            funds={funds}
            stewEntries={stewEntries}
            settings={settings}
            printMode={printMode}
          />
        ))}
      </div>
    </section>
  );
}

function LiturgyRow({ item, funds, stewEntries, settings, printMode }) {
  const [expanded, setExpanded] = useState(false);

  // When printing, force everything expanded so it actually prints.
  const showExpanded = expanded || !!printMode;

  // Decide whether this item has anything to expand
  const hasExpandable =
    !!item.expanded_detail ||
    (item.item_type === 'hymn' && (item.hymn_title || item.hymn_bio)) ||
    (item.item_type === 'scripture' && item.scripture_text) ||
    (item.item_type === 'sermon' && item.sermon?.manuscript_text) ||
    (item.item_type === 'giving' && stewEntries.length > 0);

  // Sermon items render their sermon title as a sub-line under the row title.
  const sermonSubtitle =
    item.item_type === 'sermon' ? item.sermon?.title : null;

  const hymnLabel = (() => {
    if (item.item_type !== 'hymn') return null;
    const parts = [];
    if (item.hymnal_source) parts.push(item.hymnal_source);
    if (item.hymn_number) parts.push(`#${item.hymn_number}`);
    return parts.join(' ');
  })();

  return (
    <div className="px-4 py-2.5 print-keep-together">
      <button
        type="button"
        onClick={() => hasExpandable && setExpanded((v) => !v)}
        className={`w-full flex items-baseline justify-between gap-3 text-left ${
          hasExpandable ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-baseline gap-1 flex-1 min-w-0">
          {hasExpandable && (
            <span className="text-gray-400 text-xs w-3 print-hide-caret">
              {expanded ? '▾' : '▸'}
            </span>
          )}
          {item.is_starred && (
            <span className="font-semibold text-umc-700 mr-1">*</span>
          )}
          <span className="font-medium text-gray-800 truncate">
            {item.title}
          </span>
        </div>
        {item.center_text && (
          <span className="text-sm text-gray-500 italic hidden sm:inline">
            {item.center_text}
          </span>
        )}
        <div className="text-sm text-gray-600 text-right whitespace-nowrap">
          {item.right_text || hymnLabel}
        </div>
      </button>

      {sermonSubtitle && (
        <p className="mt-1 ml-5 italic font-serif text-gray-800">
          "{sermonSubtitle}"
        </p>
      )}

      {item.item_type === 'giving' && settings?.tithely_url && (
        <a
          href={settings.tithely_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 mt-2 ml-5 text-sm text-umc-700 underline font-medium hover:text-umc-900"
        >
          Give online →
        </a>
      )}

      {item.inline_body && (
        <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap pl-4 border-l-2 border-gray-200">
          {item.inline_body}
        </p>
      )}

      {showExpanded && hasExpandable && (
        <div className="mt-3 pl-4 border-l-2 border-umc-200 space-y-3 text-sm">
          {item.item_type === 'hymn' && (
            <HymnExpand item={item} settings={settings} />
          )}
          {item.item_type === 'scripture' && (
            <ScriptureExpand item={item} settings={settings} />
          )}
          {item.item_type === 'sermon' && <SermonExpand item={item} />}
          {item.item_type === 'giving' && (
            <GivingExpand
              funds={funds}
              entries={stewEntries}
              settings={settings}
            />
          )}
          {item.expanded_detail && (
            <p className="text-gray-700 whitespace-pre-wrap">
              {item.expanded_detail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function HymnExpand({ item, settings }) {
  return (
    <div className="space-y-2">
      {item.hymn_title && (
        <p className="font-medium text-gray-800">"{item.hymn_title}"</p>
      )}
      {item.tune_name && (
        <p className="text-xs text-gray-500">Tune: {item.tune_name}</p>
      )}
      {item.hymn_bio && (
        <p className="text-gray-700 italic whitespace-pre-wrap">
          {item.hymn_bio}
        </p>
      )}
      {(settings?.ccli_streaming_license || settings?.ccli_copyright_license) && (
        <p className="text-[10px] text-gray-400">
          {settings.ccli_copyright_license &&
            `CCLI #${settings.ccli_copyright_license}`}
          {settings.ccli_copyright_license &&
            settings.ccli_streaming_license &&
            ' · '}
          {settings.ccli_streaming_license &&
            `Streaming #${settings.ccli_streaming_license}`}
        </p>
      )}
    </div>
  );
}

function ScriptureExpand({ item }) {
  return (
    <div className="space-y-2">
      <p className="text-gray-700">
        {item.scripture_reference}
        {item.scripture_translation && (
          <span className="text-gray-500 ml-2 text-xs">
            ({item.scripture_translation})
          </span>
        )}
      </p>
      {item.scripture_text && (
        <p className="text-gray-800 whitespace-pre-wrap">
          {item.scripture_text}
        </p>
      )}
    </div>
  );
}

function SermonExpand({ item }) {
  const s = item.sermon;
  const [slideImages, setSlideImages] = useState([]);

  // Lazily fetch slide images when this sermon section gets expanded.
  // RLS allows public read for sermons in published bulletins, so this
  // works for anonymous worshippers too.
  useEffect(() => {
    if (!s?.id) return;
    let cancelled = false;
    fetchSlideImagesForSermon(s.id).then((rows) => {
      if (!cancelled) setSlideImages(rows || []);
    });
    return () => {
      cancelled = true;
    };
  }, [s?.id]);

  return (
    <div className="space-y-2">
      {s?.title && (
        <p className="font-serif text-base text-umc-900">"{s.title}"</p>
      )}
      {s?.scripture_reference && (
        <p className="text-xs text-gray-500">{s.scripture_reference}</p>
      )}
      {s?.manuscript_text ? (
        <ManuscriptWithSlides
          text={s.manuscript_text}
          slideImages={slideImages}
          className="text-gray-800 font-serif"
        />
      ) : (
        <p className="text-gray-500 italic">Manuscript not yet posted.</p>
      )}
    </div>
  );
}

function GivingExpand({ funds, entries, settings }) {
  const generalFund = funds.find((f) => f.category === 'general');
  const otherFunds = funds.filter((f) => f.category !== 'general');
  const findEntry = (fund_id, period) =>
    entries.find((e) => e.fund_id === fund_id && e.period === period);

  return (
    <div className="space-y-3">
      {settings?.tithely_url && (
        <a
          href={settings.tithely_url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary inline-block"
        >
          Give online
        </a>
      )}

      {generalFund && (
        <div>
          <p className="font-medium text-gray-700">{generalFund.name}</p>
          <table className="text-xs mt-1">
            <thead>
              <tr className="text-gray-400">
                <th></th>
                <th className="text-right pl-3">MTD</th>
                <th className="text-right pl-3">YTD</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'received', label: 'Received' },
                { key: 'expenses', label: 'Budgeted Expenses' },
                { key: 'needed_to_meet_budget', label: 'Needed' },
              ].map(({ key, label }) => (
                <tr key={key}>
                  <td className="pr-3 text-gray-700">{label}</td>
                  <td className="text-right pl-3 text-gray-800">
                    {fmtMoney(findEntry(generalFund.id, 'mtd')?.[key])}
                  </td>
                  <td className="text-right pl-3 text-gray-800">
                    {fmtMoney(findEntry(generalFund.id, 'ytd')?.[key])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {otherFunds.length > 0 && (
        <div>
          <p className="font-medium text-gray-700">Other funds (received)</p>
          <table className="text-xs mt-1">
            <thead>
              <tr className="text-gray-400">
                <th></th>
                <th className="text-right pl-3">YTD</th>
              </tr>
            </thead>
            <tbody>
              {otherFunds.map((f) => (
                <tr key={f.id}>
                  <td className="pr-3 text-gray-700">{f.name}</td>
                  <td className="text-right pl-3 text-gray-800">
                    {fmtMoney(findEntry(f.id, 'ytd')?.received)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Prayer Requests
// ---------------------------------------------------------------------
function PrayerSection({ categories, requests, onPrayerSubmitted }) {
  if (categories.length === 0 && requests.length === 0) return null;
  return (
    <section id="prayer" className="space-y-3">
      <SectionHeading>Prayer Requests</SectionHeading>
      <div className="card space-y-4">
        {categories.map((cat) => {
          const reqs = requests.filter((r) => r.category_id === cat.id);
          if (reqs.length === 0) return null;
          return (
            <div key={cat.id}>
              <h3 className="font-serif text-lg text-umc-900 border-b border-gray-200 pb-1 mb-2">
                {cat.name}
              </h3>
              <ul className="space-y-1.5 text-sm">
                {reqs.map((r) => (
                  <li key={r.id} className="text-gray-800">
                    <span className="font-medium">
                      {r.praying_for || r.request_text}
                    </span>
                    {r.situation && (
                      <span className="text-gray-600 italic ml-2">
                        — {r.situation}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {categories.length > 0 && (
        <div className="no-print">
          <PrayerSubmitForm
            categories={categories}
            onSubmitted={onPrayerSubmitted}
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Check-in (entirely optional — clearly labeled as such)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Response Prompts — per-bulletin questions worshippers can respond to
// with text + optional photo. Each bulletin can carry several prompts
// (sermon-tied, anthem-tied, open-ended). Each gets its own card with
// its own form. Submissions feed the WFUMC Social Media Team.
// ---------------------------------------------------------------------
function ResponsePromptSection({ bulletin }) {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bulletin?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await withTimeout(
          supabase
            .from('response_prompts')
            .select('id, text, sort_order')
            .eq('bulletin_id', bulletin.id)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true })
        );
        if (error) throw error;
        if (cancelled) return;
        setPrompts(data ?? []);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load response prompts:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bulletin?.id]);

  // No prompts → don't render the section at all (matches old behavior).
  if (loading || prompts.length === 0) return null;

  return (
    <section id="response" className="space-y-3">
      <SectionHeading>Response</SectionHeading>
      <div className="space-y-4">
        {prompts.map((p) => (
          <SinglePromptCard
            key={p.id}
            prompt={p}
            bulletinId={bulletin.id}
          />
        ))}
      </div>
    </section>
  );
}

function SinglePromptCard({ prompt, bulletinId }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({
    is_anonymous: false,
    submitter_name: '',
    response_text: '',
    caption: '',
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);

  const reset = () => {
    setDraft({
      is_anonymous: false,
      submitter_name: '',
      response_text: '',
      caption: '',
    });
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please pick an image file.');
      return;
    }
    if (file.size > RESPONSE_IMAGE_MAX_BYTES) {
      setError(
        `Image is too large (${Math.round(file.size / (1024 * 1024))} MB). Max is 10 MB.`
      );
      return;
    }
    setError(null);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.response_text.trim() && !imageFile) {
      setError('Please write a response or attach a photo (or both).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let imageUrl = null;
      if (imageFile) {
        const { blob, mediaType } = await prepareImageForUpload(
          imageFile,
          2400,
          0.9
        );
        const ext =
          mediaType === 'image/png'
            ? 'png'
            : mediaType === 'image/webp'
              ? 'webp'
              : 'jpg';
        const path = `responses/${bulletinId}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        const { error: upErr } = await withTimeout(
          supabase.storage
            .from('bulletin-images')
            .upload(path, blob, { cacheControl: '3600', upsert: false }),
          30000
        );
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage
          .from('bulletin-images')
          .getPublicUrl(path);
        imageUrl = urlData.publicUrl;
      }

      const { error: insErr } = await withTimeout(
        supabase.from('responses').insert({
          bulletin_id: bulletinId,
          prompt_id: prompt.id,
          is_anonymous: draft.is_anonymous,
          submitter_name: draft.is_anonymous
            ? null
            : draft.submitter_name.trim() || null,
          response_text: draft.response_text.trim() || null,
          caption: draft.caption.trim() || null,
          image_url: imageUrl,
        })
      );
      if (insErr) throw insErr;
      setSubmitted(true);
      reset();
    } catch (e2) {
      setError(e2.message || String(e2));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card space-y-3">
      <p className="font-serif text-base text-umc-900 italic">
        "{prompt.text}"
      </p>

      {submitted ? (
        <div className="text-center py-2 space-y-2">
          <p className="text-sm text-umc-900">Thank you for sharing.</p>
          <button
            type="button"
            onClick={() => {
              setSubmitted(false);
              setOpen(true);
            }}
            className="text-xs text-umc-700 underline no-print"
          >
            Submit another
          </button>
        </div>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-primary w-full no-print"
        >
          Share your response
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 no-print">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.is_anonymous}
              onChange={(e) =>
                setDraft({ ...draft, is_anonymous: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-umc-700"
            />
            <span className="text-sm text-gray-700">Submit anonymously</span>
          </label>

          <div>
            <label className="label">Your name</label>
            <input
              type="text"
              className="input"
              value={draft.submitter_name}
              onChange={(e) =>
                setDraft({ ...draft, submitter_name: e.target.value })
              }
              disabled={draft.is_anonymous}
              placeholder={draft.is_anonymous ? 'Anonymous' : 'e.g., Jane Smith'}
            />
          </div>

          <div>
            <label className="label">
              Your response (optional if attaching a photo)
            </label>
            <textarea
              className="input min-h-[100px]"
              value={draft.response_text}
              onChange={(e) =>
                setDraft({ ...draft, response_text: e.target.value })
              }
              placeholder="Write whatever's on your heart…"
            />
          </div>

          <div>
            <label className="label">Photo (optional)</label>
            {imagePreview ? (
              <div className="space-y-2">
                <img
                  src={imagePreview}
                  alt="Your photo"
                  className="max-h-64 rounded border border-gray-200"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  className="text-xs text-red-600 hover:text-red-800 underline"
                >
                  Remove photo
                </button>
              </div>
            ) : (
              <label className="btn-secondary text-sm cursor-pointer inline-block">
                📷 Take or pick a photo
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImagePick}
                />
              </label>
            )}
          </div>

          {imagePreview && (
            <div>
              <label className="label">Caption (optional)</label>
              <input
                type="text"
                className="input"
                value={draft.caption}
                onChange={(e) =>
                  setDraft({ ...draft, caption: e.target.value })
                }
                placeholder="A short note about the photo"
              />
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit response'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
                setError(null);
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Your response goes to the WFUMC Social Media Team and may be used
            in social media. If you prefer to share without attribution,
            tap "Submit anonymously" above.
          </p>
        </form>
      )}
    </div>
  );
}

function CheckInSection({ bulletin }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({
    is_anonymous: false,
    full_name: '',
    email: '',
    phone: '',
    is_visitor: false,
  });

  const reset = () =>
    setDraft({
      is_anonymous: false,
      full_name: '',
      email: '',
      phone: '',
      is_visitor: false,
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.is_anonymous && !draft.full_name.trim()) {
      setError('Please enter your name or check "Submit anonymously".');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('check_ins').insert({
          bulletin_id: bulletin.id,
          is_anonymous: draft.is_anonymous,
          full_name: draft.is_anonymous ? null : draft.full_name.trim() || null,
          email: draft.is_anonymous ? null : draft.email.trim() || null,
          phone: draft.is_anonymous ? null : draft.phone.trim() || null,
          is_visitor: draft.is_visitor,
        })
      );
      if (err) throw err;
      setSubmitted(true);
      reset();
    } catch (e2) {
      setError(e2.message || String(e2));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="checkin" className="space-y-3 no-print">
      <SectionHeading>
        Check In{' '}
        <span className="text-sm font-normal text-gray-500 italic">
          (optional)
        </span>
      </SectionHeading>

      {submitted ? (
        <div className="card text-center space-y-2">
          <p className="text-sm text-umc-900">
            Thank you for letting us know you're here today!
          </p>
          <button
            type="button"
            onClick={() => {
              setSubmitted(false);
              setOpen(false);
            }}
            className="text-xs text-umc-700 underline"
          >
            Done
          </button>
        </div>
      ) : !open ? (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-gray-600">
            If you'd like to let us know you're worshipping with us today,
            you're welcome to check in. This is entirely optional.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-secondary"
          >
            Check in
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-lg text-umc-900">Check In</h3>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
                setError(null);
              }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>

          <p className="text-xs text-gray-500">
            All fields are optional except a name (or check the anonymous
            box). Email and phone are only used by church staff if they want
            to follow up.
          </p>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.is_anonymous}
              onChange={(e) =>
                setDraft({ ...draft, is_anonymous: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-umc-700"
            />
            <span className="text-sm text-gray-700">
              Check in anonymously (just a count, no name)
            </span>
          </label>

          <div>
            <label className="label">Your name</label>
            <input
              type="text"
              className="input"
              value={draft.full_name}
              onChange={(e) =>
                setDraft({ ...draft, full_name: e.target.value })
              }
              disabled={draft.is_anonymous}
              placeholder={draft.is_anonymous ? 'Anonymous' : 'e.g., Jane Smith'}
            />
          </div>

          <div>
            <label className="label">
              Email{' '}
              <span className="text-xs text-gray-400 font-normal">
                (optional)
              </span>
            </label>
            <input
              type="email"
              className="input"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              disabled={draft.is_anonymous}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="label">
              Phone{' '}
              <span className="text-xs text-gray-400 font-normal">
                (optional)
              </span>
            </label>
            <input
              type="tel"
              className="input"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              disabled={draft.is_anonymous}
              autoComplete="tel"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.is_visitor}
              onChange={(e) =>
                setDraft({ ...draft, is_visitor: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-umc-700"
            />
            <span className="text-sm text-gray-700">
              I'm a first-time visitor
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Check in'}
          </button>
        </form>
      )}
    </section>
  );
}

// Worshipper-friendly labels for removal modes (the admin-facing labels
// in PrayerRequestsSection.jsx are slightly more clinical).
const WORSHIPPER_REMOVAL_MODES = [
  { value: 'auto_4weeks', label: 'About 4 weeks (default)' },
  { value: 'custom_date', label: 'Until a specific date' },
  { value: 'staff_discretion', label: "Until I let staff know to remove it" },
  { value: 'until_contacted', label: 'Until someone from the church contacts me' },
];

function PrayerSubmitForm({ categories, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({
    category_id: categories[0]?.id ?? '',
    is_anonymous: false,
    submitter_name: '',
    praying_for: '',
    situation: '',
    removal_mode: 'auto_4weeks',
    remove_after_date: '',
  });

  const reset = () =>
    setDraft({
      category_id: categories[0]?.id ?? '',
      is_anonymous: false,
      submitter_name: '',
      praying_for: '',
      situation: '',
      removal_mode: 'auto_4weeks',
      remove_after_date: '',
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.praying_for.trim()) {
      setError('"Praying For" is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('prayer_requests').insert({
          category_id: draft.category_id || null,
          is_anonymous: draft.is_anonymous,
          submitter_name: draft.is_anonymous
            ? null
            : draft.submitter_name.trim() || null,
          praying_for: draft.praying_for.trim(),
          situation: draft.situation.trim() || null,
          removal_mode: draft.removal_mode,
          remove_after_date:
            draft.removal_mode === 'custom_date'
              ? draft.remove_after_date || null
              : null,
        })
      );
      if (err) throw err;
      setSubmitted(true);
      reset();
      // Refresh the visible prayer list so the new request shows up
      // immediately without making the worshipper reload.
      if (onSubmitted) onSubmitted();
    } catch (e2) {
      setError(e2.message || String(e2));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="card text-center space-y-2">
        <p className="text-sm text-umc-900">Thank you. Your prayer request has been submitted.</p>
        <button
          type="button"
          onClick={() => setSubmitted(false)}
          className="text-xs text-umc-700 underline"
        >
          Submit another
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary w-full"
      >
        + Submit a prayer request
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg text-umc-900">Submit a prayer request</h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
            setError(null);
          }}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div>
        <label className="label">Category</label>
        <select
          className="input"
          value={draft.category_id}
          onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">
          Praying For{' '}
          <span className="text-xs text-gray-400 font-normal">
            ({draft.praying_for.length}/{PRAYER_TEXT_LIMIT})
          </span>
        </label>
        <input
          type="text"
          className="input"
          maxLength={PRAYER_TEXT_LIMIT}
          value={draft.praying_for}
          onChange={(e) => setDraft({ ...draft, praying_for: e.target.value })}
          required
          placeholder="e.g., John Doe / The Anderson family"
        />
      </div>

      <div>
        <label className="label">
          Situation{' '}
          <span className="text-xs text-gray-400 font-normal">
            (optional, {draft.situation.length}/{PRAYER_TEXT_LIMIT})
          </span>
        </label>
        <input
          type="text"
          className="input"
          maxLength={PRAYER_TEXT_LIMIT}
          value={draft.situation}
          onChange={(e) => setDraft({ ...draft, situation: e.target.value })}
          placeholder="e.g., recovering from surgery"
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={draft.is_anonymous}
          onChange={(e) =>
            setDraft({ ...draft, is_anonymous: e.target.checked })
          }
          className="h-4 w-4 rounded border-gray-300 text-umc-700"
        />
        <span className="text-sm text-gray-700">Submit anonymously</span>
      </label>

      <div>
        <label className="label">Your name</label>
        <input
          type="text"
          className="input"
          value={draft.submitter_name}
          onChange={(e) =>
            setDraft({ ...draft, submitter_name: e.target.value })
          }
          disabled={draft.is_anonymous}
          placeholder={draft.is_anonymous ? 'Anonymous' : 'e.g., Jane Smith'}
        />
      </div>

      <div>
        <label className="label">Keep this request on the prayer list</label>
        <select
          className="input"
          value={draft.removal_mode}
          onChange={(e) =>
            setDraft({ ...draft, removal_mode: e.target.value })
          }
        >
          {WORSHIPPER_REMOVAL_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {draft.removal_mode === 'custom_date' && (
          <input
            type="date"
            className="input mt-2"
            value={draft.remove_after_date}
            onChange={(e) =>
              setDraft({ ...draft, remove_after_date: e.target.value })
            }
            required
          />
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit prayer request'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
// Stewardship
// ---------------------------------------------------------------------
function StewardshipSection({
  funds,
  entries,
  attCategories,
  attEntries,
  roles,
  leadAssignments,
  greeters,
}) {
  const generalFund = funds.find((f) => f.category === 'general');
  const otherFunds = funds.filter((f) => f.category !== 'general');
  const findEntry = (fund_id, period) =>
    entries.find((e) => e.fund_id === fund_id && e.period === period);
  const findAtt = (cat_id) =>
    attEntries.find((e) => e.category_id === cat_id);
  const findLead = (role_id) =>
    leadAssignments.find((a) => a.role_id === role_id);

  // Hide entire section if there's nothing to show
  const hasAnyStewardship = entries.length > 0;
  const hasAttendance = attEntries.length > 0;
  const hasLeading = roles.length > 0;
  const hasGreeters = !!greeters?.names_text;

  if (!hasAnyStewardship && !hasAttendance && !hasLeading && !hasGreeters)
    return null;

  return (
    <section id="stewardship" className="space-y-3">
      <SectionHeading>Stewardship</SectionHeading>

      {hasAnyStewardship && generalFund && (
        <div className="card">
          <h3 className="font-serif text-lg text-umc-900 mb-2">
            {generalFund.name}
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th></th>
                <th className="text-right">MTD</th>
                <th className="text-right">YTD</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'received', label: 'Received' },
                { key: 'expenses', label: 'Budgeted Expenses' },
                { key: 'needed_to_meet_budget', label: 'Needed' },
              ].map(({ key, label }) => (
                <tr key={key} className="border-t border-gray-100">
                  <td className="py-1 text-gray-700">{label}</td>
                  <td className="text-right text-gray-800">
                    {fmtMoney(findEntry(generalFund.id, 'mtd')?.[key])}
                  </td>
                  <td className="text-right text-gray-800">
                    {fmtMoney(findEntry(generalFund.id, 'ytd')?.[key])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasAnyStewardship && otherFunds.length > 0 && (
        <div className="card">
          <h3 className="font-serif text-lg text-umc-900 mb-2">Other Funds</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th>Fund</th>
                <th className="text-right">YTD</th>
              </tr>
            </thead>
            <tbody>
              {otherFunds.map((f) => {
                const ytd = findEntry(f.id, 'ytd')?.received;
                if (!ytd) return null;
                return (
                  <tr key={f.id} className="border-t border-gray-100">
                    <td className="py-1 text-gray-700">{f.name}</td>
                    <td className="text-right text-gray-800">{fmtMoney(ytd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasAttendance && (
        <div className="card">
          <h3 className="font-serif text-lg text-umc-900 mb-2">Attendance</h3>
          <ul className="text-sm space-y-1">
            {attCategories.map((c) => {
              const ent = findAtt(c.id);
              if (!ent?.count_text) return null;
              return (
                <li
                  key={c.id}
                  className="flex justify-between text-gray-700 border-b border-gray-50 py-1"
                >
                  <span>{c.name}</span>
                  <span className="text-gray-800 font-medium">
                    {ent.count_text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasLeading && (
        <div className="card">
          <h3 className="font-serif text-lg text-umc-900 mb-2">
            Leading Worship
          </h3>
          <ul className="text-sm space-y-1">
            {roles.map((r) => {
              const override = findLead(r.id)?.person_override;
              const person = override ?? r.default_person;
              if (!person) return null;
              return (
                <li key={r.id} className="flex justify-between text-gray-700">
                  <span>{r.role_label}</span>
                  <span className="text-gray-800">{person}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasGreeters && (
        <div className="card">
          <h3 className="font-serif text-lg text-umc-900 mb-1">
            Greeters &amp; Ushers
          </h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {greeters.names_text}
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Community / TOOLs
// ---------------------------------------------------------------------
function CommunitySection({ blocks }) {
  if (blocks.length === 0) return null;
  return (
    <section id="community" className="space-y-3">
      <SectionHeading>Community</SectionHeading>
      <div className="space-y-3">
        {blocks.map((b) => (
          <div key={b.id} className="card">
            {b.block_type === 'result' && <ResultBlock data={b.data} />}
            {b.block_type === 'quote' && <QuoteBlock data={b.data} />}
            {b.block_type === 'table' && <TableBlock data={b.data} />}
            {b.block_type === 'note' && <NoteBlock data={b.data} />}
          </div>
        ))}
      </div>
    </section>
  );
}

function ResultBlock({ data }) {
  return (
    <div className="text-center">
      <div className="grid grid-cols-3 items-center text-sm">
        <div className="text-right text-gray-700 font-medium">
          {data.winner || '—'}
        </div>
        <div className="text-gray-400 text-xs uppercase">vs.</div>
        <div className="text-left text-gray-500">{data.loser || '—'}</div>
        <div className="text-right text-2xl font-serif text-umc-900">
          {data.winner_score}
        </div>
        <div></div>
        <div className="text-left text-2xl font-serif text-gray-500">
          {data.loser_score}
        </div>
      </div>
    </div>
  );
}
function QuoteBlock({ data }) {
  return (
    <blockquote className="text-sm text-gray-700">
      <p className="italic whitespace-pre-wrap">"{data.text}"</p>
      {data.author && (
        <footer className="text-right text-xs text-gray-500 mt-2">
          — {data.author}
        </footer>
      )}
    </blockquote>
  );
}
function TableBlock({ data }) {
  return (
    <div>
      {data.title && (
        <h4 className="font-serif text-base text-umc-900 mb-2">{data.title}</h4>
      )}
      {Array.isArray(data.rows) && data.rows.length > 0 && (
        <table className="w-full text-sm">
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-100 last:border-0">
                <td className="py-1 text-gray-700">{r.label}</td>
                <td className="py-1 text-right text-gray-800 font-medium">
                  {r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
function NoteBlock({ data }) {
  return (
    <p className="text-sm text-gray-700 whitespace-pre-wrap">{data.text}</p>
  );
}

// ---------------------------------------------------------------------
// Announcements + Other
// ---------------------------------------------------------------------
function AnnouncementsSection({ announcements, otherBlocks }) {
  if (announcements.length === 0 && otherBlocks.length === 0) return null;
  return (
    <section id="announcements" className="space-y-3">
      <SectionHeading>Announcements</SectionHeading>

      {announcements.length > 0 && (
        <div className="card">
          <ul className="space-y-2 text-sm">
            {announcements.map((a) => (
              <li key={a.id} className="flex gap-2 text-gray-700">
                <span className="text-gray-400">•</span>
                <span className="whitespace-pre-wrap">{a.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {otherBlocks.map((b) => (
        <div key={b.id} className="card">
          {b.heading && (
            <h3 className="font-serif text-lg text-umc-900 mb-2">
              {b.heading}
            </h3>
          )}
          {b.body && (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {b.body}
            </p>
          )}
          {b.image_url && (
            <img
              src={b.image_url}
              alt=""
              className="mt-3 rounded max-h-72 w-full object-contain"
            />
          )}
          {b.signature && (
            <p className="mt-3 text-sm text-gray-600 italic text-right">
              — {b.signature}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------
// Footer (church contact info)
// ---------------------------------------------------------------------
function Footer({ settings }) {
  if (!settings) return null;
  const lines = [];
  if (settings.street_address) lines.push(settings.street_address);
  const cityLine = [settings.city, settings.state].filter(Boolean).join(', ');
  if (cityLine || settings.zip)
    lines.push([cityLine, settings.zip].filter(Boolean).join(' '));
  if (settings.phone) lines.push(settings.phone);
  if (settings.office_hours) lines.push(settings.office_hours);

  return (
    <section className="text-center text-xs text-gray-500 py-6 border-t border-gray-200 space-y-1">
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      {settings.website && (
        <p>
          <a
            href={`https://${settings.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-umc-700 underline"
          >
            {settings.website}
          </a>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Shared section heading
// ---------------------------------------------------------------------
function SectionHeading({ children }) {
  return (
    <h2 className="font-serif text-xl text-umc-900 border-b border-gray-200 pb-1">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------
// "No published bulletin yet" empty state
// ---------------------------------------------------------------------
function NoPublishedBulletin({ settings }) {
  return (
    <div className="space-y-6">
      <section className="text-center py-8 border-b border-gray-200">
        <h1 className="font-serif text-2xl text-umc-900">
          {settings?.church_name ?? 'Wedowee First United Methodist Church'}
        </h1>
        {settings?.mission_statement && (
          <p className="mt-2 text-sm italic text-gray-600">
            {settings.mission_statement}
          </p>
        )}
      </section>
      <section className="card text-center">
        <h2 className="text-xl font-serif text-umc-900">Welcome</h2>
        <p className="mt-3 text-sm text-gray-600">
          No published bulletin yet. Check back on Sunday morning.
        </p>
      </section>
    </div>
  );
}
