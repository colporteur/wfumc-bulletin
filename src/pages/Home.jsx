import { useEffect, useState } from 'react';
import { supabase, withTimeout } from '../lib/supabase';
import { loadBulletinData } from '../lib/loadBulletin';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import BulletinView from './BulletinView.jsx';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadBulletinData();
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
  }, []);

  // Lightweight refresher used after worshippers submit a prayer request,
  // so the new request shows up in the visible list without a full reload.
  const refreshPrayerRequests = async () => {
    try {
      const { data: reqs, error: err } = await withTimeout(
        supabase
          .from('prayer_requests')
          .select('*')
          .eq('is_active', true)
          .order('submitted_at', { ascending: false })
      );
      if (err) return;
      setData((d) => (d ? { ...d, prayerRequests: reqs ?? [] } : d));
    } catch {
      // Best-effort — if it fails we just don't refresh; user can reload.
    }
  };

  if (loading) return <LoadingSpinner label="Loading bulletin..." />;
  if (error) {
    return (
      <div className="card text-center space-y-3">
        <p className="text-sm text-red-700">
          Couldn't load the bulletin.
        </p>
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
    <BulletinView
      data={data}
      onPrayerSubmitted={refreshPrayerRequests}
    />
  );
}
