import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, withTimeout } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

function fmtDate(yyyymmdd) {
  if (!yyyymmdd) return '';
  return new Date(yyyymmdd + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Public-facing sermon archive for WFUMC worshippers. Lists every
// sermon that's been preached at a published bulletin, sorted by the
// most recent preaching date.
export default function SermonArchive() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]); // [{ sermon, latestDate }]
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Strategy: pull every published bulletin's liturgy_items that
        // have a sermon_id, plus the joined sermon. Then group/dedupe
        // by sermon_id, keeping the latest service_date as the
        // representative date. We rely on the existing RLS policy
        // ("anyone can read sermons of published bulletins") to scope
        // visibility correctly.
        const { data, error: err } = await withTimeout(
          supabase
            .from('liturgy_items')
            .select(
              'sermon_id, sermon:sermons(id, title, scripture_reference, theme), bulletin:bulletins!inner(id, service_date, sunday_designation, status)'
            )
            .not('sermon_id', 'is', null)
            .eq('bulletin.status', 'published')
        );
        if (err) throw err;

        // Group by sermon_id, keep latest service_date
        const map = new Map();
        for (const row of data ?? []) {
          if (!row.sermon || !row.bulletin) continue;
          const sid = row.sermon.id;
          const existing = map.get(sid);
          if (!existing || row.bulletin.service_date > existing.latestDate) {
            map.set(sid, {
              sermon: row.sermon,
              latestDate: row.bulletin.service_date,
              latestDesignation: row.bulletin.sunday_designation,
              latestBulletinId: row.bulletin.id,
            });
          }
        }
        const list = Array.from(map.values()).sort((a, b) =>
          a.latestDate < b.latestDate ? 1 : -1
        );
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(({ sermon }) => {
        const blob = [
          sermon.title,
          sermon.scripture_reference,
          sermon.theme,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return blob.includes(q);
      })
    : items;

  if (loading) return <LoadingSpinner label="Loading sermons…" />;
  if (error) {
    return (
      <div className="card text-center space-y-3">
        <p className="text-sm text-red-700">Couldn't load sermons.</p>
        <p className="text-xs text-gray-500">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">
          ← Today's bulletin
        </Link>
        <h1 className="font-serif text-2xl text-umc-900 mt-2">
          Sermon Archive
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Every sermon preached at Wedowee First UMC, sorted by most
          recent.
        </p>
      </div>

      <div className="card no-print">
        <input
          type="text"
          className="input"
          placeholder="Search by title, scripture, or theme…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-2">
          {filtered.length === items.length
            ? `${items.length} sermon${items.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${items.length} matching`}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="card text-center text-gray-500">
          {items.length === 0
            ? 'No sermons in the archive yet.'
            : 'No sermons match that search.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map(({ sermon, latestDate, latestDesignation }) => (
            <li key={sermon.id}>
              <Link
                to={`/sermons/${sermon.id}`}
                className="card block hover:border-umc-300 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-serif text-lg text-umc-900 truncate">
                      {sermon.title || (
                        <span className="italic text-gray-400">
                          Untitled sermon
                        </span>
                      )}
                    </h2>
                    <div className="text-sm text-gray-600 mt-1 flex flex-wrap gap-x-3">
                      {sermon.scripture_reference && (
                        <span>{sermon.scripture_reference}</span>
                      )}
                      {sermon.theme && (
                        <span className="italic text-gray-500">
                          {sermon.theme}
                        </span>
                      )}
                      <span className="text-gray-500">
                        {fmtDate(latestDate)}
                      </span>
                    </div>
                    {latestDesignation && (
                      <p className="text-xs text-gray-400 mt-1">
                        {latestDesignation}
                      </p>
                    )}
                  </div>
                  <span className="text-gray-400 mt-1">→</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
