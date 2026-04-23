import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

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

export default function BulletinView({ data }) {
  const { isStaff } = useAuth();

  if (!data?.bulletin) return <NoPublishedBulletin settings={data?.settings} />;

  return (
    <div className="space-y-6">
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
      <CoverSection settings={data.settings} bulletin={data.bulletin} />
      <WatchLiveButton settings={data.settings} bulletin={data.bulletin} />
      <WelcomeSection
        settings={data.settings}
        events={data.events}
        weekly={data.weekly}
        birthdays={data.birthdays}
      />
      <LiturgySection
        items={data.liturgy}
        bulletin={data.bulletin}
        funds={data.funds}
        stewEntries={data.stewEntries}
        settings={data.settings}
      />
      <PrayerSection
        categories={data.prayerCategories}
        requests={data.prayerRequests}
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
function WelcomeSection({ settings, events, weekly, birthdays }) {
  const monthName = MONTHS[new Date().getMonth()];
  const weeklyByDay = DAYS.map((dayName, idx) => ({
    dayName,
    items: weekly.filter((w) => w.day_of_week === idx),
  })).filter((d) => d.items.length > 0);

  return (
    <section id="welcome" className="space-y-4">
      <SectionHeading>Welcome</SectionHeading>

      {settings?.welcome_blurb && (
        <div className="card">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {settings.welcome_blurb}
          </p>
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
function LiturgySection({ items, bulletin, funds, stewEntries, settings }) {
  if (items.length === 0) return null;
  return (
    <section id="liturgy" className="space-y-3">
      <SectionHeading>Order of Worship</SectionHeading>
      <p className="text-xs text-gray-500">
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
          />
        ))}
      </div>
    </section>
  );
}

function LiturgyRow({ item, funds, stewEntries, settings }) {
  const [expanded, setExpanded] = useState(false);

  // Decide whether this item has anything to expand
  const hasExpandable =
    !!item.expanded_detail ||
    (item.item_type === 'hymn' && (item.hymn_title || item.hymn_bio)) ||
    (item.item_type === 'scripture' && item.scripture_text) ||
    (item.item_type === 'sermon' && item.sermon_manuscript_text) ||
    (item.item_type === 'giving' && stewEntries.length > 0);

  // Sermon items render their sermon_title as a sub-line under the row title.
  const sermonSubtitle =
    item.item_type === 'sermon' ? item.sermon_title : null;

  const hymnLabel = (() => {
    if (item.item_type !== 'hymn') return null;
    const parts = [];
    if (item.hymnal_source) parts.push(item.hymnal_source);
    if (item.hymn_number) parts.push(`#${item.hymn_number}`);
    return parts.join(' ');
  })();

  return (
    <div className="px-4 py-2.5">
      <button
        type="button"
        onClick={() => hasExpandable && setExpanded((v) => !v)}
        className={`w-full flex items-baseline justify-between gap-3 text-left ${
          hasExpandable ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-baseline gap-1 flex-1 min-w-0">
          {hasExpandable && (
            <span className="text-gray-400 text-xs w-3">
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

      {item.inline_body && (
        <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap pl-4 border-l-2 border-gray-200">
          {item.inline_body}
        </p>
      )}

      {expanded && hasExpandable && (
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
  return (
    <div className="space-y-2">
      {item.sermon_title && (
        <p className="font-serif text-base text-umc-900">
          "{item.sermon_title}"
        </p>
      )}
      {item.sermon_manuscript_text ? (
        <p className="text-gray-800 whitespace-pre-wrap font-serif">
          {item.sermon_manuscript_text}
        </p>
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
                { key: 'expenses', label: 'Expenses' },
                { key: 'needed_to_meet_budget', label: 'Needed' },
                { key: 'paid', label: 'Paid' },
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
                <th className="text-right pl-3">MTD</th>
                <th className="text-right pl-3">YTD</th>
              </tr>
            </thead>
            <tbody>
              {otherFunds.map((f) => (
                <tr key={f.id}>
                  <td className="pr-3 text-gray-700">{f.name}</td>
                  <td className="text-right pl-3 text-gray-800">
                    {fmtMoney(findEntry(f.id, 'mtd')?.received)}
                  </td>
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
function PrayerSection({ categories, requests }) {
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
        <p className="text-xs text-gray-400 pt-3 border-t border-gray-100">
          To submit a prayer request, please contact the church office.
          (In-app submission coming soon.)
        </p>
      </div>
    </section>
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
                { key: 'expenses', label: 'Expenses' },
                { key: 'needed_to_meet_budget', label: 'Needed' },
                { key: 'paid', label: 'Paid' },
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
                <th className="text-right">MTD</th>
                <th className="text-right">YTD</th>
              </tr>
            </thead>
            <tbody>
              {otherFunds.map((f) => {
                const mtd = findEntry(f.id, 'mtd')?.received;
                const ytd = findEntry(f.id, 'ytd')?.received;
                if (!mtd && !ytd) return null;
                return (
                  <tr key={f.id} className="border-t border-gray-100">
                    <td className="py-1 text-gray-700">{f.name}</td>
                    <td className="text-right text-gray-800">{fmtMoney(mtd)}</td>
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
