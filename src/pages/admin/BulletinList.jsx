import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, withTimeout } from '../../lib/supabase';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';

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
  const [bulletins, setBulletins] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

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
        <button
          onClick={createBulletin}
          disabled={creating}
          className="btn-primary disabled:opacity-50"
        >
          {creating ? 'Creating...' : '+ New bulletin'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
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
    </div>
  );
}
