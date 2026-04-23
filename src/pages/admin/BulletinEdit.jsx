import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, withTimeout } from '../../lib/supabase';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';

export default function BulletinEdit() {
  const { id } = useParams();
  const [bulletin, setBulletin] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
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
    }
    load();
  }, [id]);

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="text-red-600">{error}</p>;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/admin/bulletins"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← All bulletins
          </Link>
          <h1 className="text-2xl font-serif text-umc-900 mt-1">
            {bulletin.sunday_designation || 'Untitled Sunday'}
          </h1>
          <p className="text-sm text-gray-600">
            Service date:{' '}
            <input
              type="date"
              value={bulletin.service_date}
              onChange={(e) => update({ service_date: e.target.value })}
              className="ml-1 text-sm border border-gray-300 rounded px-2 py-1"
            />
          </p>
        </div>
        <div className="flex gap-2">
          {bulletin.status === 'draft' && (
            <button onClick={publish} disabled={saving} className="btn-primary">
              Publish
            </button>
          )}
          {bulletin.status === 'published' && (
            <>
              <button onClick={unpublish} disabled={saving} className="btn-secondary">
                Unpublish
              </button>
              <button onClick={archive} disabled={saving} className="btn-secondary">
                Archive
              </button>
            </>
          )}
          {bulletin.status === 'archived' && (
            <button onClick={unpublish} disabled={saving} className="btn-secondary">
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

      <div className="card space-y-4">
        <div>
          <label className="label">Sunday designation</label>
          <input
            className="input"
            placeholder='e.g., "Third Sunday of Easter"'
            defaultValue={bulletin.sunday_designation || ''}
            onBlur={(e) => update({ sunday_designation: e.target.value || null })}
          />
        </div>
        <div>
          <label className="label">Service time</label>
          <input
            type="time"
            className="input"
            defaultValue={bulletin.service_time || '10:00'}
            onBlur={(e) => update({ service_time: e.target.value })}
          />
        </div>
      </div>

      <div className="card">
        <h2 className="font-serif text-lg text-umc-900">Sections</h2>
        <p className="text-sm text-gray-500 mt-2">
          The section editors (cover, prayer list, liturgy, calendar, financials,
          TOOLs, announcements) are coming in the next build sessions. The data
          model and routing are in place — we just need to build the UI.
        </p>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            'Cover',
            'Welcome / Calendar',
            'Prayer Requests',
            'Order of Worship',
            'Stewardship',
            'Community',
            'Announcements & Other',
          ].map((label) => (
            <div
              key={label}
              className="border border-dashed border-gray-300 rounded-md px-3 py-4 text-sm text-gray-500 text-center"
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
