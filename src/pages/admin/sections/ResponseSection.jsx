import { useEffect, useState } from 'react';
import { supabase, withTimeout } from '../../../lib/supabase';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';

// Admin tab for the per-bulletin Response Prompts: a list of prompts
// at the top (each editable / removable), then the list of submitted
// worshipper responses below. The social media team can mark each
// response as "used in social media" once it's been used.
//
// Multi-prompt: a bulletin can carry several prompts (sermon-tied,
// anthem-tied, open-ended). Each worshipper response remembers which
// prompt it answered.
export default function ResponseSection({ bulletin }) {
  const bulletinId = bulletin?.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [responses, setResponses] = useState([]);
  const [filter, setFilter] = useState('all'); // all | unused | used | with-photo
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bulletinId) return;
    setLoading(true);
    setError(null);
    try {
      const [promptsRes, responsesRes] = await Promise.all([
        withTimeout(
          supabase
            .from('response_prompts')
            .select('*')
            .eq('bulletin_id', bulletinId)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true })
        ),
        withTimeout(
          supabase
            .from('responses')
            .select('*')
            .eq('bulletin_id', bulletinId)
            .order('submitted_at', { ascending: false })
        ),
      ]);
      if (promptsRes.error) throw promptsRes.error;
      if (responsesRes.error) throw responsesRes.error;
      setPrompts(promptsRes.data ?? []);
      setResponses(responsesRes.data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulletinId]);

  // Map of prompt_id → prompt text (for displaying which prompt each
  // response answered). Highlights and legacy responses have no
  // prompt_id and show without this label.
  const promptById = new Map(prompts.map((p) => [p.id, p]));

  const addPrompt = async () => {
    if (!newText.trim() || !bulletinId) return;
    setBusy(true);
    setError(null);
    try {
      const nextSort =
        prompts.length === 0
          ? 0
          : (prompts[prompts.length - 1].sort_order ?? 0) + 10;
      const { data, error: err } = await withTimeout(
        supabase
          .from('response_prompts')
          .insert({
            bulletin_id: bulletinId,
            text: newText.trim(),
            sort_order: nextSort,
          })
          .select()
          .single()
      );
      if (err) throw err;
      setPrompts((ps) => [...ps, data]);
      setNewText('');
      setAdding(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const updatePromptText = async (id, text) => {
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('response_prompts')
          .update({ text })
          .eq('id', id)
          .select()
          .single()
      );
      if (err) throw err;
      setPrompts((ps) => ps.map((p) => (p.id === id ? data : p)));
    } catch (e) {
      setError(e.message);
    }
  };

  const movePrompt = async (id, direction) => {
    const idx = prompts.findIndex((p) => p.id === id);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= prompts.length) return;
    // Swap sort_order with the target prompt.
    const a = prompts[idx];
    const b = prompts[targetIdx];
    setError(null);
    try {
      await Promise.all([
        withTimeout(
          supabase
            .from('response_prompts')
            .update({ sort_order: b.sort_order })
            .eq('id', a.id)
        ),
        withTimeout(
          supabase
            .from('response_prompts')
            .update({ sort_order: a.sort_order })
            .eq('id', b.id)
        ),
      ]);
      // Optimistic local reorder.
      const next = [...prompts];
      next[idx] = { ...b, sort_order: a.sort_order };
      next[targetIdx] = { ...a, sort_order: b.sort_order };
      next.sort((x, y) => x.sort_order - y.sort_order);
      setPrompts(next);
    } catch (e) {
      setError(e.message);
    }
  };

  const removePrompt = async (id) => {
    if (
      !window.confirm(
        'Remove this prompt? Responses already submitted to it stay, but lose their prompt link.'
      )
    ) {
      return;
    }
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('response_prompts').delete().eq('id', id)
      );
      if (err) throw err;
      setPrompts((ps) => ps.filter((p) => p.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleUsed = async (id, current) => {
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('responses')
          .update({ used_in_social_media: !current })
          .eq('id', id)
          .select()
          .single()
      );
      if (err) throw err;
      setResponses((rs) => rs.map((r) => (r.id === id ? data : r)));
    } catch (e) {
      setError(e.message);
    }
  };

  const removeResponse = async (id) => {
    if (!window.confirm('Remove this response?')) return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('responses').delete().eq('id', id)
      );
      if (err) throw err;
      setResponses((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <LoadingSpinner />;

  const filtered = responses.filter((r) => {
    if (filter === 'unused') return !r.used_in_social_media;
    if (filter === 'used') return r.used_in_social_media;
    if (filter === 'with-photo') return !!r.image_url;
    return true;
  });

  const unusedCount = responses.filter((r) => !r.used_in_social_media).length;
  const photoCount = responses.filter((r) => r.image_url).length;
  const highlightCount = responses.filter((r) => r.highlighted_text).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Response Prompts</h2>
        <p className="text-sm text-gray-600 mt-1">
          Add as many prompts as you like for this bulletin. Worshippers see
          each one with its own response form.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg text-umc-900">Prompts</h3>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn-secondary text-sm"
            >
              + Add prompt
            </button>
          )}
        </div>

        {adding && (
          <div className="space-y-2 border border-dashed border-umc-300 rounded p-3 bg-umc-50/30">
            <textarea
              autoFocus
              className="input min-h-[80px]"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder='e.g., "What did you find meaningful in this week\'s sermon?"'
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addPrompt}
                disabled={busy || !newText.trim()}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {busy ? 'Adding…' : 'Add prompt'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewText('');
                }}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {prompts.length === 0 && !adding ? (
          <p className="text-sm text-gray-400 italic">
            No prompts yet. Worshippers won't see a prompt section in this
            week's bulletin until you add one.
          </p>
        ) : (
          <ul className="space-y-3">
            {prompts.map((p, idx) => (
              <li key={p.id} className="border border-gray-200 rounded p-3">
                <PromptEditor
                  prompt={p}
                  onSave={(text) => updatePromptText(p.id, text)}
                />
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => movePrompt(p.id, 'up')}
                      disabled={idx === 0}
                      className="px-1 py-0.5 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => movePrompt(p.id, 'down')}
                      disabled={idx === prompts.length - 1}
                      className="px-1 py-0.5 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <span className="text-gray-400">
                      {responses.filter((r) => r.prompt_id === p.id).length}{' '}
                      response
                      {responses.filter((r) => r.prompt_id === p.id).length === 1
                        ? ''
                        : 's'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePrompt(p.id)}
                    className="text-red-600 hover:text-red-800 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-serif text-lg text-umc-900">
            Submissions
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({responses.length} total · {unusedCount} unused · {photoCount}{' '}
              with photo · {highlightCount} highlights)
            </span>
          </h3>
          <div className="flex gap-1 text-xs">
            {[
              { value: 'all', label: 'All' },
              { value: 'unused', label: 'Unused' },
              { value: 'used', label: 'Used' },
              { value: 'with-photo', label: 'With photo' },
            ].map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`px-2 py-1 rounded ${
                  filter === f.value
                    ? 'bg-umc-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 italic">
            {responses.length === 0
              ? 'No responses yet. Once worshippers submit, they appear here.'
              : `No responses match the "${filter}" filter.`}
          </p>
        ) : (
          <ul className="space-y-4">
            {filtered.map((r) => {
              const promptForR = r.prompt_id ? promptById.get(r.prompt_id) : null;
              return (
                <li
                  key={r.id}
                  className={`border rounded-md p-3 ${
                    r.used_in_social_media
                      ? 'border-gray-200 bg-gray-50/50'
                      : 'border-umc-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <span className="font-medium text-gray-800 text-sm">
                        {r.is_anonymous
                          ? 'Anonymous'
                          : r.submitter_name || 'Unnamed'}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        {new Date(r.submitted_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                      {r.used_in_social_media && (
                        <span className="ml-2 inline-block px-2 py-0.5 text-[10px] uppercase tracking-wide rounded bg-umc-100 text-umc-900">
                          Used
                        </span>
                      )}
                      {r.highlighted_text && (
                        <span className="ml-2 inline-block px-2 py-0.5 text-[10px] uppercase tracking-wide rounded bg-amber-100 text-amber-800">
                          Highlight
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeResponse(r.id)}
                      className="text-xs text-red-600 hover:text-red-800 hover:underline whitespace-nowrap"
                    >
                      Remove
                    </button>
                  </div>

                  {promptForR && (
                    <p className="text-xs text-gray-500 italic mb-2">
                      → "{promptForR.text}"
                    </p>
                  )}

                  {r.highlighted_text && (
                    <div className="text-sm italic text-gray-800 border-l-2 border-amber-300 pl-2 mb-2">
                      "{r.highlighted_text}"
                      {r.source_label && (
                        <span className="block text-xs not-italic text-gray-500 mt-0.5">
                          from {r.source_label}
                        </span>
                      )}
                    </div>
                  )}

                  {r.response_text && (
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {r.response_text}
                    </p>
                  )}

                  {r.image_url && (
                    <div className="mt-2 space-y-1">
                      <a
                        href={r.image_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={r.image_url}
                          alt={r.caption || 'Worshipper submission'}
                          className="max-h-72 rounded border border-gray-200"
                        />
                      </a>
                      {r.caption && (
                        <p className="text-xs italic text-gray-600">
                          {r.caption}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-3 pt-2 border-t border-gray-100 flex justify-end">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={r.used_in_social_media}
                        onChange={() =>
                          toggleUsed(r.id, r.used_in_social_media)
                        }
                        className="h-4 w-4 rounded border-gray-300 text-umc-700"
                      />
                      Used in social media
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// Inline editor for a single prompt — saves on blur (mirrors the old
// single-prompt UX so it still feels light).
function PromptEditor({ prompt, onSave }) {
  const [text, setText] = useState(prompt.text);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(prompt.text);
  }, [prompt.text]);

  const save = async () => {
    if (text.trim() === prompt.text) return;
    if (!text.trim()) {
      setText(prompt.text);
      return;
    }
    setSaving(true);
    await onSave(text.trim());
    setSaving(false);
  };

  return (
    <>
      <textarea
        className="input min-h-[60px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
      {saving && <p className="text-xs text-gray-400 mt-1">Saving…</p>}
    </>
  );
}
