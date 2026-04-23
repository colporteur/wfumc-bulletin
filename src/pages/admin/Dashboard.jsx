import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    async function load() {
      const [bulletinsRes, prayersRes, checkinsRes] = await Promise.all([
        supabase.from('bulletins').select('id, status', { count: 'exact', head: false }),
        supabase
          .from('prayer_requests')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true),
        supabase.from('check_ins').select('id', { count: 'exact', head: true }),
      ]);

      const bulletins = bulletinsRes.data ?? [];
      setCounts({
        drafts: bulletins.filter((b) => b.status === 'draft').length,
        published: bulletins.filter((b) => b.status === 'published').length,
        archived: bulletins.filter((b) => b.status === 'archived').length,
        activePrayers: prayersRes.count ?? 0,
        totalCheckIns: checkinsRes.count ?? 0,
      });
    }
    load();
  }, []);

  if (!counts) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-umc-900">
          Welcome back, {profile?.full_name?.split(' ')[0] || 'friend'}.
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Here's a snapshot of the bulletin system.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat label="Draft bulletins" value={counts.drafts} />
        <Stat label="Published bulletins" value={counts.published} />
        <Stat label="Archived bulletins" value={counts.archived} />
        <Stat label="Active prayer requests" value={counts.activePrayers} />
        <Stat label="Total check-ins" value={counts.totalCheckIns} />
      </div>

      <div className="card">
        <h2 className="font-serif text-lg text-umc-900">Quick actions</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/admin/bulletins" className="btn-primary">
            Manage bulletins
          </Link>
          <Link to="/admin/settings" className="btn-secondary">
            Settings
          </Link>
        </div>
      </div>

      <div className="card text-sm text-gray-600">
        <p>
          <strong>Heads up:</strong> this is the v0.1 scaffold. Section editors
          (cover, prayer list, liturgy, calendar, financials, etc.) arrive in
          the next build sessions. For now you can sign in, see the dashboard,
          create empty bulletins, and edit church Settings.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-serif text-umc-900">{value}</p>
    </div>
  );
}
