import { useEffect, useState } from 'react';
import { supabase, withTimeout } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import BulletinView from './BulletinView.jsx';

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function plusDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Step 1: get the most recent published bulletin + church settings.
        const [bulRes, setRes] = await Promise.all([
          withTimeout(
            supabase
              .from('bulletins')
              .select('*')
              .eq('status', 'published')
              .order('service_date', { ascending: false })
              .limit(1)
              .maybeSingle()
          ),
          withTimeout(
            supabase
              .from('church_settings_public')
              .select('*')
              .eq('id', 1)
              .maybeSingle()
          ),
        ]);
        if (bulRes.error) throw bulRes.error;
        if (setRes.error) throw setRes.error;

        const bulletin = bulRes.data;
        const settings = setRes.data;

        if (!bulletin) {
          if (!cancelled) {
            setData({ bulletin: null, settings });
            setLoading(false);
          }
          return;
        }

        // Step 2: load every related table in parallel.
        const bid = bulletin.id;
        const monthNow = new Date().getMonth() + 1;
        const [
          liturgyRes,
          prayerCatsRes,
          prayerReqsRes,
          eventsRes,
          weeklyRes,
          birthdaysRes,
          fundsRes,
          stewEntRes,
          attCatsRes,
          attEntRes,
          rolesRes,
          leadAssignRes,
          greetRes,
          toolsRes,
          annRes,
          otherRes,
        ] = await Promise.all([
          withTimeout(
            supabase
              .from('liturgy_items')
              .select('*, sermon:sermons(*)')
              .eq('bulletin_id', bid)
              .order('position', { ascending: true })
          ),
          withTimeout(
            supabase
              .from('prayer_categories')
              .select('*')
              .eq('is_active', true)
              .order('position', { ascending: true })
          ),
          withTimeout(
            supabase
              .from('prayer_requests')
              .select('*')
              .eq('is_active', true)
              .order('submitted_at', { ascending: false })
          ),
          withTimeout(
            supabase
              .from('calendar_events')
              .select('*')
              .gte('event_date', todayISO())
              .lte('event_date', plusDaysISO(14))
              .eq('is_published', true)
              .order('event_date', { ascending: true })
              .order('event_time', { ascending: true })
          ),
          withTimeout(
            supabase
              .from('weekly_schedule_items')
              .select('*')
              .eq('is_active', true)
              .order('day_of_week', { ascending: true })
              .order('position', { ascending: true })
          ),
          withTimeout(
            supabase
              .from('birthdays')
              .select('*')
              .eq('month', monthNow)
              .order('day', { ascending: true })
          ),
          withTimeout(
            supabase
              .from('stewardship_funds')
              .select('*')
              .eq('is_active', true)
              .order('position', { ascending: true })
          ),
          withTimeout(
            supabase.from('stewardship_entries').select('*').eq('bulletin_id', bid)
          ),
          withTimeout(
            supabase
              .from('attendance_categories')
              .select('*')
              .eq('is_active', true)
              .order('position', { ascending: true })
          ),
          withTimeout(
            supabase.from('attendance_entries').select('*').eq('bulletin_id', bid)
          ),
          withTimeout(
            supabase
              .from('leading_worship_roles')
              .select('*')
              .eq('is_active', true)
              .order('position', { ascending: true })
          ),
          withTimeout(
            supabase
              .from('leading_worship_assignments')
              .select('*')
              .eq('bulletin_id', bid)
          ),
          withTimeout(
            supabase
              .from('greeters_ushers')
              .select('*')
              .eq('bulletin_id', bid)
              .maybeSingle()
          ),
          withTimeout(
            supabase
              .from('tools_blocks')
              .select('*')
              .eq('bulletin_id', bid)
              .order('position', { ascending: true })
          ),
          withTimeout(
            supabase
              .from('announcements')
              .select('*')
              .eq('bulletin_id', bid)
              .order('position', { ascending: true })
          ),
          withTimeout(
            supabase
              .from('other_blocks')
              .select('*')
              .eq('bulletin_id', bid)
              .order('position', { ascending: true })
          ),
        ]);

        const allRes = [
          liturgyRes,
          prayerCatsRes,
          prayerReqsRes,
          eventsRes,
          weeklyRes,
          birthdaysRes,
          fundsRes,
          stewEntRes,
          attCatsRes,
          attEntRes,
          rolesRes,
          leadAssignRes,
          greetRes,
          toolsRes,
          annRes,
          otherRes,
        ];
        const errs = allRes.map((r) => r.error).filter(Boolean);
        if (errs.length) throw errs[0];

        if (cancelled) return;
        setData({
          bulletin,
          settings,
          liturgy: liturgyRes.data ?? [],
          prayerCategories: prayerCatsRes.data ?? [],
          prayerRequests: prayerReqsRes.data ?? [],
          events: eventsRes.data ?? [],
          weekly: weeklyRes.data ?? [],
          birthdays: birthdaysRes.data ?? [],
          funds: fundsRes.data ?? [],
          stewEntries: stewEntRes.data ?? [],
          attCategories: attCatsRes.data ?? [],
          attEntries: attEntRes.data ?? [],
          roles: rolesRes.data ?? [],
          leadAssignments: leadAssignRes.data ?? [],
          greeters: greetRes.data ?? null,
          toolsBlocks: toolsRes.data ?? [],
          announcements: annRes.data ?? [],
          otherBlocks: otherRes.data ?? [],
        });
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingSpinner label="Loading bulletin..." />;
  if (error) {
    return (
      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
        Couldn't load the bulletin: {error}
      </p>
    );
  }

  return <BulletinView data={data} />;
}
