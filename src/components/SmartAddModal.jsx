import { useEffect, useMemo, useState } from 'react';
import {
  fieldsForItemType,
  smartFillSuggestion,
  applySmartEdit,
} from '../lib/suggestions';

// Smart Add — Claude-assisted incorporation of a suggestion into an
// EXISTING liturgy item.
//
// Flow:
//   1. Pastor picks which liturgy_item to modify (dropdown of existing
//      items in this bulletin's order of worship).
//   2. Pastor picks mode: Overwrite (recommended) or Append.
//   3. Click "Get suggestions from Claude" → Claude proposes new field
//      values.
//   4. Modal renders the proposals as editable form fields. Pastor
//      tweaks if needed.
//   5. Click "Commit" → write to the liturgy_item, link the suggestion.
export default function SmartAddModal({
  open,
  onClose,
  suggestion,
  bulletinId,
  serviceDate,
  liturgyItems,
  onApplied,
}) {
  const [targetId, setTargetId] = useState('');
  const [mode, setMode] = useState('overwrite');
  const [phase, setPhase] = useState('pick'); // 'pick' | 'loading' | 'review'
  const [proposed, setProposed] = useState({});
  const [edits, setEdits] = useState({});
  const [error, setError] = useState(null);
  const [committing, setCommitting] = useState(false);

  // Reset state when modal opens with a new suggestion
  useEffect(() => {
    if (open) {
      setTargetId('');
      setMode('overwrite');
      setPhase('pick');
      setProposed({});
      setEdits({});
      setError(null);
      setCommitting(false);
    }
  }, [open, suggestion?.id]);

  const target = useMemo(
    () => liturgyItems.find((i) => i.id === targetId) || null,
    [liturgyItems, targetId]
  );

  const fieldsForTarget = target ? fieldsForItemType(target.item_type) : [];

  const handleGetSuggestions = async () => {
    if (!target) {
      setError('Pick a target liturgy item first.');
      return;
    }
    setError(null);
    setPhase('loading');
    try {
      const filled = await smartFillSuggestion({
        suggestion,
        targetItem: target,
        mode,
        serviceDate,
      });
      setProposed(filled);
      // Initialize edits from the proposal — pastor will tweak from here.
      setEdits(filled);
      setPhase('review');
    } catch (e) {
      setError(e.message || String(e));
      setPhase('pick');
    }
  };

  const handleCommit = async () => {
    if (!target) return;
    // Strip undefined / fields that match current values (no-op writes).
    const fields = {};
    for (const [k, v] of Object.entries(edits)) {
      if (v === undefined) continue;
      const current = target[k];
      // Treat empty string as null
      const normalized = v === '' ? null : v;
      if (normalized !== current) fields[k] = normalized;
    }
    if (Object.keys(fields).length === 0) {
      setError('Nothing to change.');
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      await applySmartEdit({
        suggestionId: suggestion.id,
        bulletinId,
        itemId: target.id,
        fields,
      });
      onApplied?.();
      onClose?.();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCommitting(false);
    }
  };

  if (!open || !suggestion) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-2xl rounded-t-lg sm:rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-xl text-umc-900">Smart Add</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-sm"
            >
              Close
            </button>
          </div>

          {/* Suggestion summary */}
          <div className="rounded bg-amber-50/30 border border-amber-200 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">
              Suggestion
            </p>
            <p className="text-sm font-medium text-umc-900">
              {suggestion.title}
              {suggestion.suggestion_kind === 'hymn' &&
                suggestion.hymnal &&
                suggestion.hymn_number && (
                  <span className="ml-2 text-xs text-gray-600">
                    {suggestion.hymnal} {suggestion.hymn_number}
                  </span>
                )}
            </p>
            {suggestion.body && (
              <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap">
                {suggestion.body}
              </p>
            )}
          </div>

          {error && (
            <p className="rounded bg-red-50 border border-red-200 px-2 py-1 text-sm text-red-700">
              {error}
            </p>
          )}

          {/* Phase 1: pick */}
          {phase !== 'review' && (
            <>
              <div>
                <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
                  Modify which liturgy item?
                </label>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="input"
                >
                  <option value="">Pick an item…</option>
                  {liturgyItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.position}. {it.title || '(untitled)'}
                      {' — '}
                      {it.item_type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
                  Mode
                </label>
                <div className="space-y-1.5">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="mode"
                      value="overwrite"
                      checked={mode === 'overwrite'}
                      onChange={() => setMode('overwrite')}
                      className="mt-0.5"
                    />
                    <span>
                      <strong>Overwrite (Recommended)</strong> — Claude proposes
                      fresh values for every editable field on this item; pastor
                      tweaks before commit.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="mode"
                      value="append"
                      checked={mode === 'append'}
                      onChange={() => setMode('append')}
                      className="mt-0.5"
                    />
                    <span>
                      <strong>Append</strong> — keep existing fields, just append
                      the suggestion's content into the item's body.
                    </span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary text-sm"
                  disabled={phase === 'loading'}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGetSuggestions}
                  disabled={!target || phase === 'loading'}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {phase === 'loading'
                    ? 'Asking Claude…'
                    : '✨ Get suggestions from Claude'}
                </button>
              </div>
            </>
          )}

          {/* Phase 2: review */}
          {phase === 'review' && target && (
            <>
              <div className="rounded bg-umc-50 border border-umc-200 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">
                  Editing
                </p>
                <p className="text-sm font-medium text-umc-900">
                  {target.position}. {target.title || '(untitled)'}{' '}
                  <span className="text-xs text-gray-500">
                    · {target.item_type} · {mode}
                  </span>
                </p>
              </div>

              <p className="text-xs text-gray-600">
                Review Claude's proposals below. Edit any field as needed, then
                Commit.
              </p>

              <div className="space-y-3">
                {fieldsForTarget.map((f) => {
                  const proposedVal = proposed[f];
                  const editedVal = edits[f];
                  const currentVal = target[f];
                  // Only show fields that Claude proposed OR that already have a value.
                  const hasContent =
                    proposedVal !== undefined ||
                    editedVal !== undefined ||
                    (currentVal !== null && currentVal !== undefined && currentVal !== '');
                  if (!hasContent && mode === 'append') return null;
                  return (
                    <FieldEditor
                      key={f}
                      name={f}
                      value={editedVal !== undefined ? editedVal : currentVal ?? ''}
                      proposedValue={proposedVal}
                      currentValue={currentVal}
                      onChange={(v) =>
                        setEdits((prev) => ({ ...prev, [f]: v }))
                      }
                    />
                  );
                })}
                {fieldsForTarget.every((f) => proposed[f] === undefined) && (
                  <p className="text-xs text-gray-500 italic">
                    Claude didn't propose any field changes. You can still edit
                    fields manually below or cancel.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPhase('pick')}
                  className="btn-secondary text-sm"
                  disabled={committing}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={committing}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {committing ? 'Committing…' : 'Commit changes'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const FIELD_LABELS = {
  title: 'Title',
  center_text: 'Center text',
  right_text: 'Right text',
  is_starred: 'Stand if able (*)',
  inline_body: 'Body (visible)',
  expanded_detail: 'Expanded detail',
  hymn_title: 'Hymn title',
  tune_name: 'Tune name',
  hymnal_source: 'Hymnal',
  hymn_number: 'Hymn number',
  hymn_bio: 'Hymn bio',
  scripture_reference: 'Scripture reference',
  scripture_translation: 'Translation',
  scripture_text: 'Scripture text',
};

function FieldEditor({ name, value, proposedValue, currentValue, onChange }) {
  const label = FIELD_LABELS[name] || name;
  const isLong = ['inline_body', 'expanded_detail', 'scripture_text', 'hymn_bio'].includes(
    name
  );
  const isBool = name === 'is_starred';
  const isHymnal = name === 'hymnal_source';

  // Did Claude actually propose something for this field?
  const claudeTouched = proposedValue !== undefined;
  const changed =
    claudeTouched &&
    String(proposedValue ?? '') !== String(currentValue ?? '');

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="block text-xs uppercase tracking-wide text-gray-600">
          {label}
          {claudeTouched && changed && (
            <span className="ml-2 text-[10px] text-umc-700 normal-case tracking-normal">
              ✨ Claude
            </span>
          )}
          {claudeTouched && !changed && (
            <span className="ml-2 text-[10px] text-gray-400 normal-case tracking-normal">
              (unchanged)
            </span>
          )}
        </label>
      </div>
      {isBool ? (
        <label className="flex items-center gap-2 text-sm mt-1">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{value ? 'Yes' : 'No'}</span>
        </label>
      ) : isHymnal ? (
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="input"
        >
          <option value="">— none —</option>
          <option value="UMH">UMH</option>
          <option value="TFWS">TFWS</option>
        </select>
      ) : isLong ? (
        <textarea
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(10, Math.max(3, ((value ?? '') + '').split('\n').length + 1))}
          className="input font-serif"
        />
      ) : (
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="input"
        />
      )}
      {claudeTouched && changed && currentValue && (
        <p className="text-[11px] text-gray-500 mt-0.5 line-through">
          was: {String(currentValue).slice(0, 80)}
          {String(currentValue).length > 80 ? '…' : ''}
        </p>
      )}
    </div>
  );
}
