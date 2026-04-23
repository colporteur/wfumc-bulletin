import { useState } from 'react';
import { supabase, withTimeout } from '../../../lib/supabase';

export default function CoverSection({ bulletin, refresh }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const update = async (patch) => {
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('bulletins').update(patch).eq('id', bulletin.id)
      );
      if (err) setError(err.message);
      else await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Cover</h2>
        <p className="text-sm text-gray-600 mt-1">
          What appears on the first page of the bulletin.
        </p>
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
            onBlur={(e) =>
              update({ sunday_designation: e.target.value || null })
            }
          />
          <p className="text-xs text-gray-500 mt-1">
            Optional — leave blank if there's no special designation.
          </p>
        </div>

        <div>
          <label className="label">Service date</label>
          <input
            type="date"
            className="input"
            value={bulletin.service_date}
            onChange={(e) => update({ service_date: e.target.value })}
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
        <h3 className="font-serif text-lg text-umc-900">Cover image</h3>
        <p className="text-sm text-gray-500 mt-2">
          Image upload coming soon. Will need a Supabase Storage bucket named{' '}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
            bulletin-images
          </code>
          .
        </p>
      </div>

      {saving && <p className="text-xs text-gray-500">Saving…</p>}
    </div>
  );
}
