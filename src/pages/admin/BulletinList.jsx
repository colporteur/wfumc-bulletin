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
    let data = null;
    let err = null;
    try {
      const res = await withTimeout(
        supabase
          .from('bulletins')
          .insert({ service_date: nextSundayISO(), status: 'draft' })
          .select()
          .single()
      );
      data = res.data;
      err = res.error;
    } catch (e) {
      err = e;
    }
    setCreating(false);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
    console.log('Created bulletin', data.id);
  };

  if (!bulletins) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif text-umc-900">Bulletins</h1>
          <p className="text-sm text-gray-600 mt-1">
            One bulletin per Sunday service.
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
