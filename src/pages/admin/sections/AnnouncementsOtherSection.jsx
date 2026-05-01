import { useEffect, useRef, useState } from 'react';
import { supabase, withTimeout } from '../../../lib/supabase';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';
import SortableList, { DragHandle } from '../../../components/SortableList.jsx';

const OTHER_BLOCK_TYPES = [
  { value: 'heading_body', label: 'Heading + body' },
  { value: 'personal_note', label: 'Personal note (signed)' },
  { value: 'image_flyer', label: 'Image flyer' },
];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

function pathFromImageUrl(url) {
  if (!url) return null;
  const marker = '/object/public/bulletin-images/';
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return url.slice(idx + marker.length);
}

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

  const reorderOtherBlocks = async (newOrderedIds) => {
    setError(null);
    const oldBlocks = otherBlocks;
    const newBlocks = newOrderedIds
      .map((id) => oldBlocks.find((b) => b.id === id))
      .filter(Boolean);
    setOtherBlocks(newBlocks.map((b, i) => ({ ...b, position: i })));
    try {
      await Promise.all(
        oldBlocks.map((b, i) =>
          withTimeout(
            supabase.from('other_blocks').update({ position: -1 - i }).eq('id', b.id)
          )
        )
      );
      await Promise.all(
        newBlocks.map((b, i) =>
          withTimeout(
            supabase.from('other_blocks').update({ position: i }).eq('id', b.id)
          )
        )
      );
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
      </div>

      <SortableList
        items={otherBlocks}
        onReorder={reorderOtherBlocks}
        renderItem={(b, handleProps) => (
          <OtherBlockCard
            block={b}
            onUpdate={(patch) => updateOtherBlock(b.id, patch)}
            onRemove={() => removeOtherBlock(b.id)}
            dragHandleProps={handleProps}
          />
        )}
      />
    </div>
  );
}

function OtherBlockCard({ block, onUpdate, onRemove, dragHandleProps }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const imgInputRef = useRef(null);
  const isFlyer = block.block_type === 'image_flyer';

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError(
        `Image is too large (${Math.round(file.size / (1024 * 1024))} MB). Max is 10 MB.`
      );
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `other-blocks/${block.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await withTimeout(
        supabase.storage
          .from('bulletin-images')
          .upload(path, file, { cacheControl: '3600', upsert: false }),
        30000
      );
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage
        .from('bulletin-images')
        .getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      // Best-effort cleanup of any prior image
      const oldPath = pathFromImageUrl(block.image_url);
      if (oldPath) {
        try {
          await supabase.storage.from('bulletin-images').remove([oldPath]);
        } catch {
          /* orphan file is harmless */
        }
      }
      await onUpdate({ image_url: publicUrl });
    } catch (err) {
      setUploadError(err?.message || String(err));
    } finally {
      setUploading(false);
      if (imgInputRef.current) imgInputRef.current.value = '';
    }
  };

  const removeImage = async () => {
    if (!block.image_url) return;
    if (!window.confirm('Remove this image?')) return;
    setUploadError(null);
    const oldPath = pathFromImageUrl(block.image_url);
    try {
      if (oldPath) {
        await supabase.storage.from('bulletin-images').remove([oldPath]);
      }
      await onUpdate({ image_url: null });
    } catch (err) {
      setUploadError(err?.message || String(err));
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <div className="flex items-center gap-1">
          <DragHandle handleProps={dragHandleProps} />
          <span className="text-xs uppercase tracking-wide text-gray-500">
            {otherTypeLabel(block.block_type)}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-red-600 hover:text-red-800 hover:underline"
        >
          Remove
        </button>
      </div>

      <div>
        <label className="label">
          {isFlyer ? 'Heading (optional)' : 'Heading'}
        </label>
        <input
          type="text"
          className="input"
          defaultValue={block.heading ?? ''}
          onBlur={(e) => onUpdate({ heading: e.target.value || null })}
          placeholder={
            block.block_type === 'personal_note'
              ? 'A note from Pastor Todd'
              : isFlyer
                ? 'e.g., Bake Sale Saturday'
                : ''
          }
        />
      </div>

      {isFlyer ? (
        <div>
          <label className="label">Image</label>
          {block.image_url ? (
            <div className="space-y-2">
              <img
                src={block.image_url}
                alt={block.heading ?? 'Flyer'}
                className="max-h-72 rounded border border-gray-200"
              />
              <div className="flex gap-2">
                <label className="btn-secondary text-sm cursor-pointer">
                  {uploading ? 'Uploading…' : 'Replace image'}
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={uploading}
                  />
                </label>
                <button
                  type="button"
                  onClick={removeImage}
                  disabled={uploading}
                  className="btn-secondary text-sm disabled:opacity-50"
                >
                  Remove image
                </button>
              </div>
            </div>
          ) : (
            <label className="btn-secondary text-sm cursor-pointer inline-block">
              {uploading ? 'Uploading…' : 'Upload an image'}
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
                disabled={uploading}
              />
            </label>
          )}
          {uploadError && (
            <p className="text-xs text-red-600 mt-1">{uploadError}</p>
          )}
          <p className="text-xs text-gray-500 mt-2">
            JPG, PNG, or WebP. Max 10 MB. Stored in your Supabase project.
          </p>
        </div>
      ) : (
        <div>
          <label className="label">Body</label>
          <textarea
            className="input min-h-[120px]"
            defaultValue={block.body ?? ''}
            onBlur={(e) => onUpdate({ body: e.target.value || null })}
          />
        </div>
      )}

      {isFlyer && (
        <div>
          <label className="label">Caption (optional)</label>
          <textarea
            className="input min-h-[60px]"
            defaultValue={block.body ?? ''}
            onBlur={(e) => onUpdate({ body: e.target.value || null })}
            placeholder="Optional text shown below the image."
          />
        </div>
      )}

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
