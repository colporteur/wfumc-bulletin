import { useEffect, useState } from 'react';
import { supabase, withTimeout } from '../../../lib/supabase';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';

const REMOVAL_MODES = [
  { value: 'auto_4weeks', label: 'Auto-remove after 4 weeks' },
  { value: 'custom_date', label: 'Remove on a specific date' },
  { value: 'staff_discretion', label: 'Keep until staff removes it' },
  { value: 'until_contacted', label: 'Keep until person is contacted' },
];

const removalModeLabel = (mode) =>
  REMOVAL_MODES.find((m) => m.value === mode)?.label ?? mode;

const PRAYER_TEXT_LIMIT = 60;

function emptyDraft(categories) {
  return {
    category_id: categories[0]?.id ?? '',
    submitter_name: '',
    is_anonymous: false,
    praying_for: '',
    situation: '',
    removal_mode: 'auto_4weeks',
    remove_after_date: '',
  };
}

export default function PrayerRequestsSection() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categories, setCategories] = useState([]);
  const [requests, setRequests] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState(emptyDraft([]));
  const [savingNew, setSavingNew] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = (r) => {
    setEditingId(r.id);
    setEditDraft({
      category_id: r.category_id ?? '',
      is_anonymous: !!r.is_anonymous,
      submitter_name: r.submitter_name ?? '',
      praying_for: r.praying_for ?? r.request_text ?? '',
      situation: r.situation ?? '',
      removal_mode: r.removal_mode ?? 'auto_4weeks',
      remove_after_date: r.remove_after_date ?? '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft) return;
    if (!editDraft.praying_for.trim()) {
      setError('"Praying For" is required.');
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('prayer_requests')
          .update({
            category_id: editDraft.category_id || null,
            is_anonymous: editDraft.is_anonymous,
            submitter_name: editDraft.is_anonymous
              ? null
              : editDraft.submitter_name.trim() || null,
            praying_for: editDraft.praying_for.trim(),
            situation: editDraft.situation.trim() || null,
            removal_mode: editDraft.removal_mode,
            remove_after_date:
              editDraft.removal_mode === 'custom_date'
                ? editDraft.remove_after_date || null
                : null,
          })
          .eq('id', editingId)
          .select()
          .single()
      );
      if (err) throw err;
      setRequests((rs) => rs.map((r) => (r.id === editingId ? data : r)));
      setEditingId(null);
      setEditDraft(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, reqs] = await Promise.all([
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
      ]);
      if (cats.error) throw cats.error;
      if (reqs.error) throw reqs.error;
      setCategories(cats.data ?? []);
      setRequests(reqs.data ?? []);
      setDraft((d) =>
        d.category_id ? d : { ...d, category_id: cats.data?.[0]?.id ?? '' }
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addRequest = async (e) => {
    e.preventDefault();
    if (!draft.praying_for.trim()) {
      setError('"Praying For" is required.');
      return;
    }
    if (!draft.category_id) {
      setError('Please choose a category.');
      return;
    }
    setSavingNew(true);
    setError(null);
    const payload = {
      category_id: draft.category_id,
      submitter_name: draft.is_anonymous ? null : draft.submitter_name || null,
      is_anonymous: draft.is_anonymous,
      praying_for: draft.praying_for.trim(),
      situation: draft.situation.trim() || null,
      removal_mode: draft.removal_mode,
      remove_after_date:
        draft.removal_mode === 'custom_date' ? draft.remove_after_date : null,
    };
    try {
      const { error: err } = await withTimeout(
        supabase.from('prayer_requests').insert(payload)
      );
      if (err) throw err;
      setDraft(emptyDraft(categories));
      setShowAddForm(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingNew(false);
    }
  };

  const removeRequest = async (id) => {
    if (!window.confirm('Remove this prayer request?')) return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase
          .from('prayer_requests')
          .update({ is_active: false, removed_at: new Date().toISOString() })
          .eq('id', id)
      );
      if (err) throw err;
      setRequests((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  const addCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setError(null);
    try {
      const maxPos = Math.max(0, ...categories.map((c) => c.position ?? 0));
      const { error: err } = await withTimeout(
        supabase.from('prayer_categories').insert({
          name: newCategoryName.trim(),
          position: maxPos + 1,
        })
      );
      if (err) throw err;
      setNewCategoryName('');
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const deactivateCategory = async (id) => {
    if (
      !window.confirm(
        'Hide this category? Existing prayer requests in it will stay visible until you remove them individually.'
      )
    )
      return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase
          .from('prayer_categories')
          .update({ is_active: false })
          .eq('id', id)
      );
      if (err) throw err;
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <LoadingSpinner />;

  const requestsByCategory = categories.map((c) => ({
    category: c,
    requests: requests.filter((r) => r.category_id === c.id),
  }));
  const orphaned = requests.filter(
    (r) => !categories.find((c) => c.id === r.category_id)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h2 className="font-serif text-xl text-umc-900">Prayer Requests</h2>
          <p className="text-sm text-gray-600 mt-1">
            Active prayer requests appear in every published bulletin until you
            remove them. Requests are shared across all bulletins, not tied to
            a specific Sunday.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="btn-primary"
        >
          {showAddForm ? 'Cancel' : '+ Add prayer request'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {showAddForm && (
        <form onSubmit={addRequest} className="card space-y-4">
          <h3 className="font-serif text-lg text-umc-900">New prayer request</h3>

          <div>
            <label className="label">Category</label>
            <select
              className="input"
              value={draft.category_id}
              onChange={(e) =>
                setDraft({ ...draft, category_id: e.target.value })
              }
            >
              {categories.length === 0 && <option value="">— none —</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">
              Praying For{' '}
              <span className="text-xs text-gray-400 font-normal">
                ({draft.praying_for.length}/{PRAYER_TEXT_LIMIT})
              </span>
            </label>
            <input
              type="text"
              className="input"
              maxLength={PRAYER_TEXT_LIMIT}
              value={draft.praying_for}
              onChange={(e) =>
                setDraft({ ...draft, praying_for: e.target.value })
              }
              placeholder="e.g., Jane Smith / The Anderson family / Missionaries in Honduras"
              required
            />
          </div>

          <div>
            <label className="label">
              Situation{' '}
              <span className="text-xs text-gray-400 font-normal">
                (optional, {draft.situation.length}/{PRAYER_TEXT_LIMIT})
              </span>
            </label>
            <input
              type="text"
              className="input"
              maxLength={PRAYER_TEXT_LIMIT}
              value={draft.situation}
              onChange={(e) =>
                setDraft({ ...draft, situation: e.target.value })
              }
              placeholder="e.g., recovering from surgery"
            />
          </div>

          <div>
            <label className="label">Submitter name</label>
            <input
              type="text"
              className="input"
              value={draft.submitter_name}
              onChange={(e) =>
                setDraft({ ...draft, submitter_name: e.target.value })
              }
              disabled={draft.is_anonymous}
              placeholder="e.g., Jane Smith — or leave blank"
            />
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.is_anonymous}
                onChange={(e) =>
                  setDraft({ ...draft, is_anonymous: e.target.checked })
                }
                className="h-4 w-4 rounded border-gray-300 text-umc-700"
              />
              <span className="text-sm text-gray-600">
                Submit anonymously (no name shown)
              </span>
            </label>
          </div>

          <div>
            <label className="label">Removal</label>
            <select
              className="input"
              value={draft.removal_mode}
              onChange={(e) =>
                setDraft({ ...draft, removal_mode: e.target.value })
              }
            >
              {REMOVAL_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {draft.removal_mode === 'custom_date' && (
              <input
                type="date"
                className="input mt-2"
                value={draft.remove_after_date}
                onChange={(e) =>
                  setDraft({ ...draft, remove_after_date: e.target.value })
                }
                required
              />
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={savingNew}
              className="btn-primary disabled:opacity-50"
            >
              {savingNew ? 'Saving…' : 'Save request'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setDraft(emptyDraft(categories));
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {requestsByCategory.map(({ category, requests: catRequests }) => (
        <div key={category.id} className="card">
          <h3 className="font-serif text-lg text-umc-900 border-b border-gray-200 pb-2 mb-3">
            {category.name}
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({catRequests.length})
            </span>
          </h3>
          {catRequests.length === 0 ? (
            <p className="text-sm text-gray-400 italic">
              No active requests in this category.
            </p>
          ) : (
            <ul className="space-y-3">
              {catRequests.map((r) => (
                <PrayerRequestRow
                  key={r.id}
                  request={r}
                  categories={categories}
                  isEditing={editingId === r.id}
                  editDraft={editDraft}
                  setEditDraft={setEditDraft}
                  savingEdit={savingEdit}
                  onStartEdit={() => startEdit(r)}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={saveEdit}
                  onRemove={() => removeRequest(r.id)}
                />
              ))}
            </ul>
          )}
        </div>
      ))}

      {orphaned.length > 0 && (
        <div className="card">
          <h3 className="font-serif text-lg text-umc-900 border-b border-gray-200 pb-2 mb-3">
            Uncategorized
          </h3>
          <ul className="space-y-3">
            {orphaned.map((r) => (
              <PrayerRequestRow
                key={r.id}
                request={r}
                categories={categories}
                isEditing={editingId === r.id}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                savingEdit={savingEdit}
                onStartEdit={() => startEdit(r)}
                onCancelEdit={cancelEdit}
                onSaveEdit={saveEdit}
                onRemove={() => removeRequest(r.id)}
              />
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <button
          type="button"
          onClick={() => setShowCategories((v) => !v)}
          className="text-sm text-umc-700 hover:text-umc-900 hover:underline"
        >
          {showCategories ? 'Hide' : 'Manage'} categories
        </button>

        {showCategories && (
          <div className="mt-4 space-y-3">
            {categories.map((c) => (
              <div
                key={c.id}
                className="flex justify-between items-center text-sm"
              >
                <span>{c.name}</span>
                <button
                  type="button"
                  onClick={() => deactivateCategory(c.id)}
                  className="text-xs text-red-600 hover:text-red-800 hover:underline"
                >
                  Hide
                </button>
              </div>
            ))}
            <form onSubmit={addCategory} className="flex gap-2 pt-2 border-t border-gray-100">
              <input
                type="text"
                className="input flex-1"
                placeholder="New category name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
              <button type="submit" className="btn-secondary text-sm">
                Add
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function PrayerRequestRow({
  request: r,
  categories,
  isEditing,
  editDraft,
  setEditDraft,
  savingEdit,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRemove,
}) {
  if (!isEditing) {
    return (
      <li className="flex justify-between items-start gap-3">
        <div className="flex-1">
          <div className="text-sm">
            <span className="font-medium text-gray-700">
              {r.is_anonymous ? 'Anonymous' : r.submitter_name || 'Unknown'}
            </span>
            <span className="text-gray-400 ml-2 text-xs">
              {new Date(r.submitted_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
          <p className="text-sm text-gray-800 mt-1">
            <span className="font-medium">
              {r.praying_for || r.request_text}
            </span>
            {r.situation && (
              <span className="text-gray-600 italic ml-2">
                — {r.situation}
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {removalModeLabel(r.removal_mode)}
            {r.remove_after_date &&
              ` (${new Date(
                r.remove_after_date + 'T00:00:00'
              ).toLocaleDateString()})`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={onStartEdit}
            className="text-xs text-umc-700 hover:text-umc-900 hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-600 hover:text-red-800 hover:underline"
          >
            Remove
          </button>
        </div>
      </li>
    );
  }

  // Editing mode
  return (
    <li className="border border-umc-200 rounded-md p-3 bg-umc-50/50 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Category</label>
          <select
            className="input"
            value={editDraft.category_id}
            onChange={(e) =>
              setEditDraft({ ...editDraft, category_id: e.target.value })
            }
          >
            <option value="">— uncategorized —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">
            Praying For{' '}
            <span className="text-xs text-gray-400 font-normal">
              ({editDraft.praying_for.length}/{PRAYER_TEXT_LIMIT})
            </span>
          </label>
          <input
            type="text"
            className="input"
            maxLength={PRAYER_TEXT_LIMIT}
            value={editDraft.praying_for}
            onChange={(e) =>
              setEditDraft({ ...editDraft, praying_for: e.target.value })
            }
          />
        </div>
      </div>

      <div>
        <label className="label">
          Situation{' '}
          <span className="text-xs text-gray-400 font-normal">
            (optional, {editDraft.situation.length}/{PRAYER_TEXT_LIMIT})
          </span>
        </label>
        <input
          type="text"
          className="input"
          maxLength={PRAYER_TEXT_LIMIT}
          value={editDraft.situation}
          onChange={(e) =>
            setEditDraft({ ...editDraft, situation: e.target.value })
          }
        />
      </div>

      <div>
        <label className="label">Submitter name</label>
        <input
          type="text"
          className="input"
          value={editDraft.submitter_name}
          onChange={(e) =>
            setEditDraft({ ...editDraft, submitter_name: e.target.value })
          }
          disabled={editDraft.is_anonymous}
          placeholder={editDraft.is_anonymous ? 'Anonymous' : ''}
        />
        <label className="flex items-center gap-2 mt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={editDraft.is_anonymous}
            onChange={(e) =>
              setEditDraft({ ...editDraft, is_anonymous: e.target.checked })
            }
            className="h-4 w-4 rounded border-gray-300 text-umc-700"
          />
          <span className="text-xs text-gray-600">Anonymous</span>
        </label>
      </div>

      <div>
        <label className="label">Removal</label>
        <select
          className="input"
          value={editDraft.removal_mode}
          onChange={(e) =>
            setEditDraft({ ...editDraft, removal_mode: e.target.value })
          }
        >
          {REMOVAL_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {editDraft.removal_mode === 'custom_date' && (
          <input
            type="date"
            className="input mt-2"
            value={editDraft.remove_after_date}
            onChange={(e) =>
              setEditDraft({
                ...editDraft,
                remove_after_date: e.target.value,
              })
            }
          />
        )}
      </div>

      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onSaveEdit}
          disabled={savingEdit}
          className="btn-primary disabled:opacity-50 text-sm"
        >
          {savingEdit ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancelEdit}
          className="btn-secondary text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onCancelEdit();
            onRemove();
          }}
          className="ml-auto text-xs text-red-600 hover:text-red-800 hover:underline"
        >
          Remove instead
        </button>
      </div>
    </li>
  );
}
