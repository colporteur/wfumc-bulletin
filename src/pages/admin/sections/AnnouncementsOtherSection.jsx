import { useEffect, useState } from 'react';
import { supabase, withTimeout } from '../../../lib/supabase';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';

const OTHER_BLOCK_TYPES = [
  { value: 'heading_body', label: 'Heading + body' },
  { value: 'personal_note', label: 'Personal note (signed)' },
  // 'image_flyer' will be added once Supabase Storage bucket is set up.
];

const otherTypeLabel = (t) =>
  OTHER_BLOCK_TYPES.find((b) => b.value === t)?.label ?? t;

export default function AnnouncementsOtherSection({ bulletin }) {
  const bulletinId = bulletin?.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [otherBlocks, setOtherBlocks] = useState([]);
  const [newAnnouncement, setNewAnnouncement] = useState('');
  const [savingAnn, setSavingAnn] = useState(false);
  const [addOtherType, setAddOtherType] = useState('heading_body');

  const load = async () => {
    if (!bulletinId) return;
    setLoading(true);
    setError(null);
    try {
      const [annRes, otherRes] = await Promise.all([
        withTimeout(
          supabase
            .from('announcements')
            .select('*')
            .eq('bulletin_id', bulletinId)
            .order('position', { ascending: true })
        ),
        withTimeout(
          supabase
            .from('other_blocks')
            .select('*')
            .eq('bulletin_id', bulletinId)
            .order('position', { ascending: true })
        ),
      ]);
      if (annRes.error) throw annRes.error;
      if (otherRes.error) throw otherRes.error;
      setAnnouncements(annRes.data ?? []);
      setOtherBlocks(otherRes.data ?? []);
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

  // ---- Announcements ----
  const addAnnouncement = async (e) => {
    e.preventDefault();
    if (!newAnnouncement.trim()) return;
    setSavingAnn(true);
    setError(null);
    try {
      const nextPos =
        announcements.length === 0
          ? 0
          : Math.max(...announcements.map((a) => a.position)) + 1;
      const { data, error: err } = await withTimeout(
        supabase
          .from('announcements')
          .insert({
            bulletin_id: bulletinId,
            position: nextPos,
            body: newAnnouncement.trim(),
          })
          .select()
          .single()
      );
      if (err) throw err;
      setAnnouncements((as) => [...as, data]);
      setNewAnnouncement('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingAnn(false);
    }
  };

  const updateAnnouncement = async (id, body) => {
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('announcements')
          .update({ body })
          .eq('id', id)
          .select()
          .single()
      );
      if (err) throw err;
      setAnnouncements((as) => as.map((a) => (a.id === id ? data : a)));
    } catch (e) {
      setError(e.message);
    }
  };

  const removeAnnouncement = async (id) => {
    if (!window.confirm('Remove this announcement?')) return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('announcements').delete().eq('id', id)
      );
      if (err) throw err;
      setAnnouncements((as) => as.filter((a) => a.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  // ---- Other blocks ----
  const addOtherBlock = async () => {
    setError(null);
    try {
      const nextPos =
        otherBlocks.length === 0
          ? 0
          : Math.max(...otherBlocks.map((b) => b.position)) + 1;
      const { data, error: err } = await withTimeout(
        supabase
          .from('other_blocks')
          .insert({
            bulletin_id: bulletinId,
            position: nextPos,
            block_type: addOtherType,
            heading: '',
            body: '',
            signature: addOtherType === 'personal_note' ? 'Pastor Todd' : null,
          })
          .select()
          .single()
      );
      if (err) throw err;
      setOtherBlocks((bs) => [...bs, data]);
    } catch (e) {
      setError(e.message);
    }
  };

  const updateOtherBlock = async (id, patch) => {
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('other_blocks')
          .update(patch)
          .eq('id', id)
          .select()
          .single()
      );
      if (err) throw err;
      setOtherBlocks((bs) => bs.map((b) => (b.id === id ? data : b)));
    } catch (e) {
      setError(e.message);
    }
  };

  const removeOtherBlock = async (id) => {
    if (!window.confirm('Remove this block?')) return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('other_blocks').delete().eq('id', id)
      );
      if (err) throw err;
      setOtherBlocks((bs) => bs.filter((b) => b.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  const moveOtherBlock = async (id, direction) => {
    setError(null);
    const idx = otherBlocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= otherBlocks.length) return;
    const a = otherBlocks[idx];
    const b = otherBlocks[swapIdx];
    try {
      const temp = -1 - idx;
      const r1 = await withTimeout(
        supabase.from('other_blocks').update({ position: temp }).eq('id', a.id)
      );
      if (r1.error) throw r1.error;
      const r2 = await withTimeout(
        supabase
          .from('other_blocks')
          .update({ position: a.position })
          .eq('id', b.id)
      );
      if (r2.error) throw r2.error;
      const r3 = await withTimeout(
        supabase
          .from('other_blocks')
          .update({ position: b.position })
          .eq('id', a.id)
      );
      if (r3.error) throw r3.error;
      setOtherBlocks((bs) => {
        const next = [...bs];
        next[idx] = { ...b, position: a.position };
        next[swapIdx] = { ...a, position: b.position };
        return next;
      });
    } catch (e) {
      setError(e.message);
      await load();
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Announcements &amp; Other</h2>
        <p className="text-sm text-gray-600 mt-1">
          Short bulleted announcements plus flexible blocks for longer items
          (heading + body, personal notes, etc.).
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {/* ANNOUNCEMENTS */}
      <div className="card">
        <h3 className="font-serif text-lg text-umc-900">Announcements</h3>
        <p className="text-xs text-gray-500 mt-1">
          One short bullet per line. Edit in place; tab away to save.
        </p>

        {announcements.length === 0 ? (
          <p className="text-sm text-gray-400 italic mt-3">
            No announcements yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {announcements.map((a) => (
              <li key={a.id} className="flex gap-2 items-start">
                <span className="text-gray-400 mt-2">•</span>
                <textarea
                  className="input flex-1 min-h-[40px]"
                  defaultValue={a.body}
                  onBlur={(e) => updateAnnouncement(a.id, e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeAnnouncement(a.id)}
                  className="text-xs text-red-600 hover:text-red-800 hover:underline mt-2"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={addAnnouncement}
          className="mt-4 pt-4 border-t border-gray-100 flex gap-2"
        >
          <input
            type="text"
            className="input flex-1"
            placeholder="New announcement"
            value={newAnnouncement}
            onChange={(e) => setNewAnnouncement(e.target.value)}
          />
          <button
            type="submit"
            disabled={savingAnn || !newAnnouncement.trim()}
            className="btn-secondary disabled:opacity-50"
          >
            {savingAnn ? 'Adding…' : '+ Add'}
          </button>
        </form>
      </div>

      {/* OTHER BLOCKS */}
      <div className="card flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-600">Add other block:</span>
        <select
          className="text-sm border border-gray-300 rounded px-2 py-1"
          value={addOtherType}
          onChange={(e) => setAddOtherType(e.target.value)}
        >
          {OTHER_BLOCK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={addOtherBlock} className="btn-primary">
          + Add
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          (Image flyers coming after image upload is set up.)
        </span>
      </div>

      {otherBlocks.map((b, i) => (
        <OtherBlockCard
          key={b.id}
          block={b}
          isFirst={i === 0}
          isLast={i === otherBlocks.length - 1}
          onUpdate={(patch) => updateOtherBlock(b.id, patch)}
          onRemove={() => removeOtherBlock(b.id)}
          onMoveUp={() => moveOtherBlock(b.id, 'up')}
          onMoveDown={() => moveOtherBlock(b.id, 'down')}
        />
      ))}
    </div>
  );
}

function OtherBlockCard({
  block,
  isFirst,
  isLast,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <span className="text-xs uppercase tracking-wide text-gray-500">
          {otherTypeLabel(block.block_type)}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className="text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed px-2"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className="text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed px-2"
            title="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-600 hover:text-red-800 hover:underline ml-2"
          >
            Remove
          </button>
        </div>
      </div>

      <div>
        <label className="label">Heading</label>
        <input
          type="text"
          className="input"
          defaultValue={block.heading ?? ''}
          onBlur={(e) => onUpdate({ heading: e.target.value || null })}
          placeholder={
            block.block_type === 'personal_note' ? 'A note from Pastor Todd' : ''
          }
        />
      </div>

      <div>
        <label className="label">Body</label>
        <textarea
          className="input min-h-[120px]"
          defaultValue={block.body ?? ''}
          onBlur={(e) => onUpdate({ body: e.target.value || null })}
        />
      </div>

      {block.block_type === 'personal_note' && (
        <div>
          <label className="label">Signature</label>
          <input
            type="text"
            className="input"
            defaultValue={block.signature ?? ''}
            onBlur={(e) => onUpdate({ signature: e.target.value || null })}
            placeholder="e.g., Pastor Todd"
          />
        </div>
      )}
    </div>
  );
}
