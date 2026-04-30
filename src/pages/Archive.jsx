import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listPublishedBulletins } from '../lib/loadBulletin';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

function fmtDate(yyyymmdd) {
  if (!yyyymmdd) return '';
  return new Date(yyyymmdd + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function Archive() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bulletins, setBulletins] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await listPublishedBulletins();
        if (!cancelled) setBulletins(list);
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

  if (loading) return <LoadingSpinner label="Loading archive..." />;
  if (error) {
    return (
      <div className="card text-center space-y-3">
        <p className="text-sm text-red-700">Couldn't load the archive.</p>
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
        <Link
          to="/"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Today's bulletin
        </Link>
        <h1 className="font-serif text-2xl text-umc-900 mt-2">
          Past Bulletins
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Browse every published Sunday bulletin.
        </p>
      </div>

      {bulletins.length === 0 ? (
        <div className="card text-center text-gray-500">
          <p>No published bulletins yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {bulletins.map((b) => (
            <li key={b.id}>
              <Link
                to={`/b/${b.service_date}`}
                className="card flex items-center gap-4 hover:border-umc-300 hover:shadow-md transition"
              >
                {b.cover_image_url ? (
                  <img
                    src={b.cover_image_url}
                    alt=""
                    className="w-20 h-20 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-20 h-20 rounded bg-umc-50 flex items-center justify-center flex-shrink-0">
                    <span className="font-serif text-2xl text-umc-700">
                      {new Date(b.service_date + 'T00:00:00').getDate()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="font-serif text-lg text-umc-900 truncate">
                    {b.sunday_designation || fmtDate(b.service_date)}
                  </h2>
                  {b.sunday_designation && (
                    <p className="text-sm text-gray-600">
                      {fmtDate(b.service_date)}
                    </p>
                  )}
                </div>
                <span className="text-gray-400">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
