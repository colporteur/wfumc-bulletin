import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, withTimeout } from '../../lib/supabase';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { canSeeBulletinSection } from '../../lib/permissions';
import { syncBulletinFromWorshipPlan } from '../../lib/worshipPlanSync';

import CoverSection from './sections/CoverSection.jsx';
import WelcomeCalendarSection from './sections/WelcomeCalendarSection.jsx';
import PrayerRequestsSection from './sections/PrayerRequestsSection.jsx';
import LiturgySection from './sections/LiturgySection.jsx';
import StewardshipSection from './sections/StewardshipSection.jsx';
import CommunitySection from './sections/CommunitySection.jsx';
import AnnouncementsOtherSection from './sections/AnnouncementsOtherSection.jsx';
import ResponseSection from './sections/ResponseSection.jsx';

const SECTIONS = [
  { key: 'cover', label: 'Cover', Component: CoverSection },
  {
    key: 'welcome_calendar',
    label: 'Welcome & Calendar',
    Component: WelcomeCalendarSection,
  },
  {
    key: 'prayer_requests',
    label: 'Prayer Requests',
    Component: PrayerRequestsSection,
  },
  { key: 'liturgy', label: 'Order of Worship', Component: LiturgySection },
  {
    key: 'stewardship',
    label: 'Stewardship',
    Component: StewardshipSection,
  },
  { key: 'community', label: 'Community', Component: CommunitySection },
  {
    key: 'announcements_other',
    label: 'Announcements & Other',
    Component: AnnouncementsOtherSection,
  },
  { key: 'response', label: 'Response', Component: ResponseSection },
];

const statusBadgeClass = {
  draft: 'bg-gray-100 text-gray-700',
  published: 'bg-green-100 text-green-800',
  archived: 'bg-yellow-50 text-yellow-800',
};

export default function BulletinEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const [bulletin, setBulletin] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [planSyncStatus, setPlanSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  // Filter the section list to ones this user's role is allowed to see.
  // Default to the first allowed section so a music director lands on
  // Order of Worship instead of Cover.
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => canSeeBulletinSection(profile?.role, s.key)),
    [profile?.role]
  );
  const [activeSection, setActiveSection] = useState(
    () => visibleSections[0]?.key ?? 'cover'
  );

  // If the user's role changes (rare) and the current section is no
  // longer visible, jump to the first allowed one.
  useEffect(() => {
    if (
      visibleSections.length > 0 &&
      !visibleSections.find((s) => s.key === activeSection)
    ) {
      setActiveSection(visibleSections[0].key);
    }
  }, [visibleSections, activeSection]);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error: err } = await withTimeout(
        supabase.from('bulletins').select('*').eq('id', id).maybeSingle()
      );
      if (err) setError(err.message);
      setBulletin(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <LoadingSpinner />;
  if (error && !bulletin)
    return (
      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
        {error}
      </p>
    );
  if (!bulletin) return <p>Bulletin not found.</p>;

  const update = async (patch) => {
    setSaving(true);
    setError(null);
    let data = null;
    let err = null;
    try {
      const res = await withTimeout(
        supabase.from('bulletins').update(patch).eq('id', id).select().single()
      );
      data = res.data;
      err = res.error;
    } catch (e) {
      err = e;
    }
    setSaving(false);
    if (err) {
      setError(err.message);
    } else {
      setBulletin(data);
    }
  };

  const publish = () =>
    update({ status: 'published', published_at: new Date().toISOString() });
  const unpublish = () => update({ status: 'draft', published_at: null });
  const archive = () => update({ status: 'archived' });

  // Delete a draft bulletin entirely. Gated to draft status so a
  // published bulletin (which worshippers might be reading) can't be
  // accidentally nuked. Cascades clean up liturgy_items / responses /
  // check_ins via FK; preachings get bulletin_id set to null (the
  // sermon row stays put).
  const deleteDraft = async () => {
    if (bulletin.status !== 'draft') return;
    if (
      !window.confirm(
        `Delete this draft bulletin (${bulletin.service_date})? ` +
          `This removes the bulletin and its liturgy items. ` +
          `Any sermon attached stays in the Sermon Archive.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: delErr } = await withTimeout(
        supabase.from('bulletins').delete().eq('id', bulletin.id)
      );
      if (delErr) throw delErr;
      navigate('/admin/bulletins');
    } catch (e) {
      setError(e.message || String(e));
      setSaving(false);
    }
  };

  // Phase-3: pull latest scripture / theme / sermon topic from the
  // matching worship_plan into this bulletin. Asks before overwriting
  // any non-blank values so we don't clobber pastor edits.
  const refreshFromWorshipPlan = async () => {
    if (!bulletin) return;
    const overwrite = window.confirm(
      'Pull from worship plan?\n\n' +
        'OK = overwrite existing scripture / theme / sermon topic with the plan\'s values.\n' +
        'Cancel = only fill in blanks (keep what you\'ve already typed).'
    );
    setPlanSyncStatus({ kind: 'busy' });
    try {
      const result = await syncBulletinFromWorshipPlan(
        bulletin.id,
        bulletin.service_date,
        { includeSermon: true, overwrite, userId: user?.id }
      );
      if (!result.applied) {
        setPlanSyncStatus({
          kind: 'info',
          message:
            result.reason === 'no_plan'
              ? 'No worship plan found for this date.'
              : 'Worship plan matched, but nothing needed to change.',
        });
      } else {
        setPlanSyncStatus({
          kind: 'success',
          message: `Pulled from worship plan: ${result.changes.join(', ')}`,
        });
      }
    } catch (e) {
      setPlanSyncStatus({
        kind: 'error',
        message: e.message || String(e),
      });
    }
  };

  // Parse service_date as local time (not UTC) — otherwise YYYY-MM-DD strings
  // shift by a day depending on timezone.
  const prettyDate = new Date(
    bulletin.service_date + 'T00:00:00'
  ).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const ActiveComponent =
    visibleSections.find((s) => s.key === activeSection)?.Component ?? null;

  if (visibleSections.length === 0) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-6 text-center space-y-3">
        <h1 className="text-xl font-semibold text-umc-900">No bulletin sections available</h1>
        <p className="text-sm text-gray-600">
          Your role doesn't have access to any bulletin sections. If this
          looks wrong, ask Pastor Todd to update your role on the Users page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/admin/bulletins"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← All bulletins
          </Link>
          <h1 className="text-2xl font-serif text-umc-900 mt-1">
            {bulletin.sunday_designation || prettyDate}
          </h1>
          {bulletin.sunday_designation && (
            <p className="text-sm text-gray-600 mt-0.5">{prettyDate}</p>
          )}
          <span
            className={`inline-block mt-2 px-2 py-0.5 text-xs rounded ${
              statusBadgeClass[bulletin.status] || ''
            }`}
          >
            {bulletin.status}
          </span>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={refreshFromWorshipPlan}
            disabled={saving}
            className="btn-secondary disabled:opacity-50"
            title="Pull scripture / theme / sermon topic from the matching worship plan"
          >
            ↻ From worship plan
          </button>
          {bulletin.status === 'draft' && (
            <>
              <button
                onClick={publish}
                disabled={saving}
                className="btn-primary disabled:opacity-50"
              >
                Publish
              </button>
              <button
                onClick={deleteDraft}
                disabled={saving}
                className="btn-secondary text-red-600 border-red-300 hover:bg-red-50 disabled:opacity-50"
                title="Permanently delete this draft bulletin"
              >
                Delete draft
              </button>
            </>
          )}
          {bulletin.status === 'published' && (
            <>
              <button
                onClick={unpublish}
                disabled={saving}
                className="btn-secondary"
              >
                Unpublish
              </button>
              <button
                onClick={archive}
                disabled={saving}
                className="btn-secondary"
              >
                Archive
              </button>
            </>
          )}
          {bulletin.status === 'archived' && (
            <button
              onClick={unpublish}
              disabled={saving}
              className="btn-secondary"
            >
              Restore to draft
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {planSyncStatus && (
        <p
          className={`text-sm rounded px-3 py-2 flex items-center justify-between gap-3 ${
            planSyncStatus.kind === 'success'
              ? 'text-umc-900 bg-umc-50 border border-umc-200'
              : planSyncStatus.kind === 'error'
                ? 'text-red-600 bg-red-50 border border-red-200'
                : planSyncStatus.kind === 'busy'
                  ? 'text-gray-700 bg-gray-50 border border-gray-200'
                  : 'text-gray-700 bg-gray-50 border border-gray-200'
          }`}
        >
          <span>
            {planSyncStatus.kind === 'busy'
              ? 'Pulling from worship plan…'
              : planSyncStatus.message}
          </span>
          {planSyncStatus.kind !== 'busy' && (
            <button
              type="button"
              onClick={() => setPlanSyncStatus(null)}
              className="text-xs underline"
            >
              Dismiss
            </button>
          )}
        </p>
      )}

      {/* Section nav — filtered to ones the role can access */}
      <nav className="border-b border-gray-200 flex flex-wrap gap-1 -mb-px">
        {visibleSections.map((s) => {
          const active = s.key === activeSection;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setActiveSection(s.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                active
                  ? 'border-umc-700 text-umc-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* Section content */}
      <div>
        <ActiveComponent bulletin={bulletin} refresh={load} />
      </div>
    </div>
  );
}
