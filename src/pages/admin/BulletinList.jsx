import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, withTimeout } from '../../lib/supabase';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { syncBulletinFromWorshipPlan } from '../../lib/worshipPlanSync';
import { useAuth } from '../../contexts/AuthContext.jsx';

const statusBadgeClass = {
  draft: 'bg-gray-100 text-gray-700',
  published: 'bg-green-100 text-green-800',
  archived: 'bg-yellow-50 text-yellow-800',
};

function nextSundayISO() {
  const d = new Date();
  const day = d.getDay();
  const daysUntilSunday = (7 - day) % 7 || 7; // upcoming Sunday (skip today even if Sunday)
  d.setDate(d.getDate() + daysUntilSunday);
  return d.toISOString().slice(0, 10);
}

// Given an ISO date (YYYY-MM-DD), return the next Sunday strictly AFTER it.
function nextSundayAfter(yyyymmdd) {
  const d = new Date(yyyymmdd + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  while (d.getDay() !== 0) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export default function BulletinList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bulletins, setBulletins] = useState(null);
  const [creating, setCreating] = useState(false);
  // "From worship plan" picker state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState(null);
  const [planSyncMessage, setPlanSyncMessage] = useState(null);

  const load = async () => {
    try {
      const { data, error: err } = await withTimeout(
        supabase.from('bulletins').select('*').order('service_date', { ascending: false })
      );
      if (err) setError(err.message);
      setBulletins(data ?? []);
    } catch (e) {
      setError(e.message);
      setBulletins([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createBulletin = async () => {
    setCreating(true);
    setError(null);
    let newBulletin = null;
    let copiedFrom = null;

    try {
      // 1. Find the most recent existing bulletin. We use it for two
      //    things: deciding what date the new bulletin should be (the
      //    Sunday after the previous one), and copying its liturgy.
      const prevRes = await withTimeout(
        supabase
          .from('bulletins')
          .select('id, service_date')
          .order('service_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      );
      if (prevRes.error) throw prevRes.error;

      // 2. Pick the new service_date.
      //    - No prior bulletin → next upcoming Sunday from today.
      //    - Prior bulletin    → first Sunday strictly AFTER its date.
      const newDate = prevRes.data
        ? nextSundayAfter(prevRes.data.service_date)
        : nextSundayISO();

      // 3. Create the new bulletin row.
      const insertRes = await withTimeout(
        supabase
          .from('bulletins')
          .insert({ service_date: newDate, status: 'draft' })
          .select()
          .single()
      );
      if (insertRes.error) throw insertRes.error;
      newBulletin = insertRes.data;

      // 4. If we had a prior bulletin, copy its liturgy items over.
      //    (Sermon, stewardship, attendance, TOOLs, announcements, etc.
      //    are all per-week and intentionally NOT carried forward.)
      if (prevRes.data) {
        const itemsRes = await withTimeout(
          supabase
            .from('liturgy_items')
            .select('*')
            .eq('bulletin_id', prevRes.data.id)
            .order('position', { ascending: true })
        );
        if (itemsRes.error) throw itemsRes.error;

        const copies = (itemsRes.data ?? []).map((it) => {
          // Strip ids; assign new bulletin_id; clear sermon_id (each
          // sermon is unique to a week, lazy-created on first edit).
          // eslint-disable-next-line no-unused-vars
          const { id, bulletin_id, sermon_id, sermon, ...rest } = it;
          return {
            ...rest,
            bulletin_id: newBulletin.id,
            sermon_id: null,
          };
        });

        if (copies.length > 0) {
          const copyRes = await withTimeout(
            supabase.from('liturgy_items').insert(copies)
          );
          if (copyRes.error) throw copyRes.error;
          copiedFrom = prevRes.data.service_date;
        }
      }

      // 5. Phase-3 auto-flow: if a worship_plan exists for this date,
      //    pull in scripture + theme + sermon topic. Only fills blanks
      //    (overwrite=false) so anything copied from the prior bulletin
      //    or already typed stays put.
      try {
        const sync = await syncBulletinFromWorshipPlan(newBulletin.id, newDate, {
          includeSermon: true,
          overwrite: false,
          userId: user?.id,
        });
        if (sync.applied) {
          setPlanSyncMessage(
            `Pulled from worship plan: ${sync.changes.join(', ')}`
          );
        }
      } catch (syncErr) {
        // Non-fatal — bulletin still got created, just log it.
        // eslint-disable-next-line no-console
        console.warn('worship plan sync after create:', syncErr.message);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCreating(false);
    }

    await load();
    if (copiedFrom) {
      console.log(
        `Created bulletin ${newBulletin?.id} (liturgy copied from ${copiedFrom})`
      );
    }
  };

  if (!bulletins) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif text-umc-900">Bulletins</h1>
          <p className="text-sm text-gray-600 mt-1">
            One bulletin per Sunday service. New bulletins start with the
            order of worship copied from your most recent bulletin (sermon,
            financials, and attendance reset each week).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPickerOpen(true)}
            disabled={creating}
            className="btn-secondary disabled:opacity-50"
            title="Pick a date from the Worship Planning app's upcoming plans. Creates a bulletin for that date and pulls in scripture / theme / sermon-topic."
          >
            📋 From worship plan…
          </button>
          <button
            onClick={createBulletin}
            disabled={creating}
            className="btn-primary disabled:opacity-50"
          >
            {creating ? 'Creating...' : '+ New bulletin'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {planSyncMessage && (
        <p className="text-sm text-umc-900 bg-umc-50 border border-umc-200 rounded px-3 py-2 flex items-center justify-between gap-3">
          <span>{planSyncMessage}</span>
          <button
            type="button"
            onClick={() => setPlanSyncMessage(null)}
            className="text-xs text-umc-700 hover:text-umc-900 underline"
          >
            Dismiss
          </button>
        </p>
      )}

      {bulletins.length === 0 ? (
        <div className="card text-center text-gray-500">
          <p>No bulletins yet. Create your first one to get started.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Service date</th>
                <th className="text-left px-4 py-2">Designation</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Updated</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {bulletins.map((b) => (
                <tr key={b.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium">
                    {new Date(b.service_date + 'T00:00:00').toLocaleDateString(
                      'en-US',
                      {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      }
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {b.sunday_designation || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 text-xs rounded ${
                        statusBadgeClass[b.status] || ''
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(b.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/admin/bulletins/${b.id}`}
                      className="text-umc-700 underline text-sm"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FromWorshipPlanModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        existingDates={new Set((bulletins || []).map((b) => b.service_date))}
        onPicked={async (plan, existingBulletinId) => {
          setPickerOpen(false);
          setError(null);
          setPlanSyncMessage(null);
          try {
            let bulletinId = existingBulletinId;
            // If no bulletin yet for this date, create one (no liturgy
            // copy — for now this stays simple; pastor can copy from
            // a prior bulletin manually after).
            if (!bulletinId) {
              const insertRes = await withTimeout(
                supabase
                  .from('bulletins')
                  .insert({
                    service_date: plan.service_date,
                    status: 'draft',
                  })
                  .select()
                  .single()
              );
              if (insertRes.error) throw insertRes.error;
              bulletinId = insertRes.data.id;
            }
            // Always re-sync (overwrite=true) so the pastor's choice
            // wins. The auto-sync that runs at create time uses
            // overwrite=false so this gives a way to forcibly refresh.
            const sync = await syncBulletinFromWorshipPlan(
              bulletinId,
              plan.service_date,
              { overwrite: true, includeSermon: true, userId: user?.id }
            );
            await load();
            if (sync.applied) {
              setPlanSyncMessage(
                `${existingBulletinId ? 'Synced existing bulletin' : 'Created bulletin and synced'}: ${sync.changes.join('; ')}`
              );
            } else {
              setPlanSyncMessage(
                `${existingBulletinId ? 'Bulletin already up to date.' : 'Created bulletin (nothing to sync — plan was empty).'}`
              );
            }
            // Navigate into the new/synced bulletin so the pastor lands
            // somewhere useful.
            navigate(`/admin/bulletins/${bulletinId}`);
          } catch (e) {
            setError(e.message || String(e));
          }
        }}
      />
    </div>
  );
}

// Modal: pick an upcoming worship_plan and create or sync a bulletin
// for that date. Surfaces which dates already have a bulletin so the
// pastor knows whether they're creating new or syncing an existing one.
function FromWorshipPlanModal({ open, onClose, existingDates, onPicked }) {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(null);
  const [bulletinIdsByDate, setBulletinIdsByDate] = useState(new Map());

  useEffect(() => {
    if (!open) return;
    setPlans(null);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        // Today's date in YYYY-MM-DD (local).
        const today = new Date();
        const todayIso = new Date(
          today.getTime() - today.getTimezoneOffset() * 60000
        )
          .toISOString()
          .slice(0, 10);
        const { data, error: err } = await withTimeout(
          supabase
            .from('worship_plans')
            .select('*')
            .gte('service_date', todayIso)
            .order('service_date', { ascending: true })
            .limit(20)
        );
        if (err) throw err;
        if (cancelled) return;
        setPlans(data ?? []);
        // Pull bulletin IDs for each existing-bulletin date so picking
        // a synced row navigates to the right URL.
        const dates = (data ?? [])
          .map((p) => p.service_date)
          .filter((d) => existingDates.has(d));
        if (dates.length > 0) {
          const { data: bRows } = await withTimeout(
            supabase
              .from('bulletins')
              .select('id, service_date')
              .in('service_date', dates)
          );
          if (cancelled) return;
          const map = new Map();
          for (const b of bRows ?? []) map.set(b.service_date, b.id);
          setBulletinIdsByDate(map);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-2xl sm:rounded-lg shadow-xl flex flex-col max-h-screen sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 flex items-baseline justify-between gap-3 shrink-0">
          <div>
            <h2 className="font-serif text-lg text-umc-900">
              Create from worship plan
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Pick an upcoming Sunday from the Worship Planning app. We'll
              create the bulletin for that date and pull in scripture,
              theme, and sermon-topic from the plan.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-sm"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
              {error}
            </p>
          )}
          {plans === null ? (
            <p className="text-sm text-gray-500 italic">Loading…</p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              No upcoming worship plans found. Pick a date in the Worship
              Planning app first, then come back here.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {plans.map((p) => {
                const exists = existingDates.has(p.service_date);
                const dateLabel = new Date(
                  p.service_date + 'T00:00:00'
                ).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                return (
                  <li
                    key={p.id}
                    className="py-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-umc-900">
                        {dateLabel}
                        {exists && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                            bulletin exists
                          </span>
                        )}
                      </p>
                      <div className="text-xs text-gray-600 mt-0.5 space-y-0.5">
                        {p.scripture_reference && (
                          <p>📖 {p.scripture_reference}</p>
                        )}
                        {p.theme && <p>🎨 Theme: {p.theme}</p>}
                        {p.sermon_topic && (
                          <p>💭 Topic: {p.sermon_topic}</p>
                        )}
                        {!p.scripture_reference &&
                          !p.theme &&
                          !p.sermon_topic && (
                            <p className="italic text-gray-400">
                              (plan exists but has no scripture / theme /
                              topic yet)
                            </p>
                          )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onPicked(p, bulletinIdsByDate.get(p.service_date))
                      }
                      className="btn-primary text-xs whitespace-nowrap"
                    >
                      {exists ? 'Sync existing' : 'Create + sync'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
