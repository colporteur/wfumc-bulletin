import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { loadBulletinData } from '../lib/loadBulletin';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import BulletinView from './BulletinView.jsx';

// Worshipper-facing page for a specific past Sunday's bulletin.
// Route: /b/:date — date is YYYY-MM-DD (e.g., /b/2026-04-26).
export default function BulletinPage() {
  const { date } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadBulletinData(date);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (loading) return <LoadingSpinner label="Loading bulletin..." />;
  if (error) {
    return (
      <div className="card text-center space-y-3">
        <p className="text-sm text-red-700">Couldn't load the bulletin.</p>
        <p className="text-xs text-gray-500">{error}</p>
        <Link to="/archive" className="btn-secondary inline-block">
          ← Back to archive
        </Link>
      </div>
    );
  }
  if (!data?.bulletin) {
    return (
      <div className="card text-center space-y-3">
        <h1 className="font-serif text-xl text-umc-900">Bulletin not found</h1>
        <p className="text-sm text-gray-600">
          No published bulletin exists for {date}.
        </p>
        <Link to="/archive" className="btn-secondary inline-block">
          ← Back to archive
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        to="/archive"
        className="no-print inline-block text-sm text-gray-500 hover:text-gray-700"
      >
        ← All past bulletins
      </Link>
      <BulletinView data={data} />
    </div>
  );
}
