import { useRef, useState } from 'react';
import { supabase, withTimeout } from '../../../lib/supabase';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Returns the storage path of an image given its public URL,
// so we can delete the underlying file when the user replaces or removes it.
function pathFromPublicUrl(url) {
  if (!url) return null;
  const marker = '/object/public/bulletin-images/';
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return url.slice(idx + marker.length);
}

export default function CoverSection({ bulletin, refresh }) {
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const update = async (patch) => {
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('bulletins').update(patch).eq('id', bulletin.id)
      );
      if (err) setError(err.message);
      else await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (.jpg, .png, .webp, etc.).');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `Image is too large (${Math.round(
          file.size / (1024 * 1024)
        )} MB). Max is 10 MB.`
      );
      return;
    }

    setUploading(true);
    setError(null);
    try {
      // Build a unique path: <bulletinId>/cover-<timestamp>.<ext>
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${bulletin.id}/cover-${Date.now()}.${ext}`;

      const { error: upErr } = await withTimeout(
        supabase.storage
          .from('bulletin-images')
          .upload(path, file, { cacheControl: '3600', upsert: false }),
        30000 // images can be larger; allow 30s
      );
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage
        .from('bulletin-images')
        .getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      // If there was a previous cover, delete the old file (best-effort).
      const oldPath = pathFromPublicUrl(bulletin.cover_image_url);
      if (oldPath) {
        try {
          await supabase.storage.from('bulletin-images').remove([oldPath]);
        } catch (_) {
          // ignore — orphan files don't break anything
        }
      }

      await update({ cover_image_url: publicUrl });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      // Clear the file input so re-selecting the same file still triggers onChange
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = async () => {
    if (!bulletin.cover_image_url) return;
    if (!window.confirm('Remove the cover image?')) return;
    setError(null);

    const oldPath = pathFromPublicUrl(bulletin.cover_image_url);
    try {
      if (oldPath) {
        await supabase.storage.from('bulletin-images').remove([oldPath]);
      }
      await update({ cover_image_url: null });
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Cover</h2>
        <p className="text-sm text-gray-600 mt-1">
          What appears on the first page of the bulletin.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="card space-y-4">
        <div>
          <label className="label">Sunday designation</label>
          <input
            className="input"
            placeholder='e.g., "Third Sunday of Easter"'
            defaultValue={bulletin.sunday_designation || ''}
            onBlur={(e) =>
              update({ sunday_designation: e.target.value || null })
            }
          />
          <p className="text-xs text-gray-500 mt-1">
            Optional — leave blank if there's no special designation.
          </p>
        </div>

        <div>
          <label className="label">Service date</label>
          <input
            type="date"
            className="input"
            value={bulletin.service_date}
            onChange={(e) => update({ service_date: e.target.value })}
          />
        </div>

        <div>
          <label className="label">Service time</label>
          <input
            type="time"
            className="input"
            defaultValue={bulletin.service_time || '10:00'}
            onBlur={(e) => update({ service_time: e.target.value })}
          />
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="font-serif text-lg text-umc-900">Cover image</h3>

        {bulletin.cover_image_url ? (
          <div className="space-y-3">
            <img
              src={bulletin.cover_image_url}
              alt="Cover preview"
              className="max-h-64 rounded border border-gray-200"
            />
            <div className="flex gap-2">
              <label className="btn-secondary cursor-pointer">
                {uploading ? 'Uploading…' : 'Replace image'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFile}
                  disabled={uploading}
                />
              </label>
              <button
                type="button"
                onClick={removeImage}
                disabled={uploading}
                className="btn-secondary disabled:opacity-50"
              >
                Remove image
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label className="btn-secondary cursor-pointer inline-block">
              {uploading ? 'Uploading…' : 'Upload an image'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
                disabled={uploading}
              />
            </label>
            <p className="text-xs text-gray-500 mt-2">
              JPG, PNG, or WebP. Max 10 MB. Stored in your Supabase project.
            </p>
          </div>
        )}
      </div>

      {saving && <p className="text-xs text-gray-500">Saving…</p>}
    </div>
  );
}
