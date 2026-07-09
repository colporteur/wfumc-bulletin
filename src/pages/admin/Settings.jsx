import { useEffect, useState } from 'react';
import { supabase, withTimeout } from '../../lib/supabase';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import AiModelsCard from '../../components/AiModelsCard.jsx';

const FIELDS = [
  { key: 'church_name', label: 'Church name', group: 'Church identity' },
  { key: 'mission_statement', label: 'Mission statement', group: 'Church identity' },
  { key: 'street_address', label: 'Street address', group: 'Church identity' },
  { key: 'mailing_address', label: 'Mailing address', group: 'Church identity' },
  { key: 'city', label: 'City', group: 'Church identity' },
  { key: 'state', label: 'State', group: 'Church identity' },
  { key: 'zip', label: 'Zip', group: 'Church identity' },
  { key: 'phone', label: 'Phone', group: 'Church identity' },
  { key: 'fax', label: 'Fax', group: 'Church identity' },
  { key: 'website', label: 'Website (no protocol)', group: 'Church identity' },
  { key: 'office_email', label: 'Office email', group: 'Church identity' },
  { key: 'pastor_email', label: 'Pastor email', group: 'Church identity' },
  { key: 'finance_email', label: 'Finance email', group: 'Church identity' },
  { key: 'office_hours', label: 'Office hours', group: 'Church identity' },

  { key: 'youtube_channel_url', label: 'YouTube channel URL', group: 'Online' },
  { key: 'youtube_livestream_url', label: 'YouTube livestream URL', group: 'Online' },
  { key: 'tithely_url', label: 'Tithe.ly (online giving) URL', group: 'Online' },
  { key: 'facebook_url', label: 'Facebook URL', group: 'Online' },

  { key: 'ccli_streaming_license', label: 'CCLI Streaming License #', group: 'Licenses' },
  { key: 'ccli_copyright_license', label: 'CCLI Copyright License #', group: 'Licenses' },
  { key: 'onelicense_number', label: 'OneLicense #', group: 'Licenses' },

  {
    key: 'default_scripture_translation',
    label: 'Default scripture translation',
    group: 'Defaults',
  },

  {
    key: 'anthropic_api_key',
    label: 'Anthropic API key (for Claude-assist)',
    group: 'AI Assist',
    type: 'password',
    helpText: 'Stored encrypted server-side. Never sent to the worshipper-facing app.',
  },
  {
    key: 'openrouter_api_key',
    label: 'OpenRouter API key (fallback for non-Anthropic models)',
    group: 'AI Assist',
    type: 'password',
    helpText:
      'Universal fallback: any registry model without a native key routes through OpenRouter. Server-side only, same as the Anthropic key.',
  },
  {
    key: 'meta_api_key',
    label: 'Meta Model API key (native — Muse Spark)',
    group: 'AI Assist',
    type: 'password',
    helpText:
      'Native key for api.meta.ai (Muse Spark is not on OpenRouter). When set, Meta-provider models route here in preference to OpenRouter.',
  },

  {
    key: 'welcome_blurb',
    label: 'Welcome blurb (printed on the Welcome page)',
    group: 'Defaults',
    type: 'textarea',
  },
];

const TOGGLES = [
  {
    key: 'search_indexing_enabled',
    label: 'Allow search engines to index this site',
    helpText:
      'Off by default. When off, a noindex meta tag and a robots.txt disallow tell Google/Bing not to index. Anyone with the URL can still visit.',
  },
];

export default function Settings() {
  const { isPastor } = useAuth();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data, error: err } = await withTimeout(
          supabase.from('church_settings').select('*').eq('id', 1).maybeSingle()
        );
        if (err) setError(err.message);
        setSettings(data);
        setDraft(data || {});
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!isPastor) {
    return (
      <p className="text-sm text-gray-600">
        Only the pastor role can edit settings.
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
        {error}
      </p>
    );
  }

  const groups = [...new Set(FIELDS.map((f) => f.group))];

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    let data = null;
    let err = null;
    try {
      const res = await withTimeout(
        supabase.from('church_settings').update(draft).eq('id', 1).select().single()
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
      setSettings(data);
      setSavedAt(new Date());
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-umc-900">Church Settings</h1>
        <p className="text-sm text-gray-600 mt-1">
          Pastor-only. Updates here propagate to every bulletin.
        </p>
      </div>

      {groups.map((group) => (
        <fieldset key={group} className="card space-y-4">
          <legend className="font-serif text-lg text-umc-900">{group}</legend>
          {FIELDS.filter((f) => f.group === group).map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={f.key}>
                {f.label}
              </label>
              {f.type === 'textarea' ? (
                <textarea
                  id={f.key}
                  className="input min-h-[120px]"
                  value={draft[f.key] ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, [f.key]: e.target.value })
                  }
                />
              ) : (
                <input
                  id={f.key}
                  type={f.type === 'password' ? 'password' : 'text'}
                  className="input"
                  value={draft[f.key] ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, [f.key]: e.target.value })
                  }
                  autoComplete={f.type === 'password' ? 'new-password' : undefined}
                />
              )}
              {f.helpText && (
                <p className="text-xs text-gray-500 mt-1">{f.helpText}</p>
              )}
            </div>
          ))}
        </fieldset>
      ))}

      <fieldset className="card space-y-4">
        <legend className="font-serif text-lg text-umc-900">Behavior</legend>
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-umc-700"
              checked={!!draft[t.key]}
              onChange={(e) => setDraft({ ...draft, [t.key]: e.target.checked })}
            />
            <span>
              <span className="text-sm font-medium text-gray-700">{t.label}</span>
              {t.helpText && (
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t.helpText}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-4">
        <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? 'Saving...' : 'Save settings'}
        </button>
        {savedAt && (
          <span className="text-sm text-gray-500">
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        )}
      </div>
    </form>

    {/* Shared AI model registry — outside the settings form because it
        manages its own table (ai_models) with its own save actions. */}
    <AiModelsCard />
    </div>
  );
}
