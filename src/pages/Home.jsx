import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

export default function Home() {
  const [bulletin, setBulletin] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Most recent published bulletin
      const { data: b } = await supabase
        .from('bulletins')
        .select('*')
        .eq('status', 'published')
        .order('service_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      setBulletin(b);

      const { data: s } = await supabase
        .from('church_settings_public')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      setSettings(s);

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner label="Loading bulletin..." />;

  return (
    <div className="space-y-6">
      <section className="text-center py-8 border-b border-gray-200">
        <h1 className="font-serif text-2xl text-umc-900">
          {settings?.church_name ?? 'Wedowee First United Methodist Church'}
        </h1>
        {settings?.mission_statement && (
          <p className="mt-2 text-sm italic text-gray-600">
            {settings.mission_statement}
          </p>
        )}
      </section>

      {bulletin ? (
        <section className="card">
          <h2 className="text-xl font-serif text-umc-900">
            {bulletin.sunday_designation || 'Sunday Service'}
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            {new Date(bulletin.service_date).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <p className="mt-6 text-sm text-gray-500">
            Full bulletin viewer coming in the next build session. For now, the
            scaffold is up and running.
          </p>
        </section>
      ) : (
        <section className="card text-center">
          <h2 className="text-xl font-serif text-umc-900">Welcome</h2>
          <p className="mt-3 text-sm text-gray-600">
            No published bulletin yet. Check back on Sunday morning, or visit
            our church at{' '}
            <a
              href={`https://${settings?.website || 'wedoweefumc.org'}`}
              className="text-umc-700 underline"
            >
              {settings?.website || 'wedoweefumc.org'}
            </a>
            .
          </p>
        </section>
      )}

      <section className="card">
        <h3 className="font-serif text-lg text-umc-900">Watch Live</h3>
        <p className="text-sm text-gray-600 mt-2">
          Services are livestreamed on YouTube.
        </p>
        {settings?.youtube_channel_url && (
          <a
            href={settings.youtube_channel_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-3"
          >
            Visit our YouTube channel
          </a>
        )}
      </section>
    </div>
  );
}
