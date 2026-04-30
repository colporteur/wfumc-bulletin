import { useEffect, useRef, useState } from 'react';
import { supabase, withTimeout, callClaude } from '../../../lib/supabase';
import { downsizeImage, blobToBase64 } from '../../../lib/imageHelpers';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';

// =====================================================================
// Liturgy editor for a single bulletin's Order of Worship.
//
// Implemented in this session:
//   - List items in order, collapsible cards
//   - Add new item (with type), reorder with ↑/↓, remove
//   - Star toggle (* "you may stand if able")
//   - Type-specific fields (hymn, scripture, sermon, etc.)
//   - Inline body + click-to-expand detail
//   - One-click "seed default order of worship" for empty bulletins
//
// Deferred to follow-up sessions:
//   - Drag-and-drop reordering (the arrows work for now)
//   - Claude-assist auto-fill for hymn lyrics, scripture text, etc.
//   - Sermon manuscript file upload (textarea works in the meantime)
// =====================================================================

const ITEM_TYPES = [
  { value: 'generic', label: 'Generic' },
  { value: 'hymn', label: 'Hymn' },
  { value: 'music', label: 'Music (instrumental / anthem)' },
  { value: 'scripture', label: 'Scripture reading' },
  { value: 'prayer_text', label: 'Prayer / responsive text' },
  { value: 'responsive_reading', label: 'Responsive reading' },
  { value: 'communion', label: 'Communion' },
  { value: 'sermon', label: 'Sermon' },
  { value: 'giving', label: 'Giving / offering' },
];

const itemTypeLabel = (t) =>
  ITEM_TYPES.find((x) => x.value === t)?.label ?? t;

// Standard 24-item Order of Worship to seed an empty bulletin.
// Pastor Todd can edit / reorder / delete after seeding.
const DEFAULT_ITEMS = [
  { item_type: 'music', title: 'Prelude', is_starred: false },
  { item_type: 'generic', title: 'Lighting of Candles', is_starred: false },
  { item_type: 'music', title: 'Introit', is_starred: false },
  { item_type: 'generic', title: 'Greeting', is_starred: false },
  { item_type: 'responsive_reading', title: 'Call to Worship', is_starred: true },
  { item_type: 'hymn', title: 'Opening Hymn', is_starred: true },
  { item_type: 'prayer_text', title: 'Affirmation of Faith', is_starred: true },
  {
    item_type: 'hymn',
    title: 'Gloria Patri',
    is_starred: true,
    hymnal_source: 'UMH',
    hymn_number: '70',
  },
  { item_type: 'prayer_text', title: 'Pastoral Prayer', is_starred: false },
  { item_type: 'prayer_text', title: "The Lord's Prayer", is_starred: false },
  { item_type: 'music', title: 'Anthem', is_starred: false },
  { item_type: 'generic', title: "Children's Time", is_starred: false },
  { item_type: 'scripture', title: 'Scripture Reading', is_starred: false },
  { item_type: 'hymn', title: 'Hymn of Preparation', is_starred: true },
  { item_type: 'sermon', title: 'Sermon', is_starred: false },
  { item_type: 'hymn', title: 'Hymn of Response', is_starred: true },
  { item_type: 'generic', title: 'Joys & Concerns', is_starred: false },
  { item_type: 'prayer_text', title: 'Prayers of the People', is_starred: false },
  {
    item_type: 'giving',
    title: 'Giving of Our Tithes and Offerings',
    is_starred: false,
  },
  { item_type: 'music', title: 'Offertory', is_starred: false },
  {
    item_type: 'hymn',
    title: 'Doxology',
    is_starred: true,
    hymnal_source: 'UMH',
    hymn_number: '95',
  },
  { item_type: 'hymn', title: 'Closing Hymn', is_starred: true },
  { item_type: 'generic', title: 'Benediction', is_starred: false },
  { item_type: 'music', title: 'Postlude', is_starred: false },
];

export default function LiturgySection({ bulletin }) {
  const bulletinId = bulletin?.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [addType, setAddType] = useState('generic');
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    if (!bulletinId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('liturgy_items')
          .select('*, sermon:sermons(*)')
          .eq('bulletin_id', bulletinId)
          .order('position', { ascending: true })
      );
      if (err) throw err;
      setItems(data ?? []);
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

  const seedDefaults = async () => {
    if (
      !window.confirm(
        'Seed the standard 24-item Order of Worship? You can edit, reorder, or delete any of them after.'
      )
    )
      return;
    setSeeding(true);
    setError(null);
    try {
      const rows = DEFAULT_ITEMS.map((it, i) => ({
        ...it,
        bulletin_id: bulletinId,
        position: i,
      }));
      const { error: err } = await withTimeout(
        supabase.from('liturgy_items').insert(rows)
      );
      if (err) throw err;
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSeeding(false);
    }
  };

  const addItem = async () => {
    setError(null);
    try {
      const nextPos =
        items.length === 0 ? 0 : Math.max(...items.map((i) => i.position)) + 1;
      const { data, error: err } = await withTimeout(
        supabase
          .from('liturgy_items')
          .insert({
            bulletin_id: bulletinId,
            position: nextPos,
            item_type: addType,
            title: '',
          })
          .select()
          .single()
      );
      if (err) throw err;
      setItems((xs) => [...xs, data]);
      setExpandedId(data.id);
    } catch (e) {
      setError(e.message);
    }
  };

  const updateItem = async (id, patch) => {
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('liturgy_items')
          .update(patch)
          .eq('id', id)
          .select('*, sermon:sermons(*)')
          .single()
      );
      if (err) throw err;
      setItems((xs) => xs.map((x) => (x.id === id ? data : x)));
    } catch (e) {
      setError(e.message);
    }
  };

  // For sermon items: write goes to the sermons table (not liturgy_items).
  // If the item doesn't yet have a sermon_id, lazy-create the sermon row
  // and link it back to the liturgy item.
  const updateSermonForItem = async (item, patch) => {
    setError(null);
    try {
      if (!item.sermon_id) {
        const { data: sermon, error: createErr } = await withTimeout(
          supabase.from('sermons').insert(patch).select().single()
        );
        if (createErr) throw createErr;

        const { data: updItem, error: linkErr } = await withTimeout(
          supabase
            .from('liturgy_items')
            .update({ sermon_id: sermon.id })
            .eq('id', item.id)
            .select('*, sermon:sermons(*)')
            .single()
        );
        if (linkErr) throw linkErr;

        setItems((xs) => xs.map((x) => (x.id === item.id ? updItem : x)));
      } else {
        const { data: sermon, error: updErr } = await withTimeout(
          supabase
            .from('sermons')
            .update(patch)
            .eq('id', item.sermon_id)
            .select()
            .single()
        );
        if (updErr) throw updErr;

        setItems((xs) =>
          xs.map((x) => (x.id === item.id ? { ...x, sermon } : x))
        );
      }
    } catch (e) {
      setError(e.message);
    }
  };

  const removeItem = async (id) => {
    if (!window.confirm('Remove this item from the order of worship?')) return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('liturgy_items').delete().eq('id', id)
      );
      if (err) throw err;
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  const moveItem = async (id, direction) => {
    setError(null);
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;

    const a = items[idx];
    const b = items[swapIdx];
    try {
      const temp = -1 - idx;
      const r1 = await withTimeout(
        supabase.from('liturgy_items').update({ position: temp }).eq('id', a.id)
      );
      if (r1.error) throw r1.error;
      const r2 = await withTimeout(
        supabase
          .from('liturgy_items')
          .update({ position: a.position })
          .eq('id', b.id)
      );
      if (r2.error) throw r2.error;
      const r3 = await withTimeout(
        supabase
          .from('liturgy_items')
          .update({ position: b.position })
          .eq('id', a.id)
      );
      if (r3.error) throw r3.error;
      setItems((xs) => {
        const next = [...xs];
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
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Order of Worship</h2>
        <p className="text-sm text-gray-600 mt-1">
          The full liturgy. Click any item to expand and edit its details.
          Items with a <span className="font-semibold">*</span> are "stand if
          able".
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <div className="card text-center space-y-3">
          <p className="text-gray-600">
            This bulletin has no order of worship yet.
          </p>
          <button
            type="button"
            onClick={seedDefaults}
            disabled={seeding}
            className="btn-primary disabled:opacity-50"
          >
            {seeding
              ? 'Seeding…'
              : 'Seed standard 24-item Order of Worship'}
          </button>
          <p className="text-xs text-gray-500">
            You can edit, reorder, or delete any of them afterward.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <LiturgyItemCard
              key={it.id}
              item={it}
              expanded={expandedId === it.id}
              onToggle={() =>
                setExpandedId((x) => (x === it.id ? null : it.id))
              }
              isFirst={i === 0}
              isLast={i === items.length - 1}
              onUpdate={(patch) => updateItem(it.id, patch)}
              onUpdateSermon={(patch) => updateSermonForItem(it, patch)}
              onRemove={() => removeItem(it.id)}
              onMoveUp={() => moveItem(it.id, 'up')}
              onMoveDown={() => moveItem(it.id, 'down')}
            />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-600">Add item:</span>
          <select
            className="text-sm border border-gray-300 rounded px-2 py-1"
            value={addType}
            onChange={(e) => setAddType(e.target.value)}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={addItem} className="btn-primary">
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Item card
// ---------------------------------------------------------------------

function LiturgyItemCard({
  item,
  expanded,
  onToggle,
  isFirst,
  isLast,
  onUpdate,
  onUpdateSermon,
  onRemove,
  onMoveUp,
  onMoveDown,
}) {
  return (
    <div
      className={`bg-white rounded-lg border ${
        expanded ? 'border-umc-700' : 'border-gray-200'
      } shadow-sm`}
    >
      {/* Collapsed header — always visible */}
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 text-left hover:bg-gray-50 -mx-2 px-2 py-1 rounded"
        >
          <span className="text-gray-400 text-xs w-4 text-center">
            {expanded ? '▾' : '▸'}
          </span>
          {item.is_starred && (
            <span className="font-semibold text-umc-700">*</span>
          )}
          <span className="font-medium text-gray-800">
            {item.title || (
              <span className="italic text-gray-400">untitled</span>
            )}
          </span>
          {item.right_text && (
            <span className="text-gray-500 text-sm ml-2">
              — {item.right_text}
            </span>
          )}
          <span className="ml-auto text-xs uppercase tracking-wide text-gray-400">
            {item.item_type}
          </span>
        </button>
        <div className="flex gap-1 items-center">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className="text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed px-1"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className="text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed px-1"
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

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4 bg-gray-50">
          <CommonFields item={item} onUpdate={onUpdate} />
          <TypeSpecificFields
            item={item}
            onUpdate={onUpdate}
            onUpdateSermon={onUpdateSermon}
          />
          <ExpandableFields item={item} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Common fields — present for every item type
// ---------------------------------------------------------------------

function CommonFields({ item, onUpdate }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label className="label">Title (left side)</label>
          <input
            type="text"
            className="input"
            defaultValue={item.title ?? ''}
            onBlur={(e) => onUpdate({ title: e.target.value })}
            placeholder="e.g., Opening Hymn"
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={item.item_type}
            onChange={(e) => onUpdate({ item_type: e.target.value })}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Center text (optional)</label>
          <input
            type="text"
            className="input"
            defaultValue={item.center_text ?? ''}
            onBlur={(e) =>
              onUpdate({ center_text: e.target.value || null })
            }
            placeholder="Optional middle column"
          />
        </div>
        <div>
          <label className="label">Right text (person / hymn # / etc.)</label>
          <input
            type="text"
            className="input"
            defaultValue={item.right_text ?? ''}
            onBlur={(e) => onUpdate({ right_text: e.target.value || null })}
            placeholder="e.g., Pastor Todd / UMH 89"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!item.is_starred}
          onChange={(e) => onUpdate({ is_starred: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-umc-700"
        />
        <span className="text-sm text-gray-700">
          Star this item (* "you may stand if able")
        </span>
      </label>
    </>
  );
}

// ---------------------------------------------------------------------
// Type-specific fields
// ---------------------------------------------------------------------

function TypeSpecificFields({ item, onUpdate, onUpdateSermon }) {
  switch (item.item_type) {
    case 'hymn':
      return <HymnFields item={item} onUpdate={onUpdate} />;
    case 'scripture':
      return <ScriptureFields item={item} onUpdate={onUpdate} />;
    case 'sermon':
      return <SermonFields sermon={item.sermon} onUpdate={onUpdateSermon} />;
    default:
      return null;
  }
}

function HymnFields({ item, onUpdate }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [fillError, setFillError] = useState(null);
  const [fillNote, setFillNote] = useState(null);
  const fileInputRef = useRef(null);

  // Local mirrors so external updates (Claude vision / cache) appear immediately
  const [hymnTitle, setHymnTitle] = useState(item.hymn_title ?? '');
  const [tuneName, setTuneName] = useState(item.tune_name ?? '');
  const [hymnBio, setHymnBio] = useState(item.hymn_bio ?? '');

  // Sync local mirrors when item props change externally
  useEffect(() => setHymnTitle(item.hymn_title ?? ''), [item.hymn_title]);
  useEffect(() => setTuneName(item.tune_name ?? ''), [item.tune_name]);
  useEffect(() => setHymnBio(item.hymn_bio ?? ''), [item.hymn_bio]);

  // Auto-fill from hymn_cache when hymnal + number are both set AND the
  // hymn fields are still empty (don't overwrite existing data silently).
  useEffect(() => {
    const source = item.hymnal_source;
    const number = item.hymn_number?.trim();
    if (!source || !number) return;
    if (item.hymn_title || item.tune_name) return; // already filled

    let cancelled = false;
    (async () => {
      try {
        const { data } = await withTimeout(
          supabase
            .from('hymn_cache')
            .select('*')
            .eq('hymnal_source', source)
            .eq('hymn_number', number)
            .maybeSingle()
        );
        if (cancelled || !data) return;

        const updates = {};
        if (data.hymn_title) {
          updates.hymn_title = data.hymn_title;
          setHymnTitle(data.hymn_title);
        }
        if (data.tune_name) {
          updates.tune_name = data.tune_name;
          setTuneName(data.tune_name);
        }
        if (data.hymn_bio) {
          updates.hymn_bio = data.hymn_bio;
          setHymnBio(data.hymn_bio);
        }
        if (data.lyrics) {
          updates.expanded_detail = data.lyrics;
        }
        if (Object.keys(updates).length > 0) {
          onUpdate(updates);
          setFillNote('Auto-filled from saved hymn cache.');
        }
      } catch {
        // Silent — cache miss is fine, photo upload still works.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.hymnal_source, item.hymn_number]);

  const handleHymnImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setFillError('Please select an image file.');
      return;
    }

    setAnalyzing(true);
    setFillError(null);
    setFillNote(null);

    try {
      // Downscale + base64 encode
      const blob = await downsizeImage(file, 1600, 0.85);
      const base64 = await blobToBase64(blob);

      const hymnalContext = item.hymnal_source
        ? `from the ${item.hymnal_source === 'UMH' ? 'United Methodist Hymnal' : 'The Faith We Sing'}`
        : 'from a hymnal';
      const numberContext = item.hymn_number
        ? `(it should be hymn #${item.hymn_number})`
        : '';

      const result = await callClaude({
        system:
          "You are reading a photo of a hymnal page to help prepare a church bulletin. Look at the image carefully and return ONLY a JSON object — no markdown code fences, no commentary. Schema: { \"title\": string, \"tune_name\": string, \"author\": string, \"composer\": string, \"year\": string, \"bio\": string, \"lyrics\": string }. For 'lyrics', use plain text with each verse prefixed by [1], [2], [3]... and a blank line between verses. Include refrains exactly as printed (label them 'Refrain:'). For 'bio', a short factual note (1-2 sentences) about the hymn or its background. Do NOT fabricate; if you can't read part of the page, leave that field empty.",
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `This is a hymn page ${hymnalContext} ${numberContext}. Please read it carefully and return the JSON.`,
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: base64,
                },
              },
            ],
          },
        ],
        max_tokens: 4000,
      });

      const text = result?.content?.[0]?.text?.trim();
      if (!text) throw new Error('Claude returned no text.');

      // Strip markdown code fences if present despite the system prompt
      let jsonStr = text;
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) jsonStr = m[1].trim();

      let data;
      try {
        data = JSON.parse(jsonStr);
      } catch {
        throw new Error('Claude returned invalid JSON. Try again or fill manually.');
      }

      const updates = {};
      const filledFields = [];

      if (data.title) {
        updates.hymn_title = data.title;
        setHymnTitle(data.title);
        filledFields.push('title');
      }
      if (data.tune_name) {
        updates.tune_name = data.tune_name;
        setTuneName(data.tune_name);
        filledFields.push('tune');
      }
      const bioParts = [];
      if (data.author) bioParts.push(`Words by ${data.author}`);
      if (data.composer) bioParts.push(`Tune by ${data.composer}`);
      if (data.year) bioParts.push(`(${data.year})`);
      if (data.bio) bioParts.push(data.bio);
      const bio = bioParts.join(' • ').trim();
      if (bio) {
        updates.hymn_bio = bio;
        setHymnBio(bio);
        filledFields.push('bio');
      }
      if (data.lyrics) {
        updates.expanded_detail = data.lyrics;
        filledFields.push('lyrics');
      }

      if (Object.keys(updates).length === 0) {
        setFillError("Claude couldn't read the page clearly. Try a sharper photo.");
      } else {
        onUpdate(updates);

        // Save to hymn_cache so future entries with the same hymnal+number
        // auto-fill instantly without a fresh photo. Best-effort; if the
        // cache write fails we still keep the in-bulletin fill.
        if (item.hymnal_source && item.hymn_number?.trim()) {
          try {
            await withTimeout(
              supabase.from('hymn_cache').upsert(
                {
                  hymnal_source: item.hymnal_source,
                  hymn_number: item.hymn_number.trim(),
                  hymn_title: data.title || null,
                  tune_name: data.tune_name || null,
                  hymn_bio: bio || null,
                  lyrics: data.lyrics || null,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'hymnal_source,hymn_number' }
              )
            );
            setFillNote(
              `Filled in: ${filledFields.join(', ')}. Saved for future use.`
            );
          } catch {
            setFillNote(`Filled in: ${filledFields.join(', ')}.`);
          }
        } else {
          setFillNote(
            `Filled in: ${filledFields.join(', ')}. Add hymnal + number to save for next time.`
          );
        }
      }
    } catch (e2) {
      setFillError(e2.message || String(e2));
    } finally {
      setAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <fieldset className="border border-gray-200 rounded-md p-3 bg-white">
      <legend className="text-xs uppercase tracking-wide text-gray-500 px-1">
        Hymn details
      </legend>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-1">
        <div>
          <label className="label">Hymnal</label>
          <select
            className="input"
            value={item.hymnal_source ?? ''}
            onChange={(e) =>
              onUpdate({ hymnal_source: e.target.value || null })
            }
          >
            <option value="">— none —</option>
            <option value="UMH">UMH (United Methodist Hymnal)</option>
            <option value="TFWS">TFWS (The Faith We Sing)</option>
          </select>
        </div>
        <div>
          <label className="label">Hymn #</label>
          <input
            type="text"
            className="input"
            defaultValue={item.hymn_number ?? ''}
            onBlur={(e) =>
              onUpdate({ hymn_number: e.target.value || null })
            }
            placeholder="e.g., 89"
          />
        </div>
        <div className="flex items-end">
          <label className="btn-secondary text-sm w-full text-center cursor-pointer disabled:opacity-50">
            {analyzing ? 'Reading page…' : '📷 Photo of hymnal page'}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleHymnImage}
              disabled={analyzing}
            />
          </label>
        </div>

        <div className="md:col-span-3">
          <label className="label">Hymn title</label>
          <input
            type="text"
            className="input"
            value={hymnTitle}
            onChange={(e) => setHymnTitle(e.target.value)}
            onBlur={(e) => onUpdate({ hymn_title: e.target.value || null })}
            placeholder='e.g., "Holy, Holy, Holy"'
          />
        </div>
        <div>
          <label className="label">Tune name</label>
          <input
            type="text"
            className="input"
            value={tuneName}
            onChange={(e) => setTuneName(e.target.value)}
            onBlur={(e) => onUpdate({ tune_name: e.target.value || null })}
            placeholder="e.g., NICAEA"
          />
        </div>
        <div className="md:col-span-3">
          <label className="label">Hymn bio / story (optional)</label>
          <textarea
            className="input min-h-[60px]"
            value={hymnBio}
            onChange={(e) => setHymnBio(e.target.value)}
            onBlur={(e) => onUpdate({ hymn_bio: e.target.value || null })}
            placeholder="Optional: background on the hymn or composer."
          />
        </div>
      </div>

      {fillError && (
        <p className="text-xs text-red-600 mt-2">{fillError}</p>
      )}
      {fillNote && (
        <p className="text-xs text-umc-700 mt-2">{fillNote}</p>
      )}
      <p className="text-xs text-gray-400 mt-2">
        On a phone, the photo button opens the camera so you can snap the
        hymnal page directly. Claude reads what's on the page and fills in
        title, tune, bio, and lyrics. Lyrics land in the "Expanded detail"
        field below — verify before publishing under your CCLI/OneLicense
        coverage.
      </p>
    </fieldset>
  );
}

function ScriptureFields({ item, onUpdate }) {
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState(null);
  // Local mirror so we can show fresh text after Claude fills it without
  // forcing the parent to rerender every keystroke.
  const [textValue, setTextValue] = useState(item.scripture_text ?? '');

  const autoFill = async () => {
    if (!item.scripture_reference?.trim()) {
      setFillError('Enter a scripture reference first.');
      return;
    }
    setFilling(true);
    setFillError(null);
    try {
      const translation = item.scripture_translation?.trim() || 'NRSVUe';
      const result = await callClaude({
        system:
          'You are helping prepare a church bulletin. When asked for a scripture passage, return ONLY the verses (no introduction, no commentary, no copyright notice). Format each verse with its number in superscript-style brackets at the start, like "[1] In the beginning..." Use plain text only — no markdown.',
        messages: [
          {
            role: 'user',
            content: `Please provide ${item.scripture_reference} in the ${translation} translation.`,
          },
        ],
        max_tokens: 2000,
      });
      const text = result?.content?.[0]?.text?.trim();
      if (!text) throw new Error('Claude returned no text.');
      setTextValue(text);
      onUpdate({ scripture_text: text });
    } catch (e) {
      setFillError(e.message || String(e));
    } finally {
      setFilling(false);
    }
  };

  return (
    <fieldset className="border border-gray-200 rounded-md p-3 bg-white">
      <legend className="text-xs uppercase tracking-wide text-gray-500 px-1">
        Scripture details
      </legend>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
        <div>
          <label className="label">Reference</label>
          <input
            type="text"
            className="input"
            defaultValue={item.scripture_reference ?? ''}
            onBlur={(e) =>
              onUpdate({ scripture_reference: e.target.value || null })
            }
            placeholder="e.g., John 3:16-21"
          />
        </div>
        <div>
          <label className="label">Translation</label>
          <input
            type="text"
            className="input"
            defaultValue={item.scripture_translation ?? ''}
            onBlur={(e) =>
              onUpdate({ scripture_translation: e.target.value || null })
            }
            placeholder="e.g., NRSVUe"
          />
        </div>
        <div className="md:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Scripture text</label>
            <button
              type="button"
              onClick={autoFill}
              disabled={filling || !item.scripture_reference}
              className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {filling ? 'Asking Claude…' : '✨ Auto-fill from Claude'}
            </button>
          </div>
          <textarea
            className="input min-h-[120px]"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onBlur={(e) =>
              onUpdate({ scripture_text: e.target.value || null })
            }
            placeholder="Paste in, type, or click the Claude button above to auto-fill."
          />
          {fillError && (
            <p className="text-xs text-red-600 mt-1">{fillError}</p>
          )}
        </div>
      </div>
    </fieldset>
  );
}

function SermonFields({ sermon, onUpdate }) {
  // sermon may be null until the user types something — the parent
  // lazy-creates the sermons row on first edit.
  return (
    <fieldset className="border border-gray-200 rounded-md p-3 bg-white space-y-4">
      <legend className="text-xs uppercase tracking-wide text-gray-500 px-1">
        Sermon details
      </legend>
      <div>
        <label className="label">Sermon title</label>
        <input
          type="text"
          className="input"
          defaultValue={sermon?.title ?? ''}
          onBlur={(e) => onUpdate({ title: e.target.value || null })}
          placeholder='e.g., "Walking with Jesus"'
        />
        <p className="text-xs text-gray-500 mt-1">
          The topic/theme of today's sermon. Goes here, NOT in the
          common "Title" field above (that's the section header,
          usually just "Sermon").
        </p>
      </div>
      <div>
        <label className="label">Sermon manuscript (text)</label>
        <textarea
          className="input min-h-[200px] font-mono text-sm"
          defaultValue={sermon?.manuscript_text ?? ''}
          onBlur={(e) =>
            onUpdate({ manuscript_text: e.target.value || null })
          }
          placeholder="Paste your sermon manuscript here. Worshippers can expand the sermon item to follow along."
        />
        <p className="text-xs text-gray-400 mt-1">
          File upload (DOCX/PDF parsing) coming in a follow-up session.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Scripture reference (optional)</label>
          <input
            type="text"
            className="input"
            defaultValue={sermon?.scripture_reference ?? ''}
            onBlur={(e) =>
              onUpdate({ scripture_reference: e.target.value || null })
            }
            placeholder="e.g., John 3:16"
          />
        </div>
        <div>
          <label className="label">Theme (optional)</label>
          <input
            type="text"
            className="input"
            defaultValue={sermon?.theme ?? ''}
            onBlur={(e) => onUpdate({ theme: e.target.value || null })}
            placeholder="e.g., Easter, Lent, Stewardship"
          />
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Sermons are stored separately from the bulletin so they can be
        archived, searched, or re-preached at a future church.
      </p>
    </fieldset>
  );
}

// ---------------------------------------------------------------------
// Expandable inline / detail fields (every type)
// ---------------------------------------------------------------------

function ExpandableFields({ item, onUpdate }) {
  // Local state mirrors so external updates (e.g., Claude auto-fill from
  // a hymnal photo) immediately appear in the textareas.
  const [inlineBody, setInlineBody] = useState(item.inline_body ?? '');
  const [expandedDetail, setExpandedDetail] = useState(
    item.expanded_detail ?? ''
  );

  // Sync from props when they change from elsewhere (auto-fill, save).
  useEffect(() => {
    setInlineBody(item.inline_body ?? '');
  }, [item.inline_body]);
  useEffect(() => {
    setExpandedDetail(item.expanded_detail ?? '');
  }, [item.expanded_detail]);

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Inline body (optional)</label>
        <textarea
          className="input min-h-[80px]"
          value={inlineBody}
          onChange={(e) => setInlineBody(e.target.value)}
          onBlur={(e) => onUpdate({ inline_body: e.target.value || null })}
          placeholder="Text shown inline below the title — e.g., a short responsive reading or call to worship."
        />
      </div>
      <div>
        <label className="label">Expanded detail (optional)</label>
        <textarea
          className="input min-h-[120px] font-mono text-xs"
          value={expandedDetail}
          onChange={(e) => setExpandedDetail(e.target.value)}
          onBlur={(e) =>
            onUpdate({ expanded_detail: e.target.value || null })
          }
          placeholder="Hidden by default; worshippers tap to expand. Use for full hymn lyrics, prayer text, etc."
        />
      </div>
    </div>
  );
}
