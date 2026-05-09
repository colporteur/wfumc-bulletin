import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import {
  loadPastorLiturgyPrefs,
  upsertPastorLiturgyPrefs,
  PASTOR_LITURGY_PREFS_DEFAULTS,
  PASTOR_LITURGY_FONT_OPTIONS,
  PASTOR_LITURGY_PAGE_NUMBER_POSITIONS,
} from '../../lib/pastorLiturgyPrefs';

// Print preferences for the Pastor's Liturgy Sheet (the at-the-pulpit
// Word doc generated from selected liturgy items). Deliberately
// simpler than the Sermons app's manuscript print preferences.

export default function PastorLiturgyPrefs() {
  const { user, isPastor } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(PASTOR_LITURGY_PREFS_DEFAULTS);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const prefs = await loadPastorLiturgyPrefs(user.id);
        if (!cancelled) setDraft(prefs);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const update = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    if (!user?.id) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertPastorLiturgyPrefs(user.id, {
        font_family: draft.font_family,
        font_size_pt: Number(draft.font_size_pt),
        line_spacing: Number(draft.line_spacing),
        margin_top_in: Number(draft.margin_top_in),
        margin_bottom_in: Number(draft.margin_bottom_in),
        margin_left_in: Number(draft.margin_left_in),
        margin_right_in: Number(draft.margin_right_in),
        page_number_position: draft.page_number_position,
        header_content: draft.header_content,
        footer_content: draft.footer_content,
      });
      setDraft({ ...PASTOR_LITURGY_PREFS_DEFAULTS, ...saved });
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = () => {
    if (
      !window.confirm(
        'Reset every field on this page to the default values? Your saved preferences will be overwritten when you click Save.'
      )
    )
      return;
    setDraft({ ...PASTOR_LITURGY_PREFS_DEFAULTS });
  };

  if (!isPastor) {
    return (
      <div className="card text-sm text-gray-600">
        These preferences are only available to the pastor role.
      </div>
    );
  }

  if (loading) return <LoadingSpinner label="Loading preferences…" />;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-serif text-2xl text-umc-900">
          Pastor's Liturgy Sheet — print preferences
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Style + page layout for the Word document generated from the
          items you flag in the bulletin's order of worship. Separate
          from your sermon manuscript print preferences (which lives in
          the Sermons app).
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <fieldset className="card space-y-3">
        <legend className="text-xs uppercase tracking-wide text-gray-500 px-1">
          Typography
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-sm">
            <span className="block text-xs text-gray-600 mb-1">Font</span>
            <select
              value={draft.font_family}
              onChange={(e) => update('font_family', e.target.value)}
              className="input w-full"
            >
              {PASTOR_LITURGY_FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-gray-600 mb-1">Size (pt)</span>
            <input
              type="number"
              min="8"
              max="36"
              step="1"
              value={draft.font_size_pt}
              onChange={(e) => update('font_size_pt', e.target.value)}
              className="input w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-gray-600 mb-1">
              Line spacing
            </span>
            <input
              type="number"
              min="1.0"
              max="3.0"
              step="0.05"
              value={draft.line_spacing}
              onChange={(e) => update('line_spacing', e.target.value)}
              className="input w-full"
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="card space-y-3">
        <legend className="text-xs uppercase tracking-wide text-gray-500 px-1">
          Page margins (inches)
        </legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MarginInput
            label="Top"
            value={draft.margin_top_in}
            onChange={(v) => update('margin_top_in', v)}
          />
          <MarginInput
            label="Bottom"
            value={draft.margin_bottom_in}
            onChange={(v) => update('margin_bottom_in', v)}
          />
          <MarginInput
            label="Left"
            value={draft.margin_left_in}
            onChange={(v) => update('margin_left_in', v)}
          />
          <MarginInput
            label="Right"
            value={draft.margin_right_in}
            onChange={(v) => update('margin_right_in', v)}
          />
        </div>
      </fieldset>

      <fieldset className="card space-y-3">
        <legend className="text-xs uppercase tracking-wide text-gray-500 px-1">
          Header, footer, page numbers
        </legend>
        <label className="block text-sm">
          <span className="block text-xs text-gray-600 mb-1">
            Header text
            <span className="ml-1 text-gray-400">
              (tokens: {'{church}'}, {'{date}'}, {'{sunday}'})
            </span>
          </span>
          <input
            type="text"
            value={draft.header_content}
            onChange={(e) => update('header_content', e.target.value)}
            className="input w-full"
            placeholder="Leave blank for no header"
          />
        </label>
        <label className="block text-sm">
          <span className="block text-xs text-gray-600 mb-1">
            Footer text
            <span className="ml-1 text-gray-400">
              (tokens: {'{church}'}, {'{date}'}, {'{sunday}'})
            </span>
          </span>
          <input
            type="text"
            value={draft.footer_content}
            onChange={(e) => update('footer_content', e.target.value)}
            className="input w-full"
            placeholder="Leave blank for no footer"
          />
        </label>
        <label className="block text-sm max-w-xs">
          <span className="block text-xs text-gray-600 mb-1">
            Page numbers
          </span>
          <select
            value={draft.page_number_position}
            onChange={(e) => update('page_number_position', e.target.value)}
            className="input w-full"
          >
            {PASTOR_LITURGY_PAGE_NUMBER_POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={restoreDefaults}
          className="btn-secondary text-sm"
          disabled={saving}
        >
          Reset to defaults
        </button>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-xs text-green-700">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MarginInput({ label, value, onChange }) {
  return (
    <label className="block text-sm">
      <span className="block text-xs text-gray-600 mb-1">{label}</span>
      <input
        type="number"
        min="0.25"
        max="3.0"
        step="0.05"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full"
      />
    </label>
  );
}
