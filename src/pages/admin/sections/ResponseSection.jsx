import { useEffect, useRef, useState } from 'react';
import { supabase, withTimeout } from '../../../lib/supabase';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';

// Admin tab for the per-bulletin Response Prompt: prompt editor at top,
// list of submitted worshipper responses below. The social media team
// can mark each response as "used in social media" once it's been used.
export default function ResponseSection({ bulletin, refresh }) {
  const bulletinId = bulletin?.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [prompt, setPrompt] = useState(bulletin?.response_prompt ?? '');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [responses, setResponses] = useState([]);
  const [filter, setFilter] = useState('all'); // all | unused | used | with-photo

  const promptRef = useRef(null);

  // Sync prompt local state if the bulletin prop changes
  useEffect(() => {
    setPrompt(bulletin?.response_prompt ?? '');
  }, [bulletin?.response_prompt]);

  const load = async () => {
    if (!bulletinId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('responses')
          .select('*')
          .eq('bulletin_id', bulletinId)
          .order('submitted_at', { ascending: false })
      );
      if (err) throw err;
      setResponses(data ?? []);
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

  const savePrompt = async () => {
    if (!bulletinId) return;
    setSavingPrompt(true);
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase
          .from('bulletins')
          .update({ response_prompt: prompt.trim() || null })
          .eq('id', bulletinId)
      );
      if (err) throw err;
      if (refresh) await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingPrompt(false);
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Response Prompt</h2>
        <p className="text-sm text-gray-600 mt-1">
          Set this week's prompt. Worshippers can respond with text and an
          optional photo. The social media team uses these as content.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="card space-y-3">
        <h3 className="font-serif text-lg text-umc-900">This week's prompt</h3>
        <textarea
          ref={promptRef}
          className="input min-h-[80px]"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={savePrompt}
          placeholder='e.g., "What did you find meaningful in this week\'s worship?" or "What is on your heart as we enter worship this week?"'
        />
        <p className="text-xs text-gray-500">
          {savingPrompt ? 'Saving…' : 'Saves when you click out of the field.'}
        </p>
        <p className="text-xs text-gray-400">
          Leave blank to hide the response section from the worshipper view
          this week.
        </p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-serif text-lg text-umc-900">
            Responses
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({responses.length} total · {unusedCount} unused · {photoCount}{' '}
              with photo)
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
            {filtered.map((r) => (
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
                  </div>
                  <button
                    type="button"
                    onClick={() => removeResponse(r.id)}
                    className="text-xs text-red-600 hover:text-red-800 hover:underline whitespace-nowrap"
                  >
                    Remove
                  </button>
                </div>

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
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
