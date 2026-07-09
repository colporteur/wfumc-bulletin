import { useEffect, useState } from 'react';
import { supabase, withTimeout } from '../lib/supabase';

// AI model registry manager — lives on the Settings page (pastor-only
// page). One shared table (ai_models, migration 0072) drives the model
// pickers in every WFUMC app: add a row here when a new model ships
// and it appears in the pickers tagged for it, no deploys.
//
// Phase B routing (implemented in the claude-proxy Edge Function):
//   anthropic rows           → native Anthropic key
//   other providers          → native key if configured (e.g., Meta),
//                              else the OpenRouter key
// Keys live in the settings form above; this card only describes
// models and where they may appear.

const PROVIDER_OPTIONS = [
  { key: 'anthropic', label: 'Anthropic (native)' },
  { key: 'meta', label: 'Meta (native key, else OpenRouter)' },
  { key: 'openrouter', label: 'OpenRouter only' },
];

const SURFACE_OPTIONS = [
  {
    key: 'manuscript',
    label: 'Manuscript writing (Sermons App revisions + eulogy tools)',
  },
  { key: 'creative', label: 'Creative Studio (brainstorm / draft)' },
];

const EMPTY_DRAFT = {
  key: '',
  provider: 'anthropic',
  model_id: '',
  openrouter_model_id: '',
  label: '',
  short_label: '',
  hint: '',
  surfaces: ['manuscript', 'creative'],
  sort_order: 100,
};

function routingLabel(row) {
  if (row.provider === 'anthropic') return 'native Anthropic';
  if (row.provider === 'openrouter') return 'OpenRouter';
  return `${row.provider} key if set, else OpenRouter`;
}

export default function AiModelsCard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await withTimeout(
          supabase
            .from('ai_models')
            .select('*')
            .order('sort_order', { ascending: true })
        );
        if (err) throw err;
        if (!cancelled) setRows(data || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  async function toggleEnabled(row) {
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('ai_models')
          .update({ enabled: !row.enabled })
          .eq('id', row.id)
          .select('*')
          .single()
      );
      if (err) throw err;
      setRows((cur) => cur.map((r) => (r.id === data.id ? data : r)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleSurface(row, surfaceKey) {
    setError(null);
    const has = (row.surfaces || []).includes(surfaceKey);
    const surfaces = has
      ? row.surfaces.filter((s) => s !== surfaceKey)
      : [...(row.surfaces || []), surfaceKey];
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('ai_models')
          .update({ surfaces })
          .eq('id', row.id)
          .select('*')
          .single()
      );
      if (err) throw err;
      setRows((cur) => cur.map((r) => (r.id === data.id ? data : r)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeRow(row) {
    if (row.model_id === null) {
      setError('The proxy-default row can be disabled, but not deleted — the pickers need a fallback.');
      return;
    }
    if (!window.confirm(`Delete "${row.label}" from the registry? Pickers using it fall back to the default.`)) {
      return;
    }
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('ai_models').delete().eq('id', row.id)
      );
      if (err) throw err;
      setRows((cur) => cur.filter((r) => r.id !== row.id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const key = draft.key.trim().toLowerCase().replace(/\s+/g, '-');
      if (!key) throw new Error('Key is required (e.g., "sonnet-6").');
      if (!draft.model_id.trim()) {
        throw new Error('Model ID is required — the exact API string, e.g., "claude-sonnet-6".');
      }
      if (!draft.label.trim()) throw new Error('Label is required.');
      const { data, error: err } = await withTimeout(
        supabase
          .from('ai_models')
          .insert({
            key,
            provider: draft.provider,
            model_id: draft.model_id.trim(),
            openrouter_model_id: draft.openrouter_model_id.trim() || null,
            label: draft.label.trim(),
            short_label: draft.short_label.trim() || draft.label.trim(),
            hint: draft.hint.trim() || null,
            surfaces: draft.surfaces,
            sort_order: Number(draft.sort_order) || 100,
          })
          .select('*')
          .single()
      );
      if (err) throw err;
      setRows((cur) =>
        [...cur, data].sort((a, b) => a.sort_order - b.sort_order)
      );
      setDraft(EMPTY_DRAFT);
      setAddOpen(false);
      setNotice(`Added "${data.label}" — it's live in the tagged pickers now.`);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="card space-y-4">
      <legend className="font-serif text-lg text-umc-900">AI Models</legend>
      <p className="text-xs text-gray-500">
        The shared model registry for every WFUMC app. Add a model here
        when a new one ships and it appears in the pickers you tag — no
        deploys. Routing prefers your native keys (Anthropic, Meta) and
        falls back to OpenRouter for anything else. The exact Model ID
        comes from the provider's docs (for OpenRouter-only rows, use
        the OpenRouter slug like "google/gemini-3.1-pro" as the Model
        ID); a wrong ID fails loudly at call time and is a one-field
        fix here.
      </p>

      {loading && <p className="text-sm text-gray-500">Loading registry…</p>}

      {!loading && (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`border rounded-md px-3 py-2 ${row.enabled ? '' : 'opacity-60'}`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{row.label}</span>
                <code className="text-xs text-gray-500">
                  {row.model_id || '(proxy default)'}
                </code>
                <span className="text-xs text-gray-400">key: {row.key}</span>
                <span
                  className="text-xs text-sky-700"
                  title={
                    row.openrouter_model_id
                      ? `OpenRouter id: ${row.openrouter_model_id}`
                      : undefined
                  }
                >
                  {routingLabel(row)}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs underline text-umc-700 hover:text-umc-900"
                    onClick={() => toggleEnabled(row)}
                  >
                    {row.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    className="text-xs underline text-red-700 hover:text-red-900"
                    onClick={() => removeRow(row)}
                  >
                    Delete
                  </button>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3">
                {SURFACE_OPTIONS.map((s) => (
                  <label
                    key={s.key}
                    className="inline-flex items-center gap-1 text-xs cursor-pointer"
                    title={s.label}
                  >
                    <input
                      type="checkbox"
                      checked={(row.surfaces || []).includes(s.key)}
                      onChange={() => toggleSurface(row, s.key)}
                    />
                    {s.key}
                  </label>
                ))}
                {row.hint && (
                  <span className="text-xs text-gray-400 italic">{row.hint}</span>
                )}
              </div>
            </div>
          ))}

          {!addOpen ? (
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setAddOpen(true)}
            >
              + Add model
            </button>
          ) : (
            <form onSubmit={handleAdd} className="border rounded-md p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-xs text-gray-600">
                  Key (stable, short)
                  <input
                    className="input text-sm mt-0.5"
                    placeholder="e.g., sonnet-6"
                    value={draft.key}
                    onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Model ID (exact API string)
                  <input
                    className="input text-sm mt-0.5"
                    placeholder="e.g., claude-sonnet-6 / muse-spark-1.1"
                    value={draft.model_id}
                    onChange={(e) => setDraft({ ...draft, model_id: e.target.value })}
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Provider (routing)
                  <select
                    className="input text-sm mt-0.5"
                    value={draft.provider}
                    onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
                  >
                    {PROVIDER_OPTIONS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  OpenRouter model ID (optional — used on fallback)
                  <input
                    className="input text-sm mt-0.5"
                    placeholder="e.g., google/gemini-3.1-pro"
                    value={draft.openrouter_model_id}
                    onChange={(e) =>
                      setDraft({ ...draft, openrouter_model_id: e.target.value })
                    }
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Label (full picker text)
                  <input
                    className="input text-sm mt-0.5"
                    placeholder="e.g., Sonnet 6 (new hotness)"
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Short label
                  <input
                    className="input text-sm mt-0.5"
                    placeholder="e.g., Sonnet 6"
                    value={draft.short_label}
                    onChange={(e) =>
                      setDraft({ ...draft, short_label: e.target.value })
                    }
                  />
                </label>
                <label className="text-xs text-gray-600 sm:col-span-2">
                  Hint (optional tooltip)
                  <input
                    className="input text-sm mt-0.5"
                    placeholder="When to reach for this one"
                    value={draft.hint}
                    onChange={(e) => setDraft({ ...draft, hint: e.target.value })}
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Sort order
                  <input
                    className="input text-sm mt-0.5"
                    type="number"
                    value={draft.sort_order}
                    onChange={(e) =>
                      setDraft({ ...draft, sort_order: e.target.value })
                    }
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                {SURFACE_OPTIONS.map((s) => (
                  <label
                    key={s.key}
                    className="inline-flex items-center gap-1 text-xs cursor-pointer"
                    title={s.label}
                  >
                    <input
                      type="checkbox"
                      checked={draft.surfaces.includes(s.key)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          surfaces: draft.surfaces.includes(s.key)
                            ? draft.surfaces.filter((x) => x !== s.key)
                            : [...draft.surfaces, s.key],
                        })
                      }
                    />
                    {s.key}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-sm" disabled={saving}>
                  {saving ? 'Adding…' : 'Add to registry'}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => {
                    setAddOpen(false);
                    setDraft(EMPTY_DRAFT);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-green-700">{notice}</p>}
    </fieldset>
  );
}
