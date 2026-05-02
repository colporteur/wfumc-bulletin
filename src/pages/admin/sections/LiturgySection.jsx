import { useEffect, useRef, useState } from 'react';
import { supabase, withTimeout, callClaude } from '../../../lib/supabase';
import { prepareImageForUpload, blobToBase64 } from '../../../lib/imageHelpers';
import { parseLiturgyDocx, suggestMatches } from '../../../lib/liturgyDocx';
import { parseMusicDocx, suggestMusicMatches } from '../../../lib/musicDocx';
import {
  refineLiturgyRows,
  refineMusicRows,
} from '../../../lib/importRefiner';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';
import SortableList, { DragHandle } from '../../../components/SortableList.jsx';
import { useAuth } from '../../../contexts/AuthContext.jsx';

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
  const { user } = useAuth();
  const bulletinId = bulletin?.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [addType, setAddType] = useState('generic');
  const [seeding, setSeeding] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showMusicImport, setShowMusicImport] = useState(false);

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
  // Ensure a preaching row exists for (bulletin, sermon). Idempotent —
  // safe to call repeatedly. Marks is_at_our_church=true so this sermon
  // shows in WFUMC's public archive going forward.
  const ensurePreachingForBulletin = async (sermonId) => {
    if (!sermonId || !bulletinId || !bulletin?.service_date) return;
    try {
      const { data: existing } = await withTimeout(
        supabase
          .from('preachings')
          .select('id')
          .eq('bulletin_id', bulletinId)
          .eq('sermon_id', sermonId)
          .maybeSingle()
      );
      if (existing) return;
      await withTimeout(
        supabase.from('preachings').insert({
          sermon_id: sermonId,
          bulletin_id: bulletinId,
          preached_at: bulletin.service_date,
          location: 'Wedowee First UMC',
          is_at_our_church: true,
          owner_user_id: user?.id ?? null,
        })
      );
    } catch (e) {
      // Best-effort — don't block the user's edit if this fails.
      // eslint-disable-next-line no-console
      console.warn('Failed to ensure preaching:', e);
    }
  };

  const updateSermonForItem = async (item, patch) => {
    setError(null);
    try {
      if (!item.sermon_id) {
        const { data: sermon, error: createErr } = await withTimeout(
          supabase
            .from('sermons')
            .insert({ ...patch, owner_user_id: user?.id ?? null })
            .select()
            .single()
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
        // Auto-create the preaching so this sermon shows up in the
        // public WFUMC archive once the bulletin is published.
        await ensurePreachingForBulletin(sermon.id);
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

  // Link an existing sermon (chosen from the archive) to this liturgy
  // item. Sets sermon_id + creates the corresponding preaching record.
  const pickExistingSermonForItem = async (item, sermonId) => {
    setError(null);
    try {
      const { data: updItem, error: linkErr } = await withTimeout(
        supabase
          .from('liturgy_items')
          .update({ sermon_id: sermonId })
          .eq('id', item.id)
          .select('*, sermon:sermons(*)')
          .single()
      );
      if (linkErr) throw linkErr;
      setItems((xs) => xs.map((x) => (x.id === item.id ? updItem : x)));
      await ensurePreachingForBulletin(sermonId);
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

  // Reorder all items based on a new array of IDs. Persists by parking
  // every row at a temporary negative position first (to avoid the
  // unique (bulletin_id, position) constraint biting mid-update), then
  // assigns each row its new 0..N-1 index.
  const reorderItems = async (newOrderedIds) => {
    setError(null);
    const oldItems = items;
    const newItems = newOrderedIds
      .map((id) => oldItems.find((x) => x.id === id))
      .filter(Boolean);

    // Optimistically update local state
    setItems(newItems.map((it, i) => ({ ...it, position: i })));

    try {
      // Park everyone at temp negative positions to clear the unique constraint
      await Promise.all(
        oldItems.map((it, i) =>
          withTimeout(
            supabase
              .from('liturgy_items')
              .update({ position: -1 - i })
              .eq('id', it.id)
          )
        )
      );
      // Now assign final positions in the new order
      await Promise.all(
        newItems.map((it, i) =>
          withTimeout(
            supabase
              .from('liturgy_items')
              .update({ position: i })
              .eq('id', it.id)
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
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-serif text-xl text-umc-900">Order of Worship</h2>
          <p className="text-sm text-gray-600 mt-1">
            The full liturgy. Click any item to expand and edit its details.
            Drag the <span className="font-mono">⋮⋮</span> handle to reorder.
            Items with a <span className="font-semibold">*</span> are "stand
            if able".
          </p>
        </div>
        {items.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="btn-secondary text-sm whitespace-nowrap"
              title="Import a liturgy .docx and auto-fill the matching item bodies"
            >
              📄 Import liturgy
            </button>
            <button
              type="button"
              onClick={() => setShowMusicImport(true)}
              className="btn-secondary text-sm whitespace-nowrap"
              title="Import the music director's weekly .docx — fills in hymns, prelude, anthem, etc."
            >
              🎵 Import music
            </button>
          </div>
        )}
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
          <SortableList
            items={items}
            onReorder={reorderItems}
            renderItem={(it, handleProps) => (
              <LiturgyItemCard
                item={it}
                expanded={expandedId === it.id}
                onToggle={() =>
                  setExpandedId((x) => (x === it.id ? null : it.id))
                }
                onUpdate={(patch) => updateItem(it.id, patch)}
                onUpdateSermon={(patch) => updateSermonForItem(it, patch)}
                onPickSermon={(sermonId) =>
                  pickExistingSermonForItem(it, sermonId)
                }
                onRemove={() => removeItem(it.id)}
                dragHandleProps={handleProps}
              />
            )}
          />
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

      {showImport && (
        <LiturgyImportModal
          bulletin={bulletin}
          items={items}
          onClose={() => setShowImport(false)}
          onApplied={async () => {
            await load();
            setShowImport(false);
          }}
        />
      )}

      {showMusicImport && (
        <MusicImportModal
          bulletin={bulletin}
          items={items}
          onClose={() => setShowMusicImport(false)}
          onApplied={async () => {
            await load();
            setShowMusicImport(false);
          }}
        />
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
  onUpdate,
  onUpdateSermon,
  onPickSermon,
  onRemove,
  dragHandleProps,
}) {
  return (
    <div
      className={`bg-white rounded-lg border ${
        expanded ? 'border-umc-700' : 'border-gray-200'
      } shadow-sm`}
    >
      {/* Collapsed header — always visible */}
      <div className="flex items-center gap-1 px-2 py-2">
        <DragHandle handleProps={dragHandleProps} label="Drag to reorder" />
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 text-left hover:bg-gray-50 -mx-1 px-2 py-1 rounded min-w-0"
        >
          <span className="text-gray-400 text-xs w-4 text-center">
            {expanded ? '▾' : '▸'}
          </span>
          {item.is_starred && (
            <span className="font-semibold text-umc-700">*</span>
          )}
          <span className="font-medium text-gray-800 truncate">
            {item.title || (
              <span className="italic text-gray-400">untitled</span>
            )}
          </span>
          {item.right_text && (
            <span className="text-gray-500 text-sm ml-2 truncate">
              — {item.right_text}
            </span>
          )}
          <span className="ml-auto text-xs uppercase tracking-wide text-gray-400 whitespace-nowrap">
            {item.item_type}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-red-600 hover:text-red-800 hover:underline px-2 whitespace-nowrap"
        >
          Remove
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4 bg-gray-50">
          <CommonFields item={item} onUpdate={onUpdate} />
          <TypeSpecificFields
            item={item}
            onUpdate={onUpdate}
            onUpdateSermon={onUpdateSermon}
            onPickSermon={onPickSermon}
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

function TypeSpecificFields({ item, onUpdate, onUpdateSermon, onPickSermon }) {
  switch (item.item_type) {
    case 'hymn':
      return <HymnFields item={item} onUpdate={onUpdate} />;
    case 'scripture':
      return <ScriptureFields item={item} onUpdate={onUpdate} />;
    case 'sermon':
      return (
        <SermonFields
          sermon={item.sermon}
          onUpdate={onUpdateSermon}
          onPickSermon={onPickSermon}
        />
      );
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
      // Prepare image (downsizes via canvas if possible, else falls back
      // to original file with the correct media type).
      const { blob, mediaType } = await prepareImageForUpload(file, 1600, 0.85);
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
                  media_type: mediaType,
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
        <div className="flex items-end gap-2">
          <label
            className={`btn-secondary text-sm flex-1 text-center cursor-pointer ${
              analyzing ? 'opacity-50 pointer-events-none' : ''
            }`}
            title="Open the camera to take a fresh photo of the hymnal page"
            onClick={() => {
              // Save current URL so we can restore it if Android kills
              // the browser tab during camera capture.
              try {
                sessionStorage.setItem(
                  'wfumc-photo-return',
                  window.location.pathname +
                    window.location.search +
                    window.location.hash
                );
              } catch {
                /* sessionStorage may be unavailable; non-fatal */
              }
            }}
          >
            📷 Camera
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleHymnImage}
              disabled={analyzing}
            />
          </label>
          <label
            className={`btn-secondary text-sm flex-1 text-center cursor-pointer ${
              analyzing ? 'opacity-50 pointer-events-none' : ''
            }`}
            title="Pick an existing photo from your gallery or files"
          >
            🖼️ Gallery
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleHymnImage}
              disabled={analyzing}
            />
          </label>
        </div>
        {analyzing && (
          <div className="md:col-span-3">
            <p className="text-xs text-gray-500 italic">Reading page…</p>
          </div>
        )}

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
        <strong>Camera</strong> opens your device's camera for a fresh
        photo. <strong>Gallery</strong> lets you pick an existing photo or
        file. Claude reads the page and fills in title, tune, bio, and
        lyrics (lyrics land in the "Expanded detail" field below). Verify
        before publishing under your CCLI/OneLicense coverage.
      </p>
      <p className="text-xs text-gray-400 mt-1">
        <strong>Tip for mobile:</strong> if Camera kicks you back to the
        dashboard (Android sometimes kills the browser to free memory for
        the camera app), the more reliable workflow is to take the photo
        with your phone's camera app first, then come back here and tap
        Gallery to pick it.
      </p>
      <p className="text-xs text-gray-400 mt-1">
        <strong>If you get a "Could not process image" error</strong> on
        Samsung or other Android phones, your camera is probably saving
        as HEIF/HEIC — a format Anthropic's API doesn't accept. In your
        phone's Camera app settings, find an option like "Picture
        formats" or "Save HEIF pictures" and switch to JPEG. iPhones
        have the same setting under Settings → Camera → Formats → Most
        Compatible.
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

function SermonFields({ sermon, onUpdate, onPickSermon }) {
  const { user } = useAuth();
  const ownerUserId = user?.id;
  // sermon may be null until the user types something — the parent
  // lazy-creates the sermons row on first edit.
  const [manuscriptText, setManuscriptText] = useState(
    sermon?.manuscript_text ?? ''
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadNote, setUploadNote] = useState(null);
  const docInputRef = useRef(null);

  // Picker state — for attaching an existing sermon from the archive
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerResults, setPickerResults] = useState([]);
  const [pickerError, setPickerError] = useState(null);

  // Sync if sermon prop changes (e.g., after lazy-create on first save)
  useEffect(() => {
    setManuscriptText(sermon?.manuscript_text ?? '');
  }, [sermon?.manuscript_text]);

  const loadPickerResults = async (q) => {
    if (!ownerUserId) {
      setPickerError('Not signed in.');
      return;
    }
    setPickerLoading(true);
    setPickerError(null);
    try {
      // Scope to the current user's own sermons. Other staff sermons
      // (incl. guest preachers' personal libraries) stay private until
      // explicitly shared. We can layer in a "shared with WFUMC" flag
      // later if guest preaching becomes routine.
      let query = supabase
        .from('sermons')
        .select(
          'id, title, scripture_reference, theme, original_sermon_number, preached_at'
        )
        .eq('owner_user_id', ownerUserId)
        .order('preached_at', { ascending: false, nullsFirst: false })
        .limit(50);
      if (q) {
        const safe = q.replace(/[%,]/g, '');
        query = query.or(
          `title.ilike.%${safe}%,scripture_reference.ilike.%${safe}%,theme.ilike.%${safe}%`
        );
      }
      const { data, error: err } = await withTimeout(query);
      if (err) throw err;
      setPickerResults(data ?? []);
    } catch (e) {
      setPickerError(e.message);
    } finally {
      setPickerLoading(false);
    }
  };

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerSearch('');
    await loadPickerResults('');
  };

  const handleSearchChange = (val) => {
    setPickerSearch(val);
    // Light debounce: just re-query on each change. List is capped at 50.
    loadPickerResults(val);
  };

  const handlePickSermon = async (sermonId) => {
    if (onPickSermon) {
      await onPickSermon(sermonId);
    }
    setPickerOpen(false);
  };

  const handleManuscriptUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isDocx =
      file.name.toLowerCase().endsWith('.docx') ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!isDocx) {
      setUploadError(
        'Please upload a .docx file (Microsoft Word). PDF support is coming later.'
      );
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadNote(null);

    try {
      // Lazy-import mammoth so it doesn't bloat the main bundle
      const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = (result?.value ?? '').trim();
      if (!text) {
        setUploadError(
          "Couldn't extract any text from that document. It might be empty or image-only."
        );
        return;
      }
      setManuscriptText(text);
      onUpdate({ manuscript_text: text });
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      setUploadNote(`Loaded ${wordCount.toLocaleString()} words from ${file.name}.`);
    } catch (err) {
      setUploadError(err?.message || 'Failed to parse document.');
    } finally {
      setUploading(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  };

  return (
    <fieldset className="border border-gray-200 rounded-md p-3 bg-white space-y-4">
      <legend className="text-xs uppercase tracking-wide text-gray-500 px-1">
        Sermon details
      </legend>

      {/* Pick-existing-sermon picker — useful when re-preaching a sermon
          from the archive instead of starting fresh */}
      <div className="border border-umc-100 rounded-md p-3 bg-umc-50/30">
        {!pickerOpen ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-600">
              Re-preaching a sermon you've given before?
            </p>
            <button
              type="button"
              onClick={openPicker}
              className="btn-secondary text-xs whitespace-nowrap"
            >
              📚 Pick from archive
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                className="input text-sm"
                value={pickerSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search by title, scripture, or theme…"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
            {pickerError && (
              <p className="text-xs text-red-600">{pickerError}</p>
            )}
            {pickerLoading ? (
              <p className="text-xs text-gray-500 italic">Loading…</p>
            ) : pickerResults.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                No sermons match.
              </p>
            ) : (
              <ul className="max-h-60 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded bg-white">
                {pickerResults.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => handlePickSermon(s.id)}
                      className="w-full text-left px-3 py-2 hover:bg-umc-50"
                    >
                      <div className="flex items-baseline gap-2">
                        {s.original_sermon_number && (
                          <span className="text-xs text-gray-400 font-mono">
                            #{s.original_sermon_number}
                          </span>
                        )}
                        <span className="font-medium text-sm text-gray-800 truncate">
                          {s.title || (
                            <span className="italic text-gray-400">
                              Untitled
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                        {s.scripture_reference && (
                          <span>{s.scripture_reference}</span>
                        )}
                        {s.theme && (
                          <span className="italic">{s.theme}</span>
                        )}
                        {s.preached_at && (
                          <span>
                            First preached{' '}
                            {new Date(
                              s.preached_at + 'T00:00:00'
                            ).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-400">
              Picking a sermon links it to this bulletin and records a
              new preaching for today's date.
            </p>
          </div>
        )}
      </div>

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
        <div className="flex items-center justify-between mb-1">
          <label className="label mb-0">Sermon manuscript (text)</label>
          <label
            className={`text-xs cursor-pointer text-umc-700 hover:text-umc-900 underline ${
              uploading ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            {uploading ? 'Reading…' : '📄 Upload Word doc (.docx)'}
            <input
              ref={docInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={handleManuscriptUpload}
              disabled={uploading}
            />
          </label>
        </div>
        <textarea
          className="input min-h-[200px] font-mono text-sm"
          value={manuscriptText}
          onChange={(e) => setManuscriptText(e.target.value)}
          onBlur={(e) =>
            onUpdate({ manuscript_text: e.target.value || null })
          }
          placeholder="Paste your sermon manuscript here, or upload a .docx file above."
        />
        {uploadError && (
          <p className="text-xs text-red-600 mt-1">{uploadError}</p>
        )}
        {uploadNote && !uploadError && (
          <p className="text-xs text-umc-700 mt-1">{uploadNote}</p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          Upload extracts plain text from the Word document. Bold,
          italics, and other formatting are not preserved (they wouldn't
          render in the worshipper view anyway). PDF support is coming
          later — for now, save your PDF as Word first or paste the text.
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

// ---------------------------------------------------------------------
// Liturgy import modal
// ---------------------------------------------------------------------
//
// Pastor's typical workflow: write the full liturgy in a .docx file
// each week, then transcribe pieces into the bulletin. This modal
// short-circuits the transcription:
//
//   1. Drop the .docx
//   2. We parse it into sections (heading + body) and suggest which
//      bulletin liturgy_item each section maps to
//   3. The pastor reviews per-row, can change the matched item or skip
//   4. Apply: each matched item's expanded_detail gets the body text;
//      the FULL liturgy text also gets stored on the linked sermon's
//      preaching record (so it shows up on the sermon detail page in
//      the Sermon Archive)

function LiturgyImportModal({ bulletin, items, onClose, onApplied }) {
  const [phase, setPhase] = useState('pick'); // pick | preview | applying | done
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [sourceFilename, setSourceFilename] = useState(null);
  const [fullText, setFullText] = useState('');
  const [matches, setMatches] = useState([]); // [{section, suggestedItem, score, alternates}]
  // Per-row UI state — keyed by section index. {selectedItemId, skip}
  const [rowState, setRowState] = useState({});
  const [saveToSermon, setSaveToSermon] = useState(true);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState(null);
  // Claude refinement: idx → field-plan object the apply step writes verbatim.
  // Empty until the user hits "Refine with Claude".
  const [refinedPlans, setRefinedPlans] = useState({});
  const [refining, setRefining] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setParsing(true);
    try {
      const parsed = await parseLiturgyDocx(file);
      if (!parsed.sections.length) {
        setError(
          "Couldn't find any section headings in that .docx. Make sure each section " +
            '(Call to Worship, Pastoral Prayer, etc.) is on its own line.'
        );
        return;
      }
      const m = suggestMatches(parsed.sections, items);
      const initial = {};
      m.forEach((row, idx) => {
        initial[idx] = {
          selectedItemId: row.suggestedItem?.id ?? '',
          skip: !row.suggestedItem, // unmatched rows default to skip
          mode: 'overwrite', // 'overwrite' replaces; 'append' concatenates
        };
      });
      setSourceFilename(file.name);
      setFullText(parsed.fullText);
      setMatches(m);
      setRowState(initial);
      setPhase('preview');
    } catch (e2) {
      setError(e2.message || String(e2));
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateRow = (idx, patch) => {
    setRowState((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  };

  // Send all selected, item-mapped rows to Claude for field-distribution
  // refinement. Result is stored as refinedPlans[idx] = { ...fields }.
  const runRefine = async () => {
    const eligible = matches
      .map((m, idx) => ({ m, idx }))
      .filter(({ idx }) => {
        const r = rowState[idx];
        return r && !r.skip && r.selectedItemId;
      })
      .map(({ m, idx }) => {
        const item = items.find((it) => it.id === rowState[idx].selectedItemId);
        return {
          idx,
          heading: m.section.heading,
          body: m.section.body,
          item: {
            id: item.id,
            title: item.title,
            item_type: item.item_type,
          },
        };
      });
    if (eligible.length === 0) {
      setError('Nothing selected to refine.');
      return;
    }
    setRefining(true);
    setError(null);
    try {
      const plans = await refineLiturgyRows(eligible);
      const map = {};
      for (const p of plans) {
        if (typeof p.idx === 'number') map[p.idx] = p;
      }
      setRefinedPlans(map);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRefining(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setPhase('applying');
    setError(null);
    const errors = [];
    let updatedItems = 0;

    // For each selected row: if a refined plan exists, apply ALL its
    // fields. Otherwise fall back to the simple body→expanded_detail
    // behavior. Append mode (per Todd) ONLY governs expanded_detail —
    // every other field always overwrites.
    for (let idx = 0; idx < matches.length; idx++) {
      const row = rowState[idx];
      if (!row || row.skip || !row.selectedItemId) continue;
      const section = matches[idx].section;
      const plan = refinedPlans[idx];
      try {
        const update = {};
        let appendedExpanded = null;

        if (plan) {
          // Use Claude's plan for every field except expanded_detail —
          // that one honors the append toggle.
          for (const [key, value] of Object.entries(plan)) {
            if (key === 'idx') continue;
            if (key === 'expanded_detail') {
              if (row.mode === 'append' && value) {
                appendedExpanded = value;
              } else {
                update.expanded_detail = value || null;
              }
            } else {
              update[key] = value;
            }
          }
        } else {
          // Heuristic-only: stuff the body into expanded_detail.
          const body = section.body || '';
          if (row.mode === 'append' && body) {
            appendedExpanded = body;
          } else {
            update.expanded_detail = body || null;
          }
        }

        if (appendedExpanded) {
          const { data: cur, error: getErr } = await withTimeout(
            supabase
              .from('liturgy_items')
              .select('expanded_detail')
              .eq('id', row.selectedItemId)
              .single()
          );
          if (getErr) throw getErr;
          const existing = (cur?.expanded_detail || '').trim();
          update.expanded_detail = existing
            ? `${existing}\n\n${appendedExpanded}`.trim()
            : appendedExpanded;
        }

        if (Object.keys(update).length === 0) continue;
        const { error: err } = await withTimeout(
          supabase
            .from('liturgy_items')
            .update(update)
            .eq('id', row.selectedItemId)
        );
        if (err) throw err;
        updatedItems += 1;
      } catch (e) {
        errors.push(`"${section.heading}": ${e.message || String(e)}`);
      }
    }

    // 2. Save full text to the linked sermon's preaching for this
    //    bulletin (so it surfaces in the Sermon Archive at the right
    //    date+location).
    let updatedPreachings = 0;
    if (saveToSermon) {
      // Find sermon ids attached to any liturgy item in this bulletin.
      const sermonIds = Array.from(
        new Set(items.map((it) => it.sermon_id).filter(Boolean))
      );
      for (const sermonId of sermonIds) {
        try {
          // Find the preaching for (this sermon, this bulletin). It
          // should already exist since linking a sermon auto-creates
          // a preaching. If for some reason it doesn't, skip.
          const { data: pr } = await withTimeout(
            supabase
              .from('preachings')
              .select('id')
              .eq('sermon_id', sermonId)
              .eq('bulletin_id', bulletin.id)
              .maybeSingle()
          );
          if (!pr) continue;
          const { error: err } = await withTimeout(
            supabase
              .from('preachings')
              .update({
                liturgy_text: fullText || null,
                liturgy_source_filename: sourceFilename || null,
              })
              .eq('id', pr.id)
          );
          if (err) throw err;
          updatedPreachings += 1;
        } catch (e) {
          errors.push(`Saving liturgy to sermon: ${e.message || String(e)}`);
        }
      }
    }

    setResults({ updatedItems, updatedPreachings, errors });
    setApplying(false);
    setPhase('done');
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !applying) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full my-4">
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl text-umc-900">
                Import liturgy from .docx
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Drop your weekly liturgy doc and we'll match each section
                ("Call to Worship", "Congregational Prayer", etc.) to an item
                in this bulletin's Order of Worship. You review and confirm
                before anything is written.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="text-gray-400 hover:text-gray-700 text-2xl leading-none disabled:opacity-30"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          {phase === 'pick' && (
            <div className="text-center py-10 space-y-3 border-2 border-dashed border-gray-300 rounded">
              <p className="text-sm text-gray-600">
                Pick a .docx file with your liturgy.
              </p>
              <label
                className={`btn-primary inline-block cursor-pointer ${
                  parsing ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                {parsing ? 'Parsing…' : '📄 Choose .docx file'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={handleFile}
                  disabled={parsing}
                />
              </label>
            </div>
          )}

          {phase === 'preview' && (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <p className="text-xs text-gray-500">
                  {matches.length} section{matches.length === 1 ? '' : 's'}{' '}
                  found in <span className="font-mono">{sourceFilename}</span>.
                  Adjust the matches below — anything you don't want imported,
                  check "skip".
                </p>
                <button
                  type="button"
                  onClick={runRefine}
                  disabled={refining}
                  className="btn-secondary text-xs disabled:opacity-50 whitespace-nowrap"
                  title="Ask Claude to distribute each section's text into the appropriate fields (title, center, right, expanded, etc.)"
                >
                  {refining
                    ? 'Refining…'
                    : Object.keys(refinedPlans).length > 0
                      ? '✨ Re-refine with Claude'
                      : '✨ Refine with Claude'}
                </button>
              </div>
              {Object.keys(refinedPlans).length > 0 && (
                <p className="text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                  Claude proposed field-level plans for{' '}
                  {Object.keys(refinedPlans).length} row
                  {Object.keys(refinedPlans).length === 1 ? '' : 's'}. Review
                  in each row's "Show fields Claude will set" expander, then
                  apply.
                </p>
              )}

              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {matches.map((m, idx) => {
                  const row = rowState[idx] || {};
                  const target = items.find((it) => it.id === row.selectedItemId);
                  return (
                    <div
                      key={idx}
                      className={`border rounded p-3 ${
                        row.skip
                          ? 'border-gray-200 bg-gray-50 opacity-60'
                          : 'border-umc-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-umc-900">
                            {m.section.heading}
                            {m.score >= 80 && !row.skip && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-green-700">
                                auto-matched
                              </span>
                            )}
                            {m.score > 0 && m.score < 80 && !row.skip && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700">
                                fuzzy match
                              </span>
                            )}
                            {m.score === 0 && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-red-700">
                                no match
                              </span>
                            )}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <label className="text-xs text-gray-600">
                              → fill into:
                            </label>
                            <select
                              className="text-xs border border-gray-300 rounded px-2 py-0.5 flex-1"
                              value={row.selectedItemId ?? ''}
                              onChange={(e) =>
                                updateRow(idx, {
                                  selectedItemId: e.target.value,
                                  skip: !e.target.value,
                                })
                              }
                              disabled={row.skip}
                            >
                              <option value="">— select item —</option>
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.title || '(untitled)'}
                                </option>
                              ))}
                            </select>
                          </div>
                          {target?.expanded_detail && !row.skip && (
                            <p
                              className={`text-[10px] mt-1 ${
                                row.mode === 'append'
                                  ? 'text-gray-500'
                                  : 'text-amber-700'
                              }`}
                            >
                              {row.mode === 'append'
                                ? `↳ Will append to "${target.title}" (keeps existing text).`
                                : `⚠️ Will replace existing text on "${target.title}".`}
                            </p>
                          )}
                          {!row.skip && (
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-[10px] text-gray-500">
                                Mode:
                              </span>
                              <label className="text-[10px] text-gray-700 cursor-pointer flex items-center gap-1">
                                <input
                                  type="radio"
                                  name={`mode-${idx}`}
                                  checked={row.mode === 'overwrite'}
                                  onChange={() =>
                                    updateRow(idx, { mode: 'overwrite' })
                                  }
                                  className="h-3 w-3"
                                />
                                Overwrite
                              </label>
                              <label className="text-[10px] text-gray-700 cursor-pointer flex items-center gap-1">
                                <input
                                  type="radio"
                                  name={`mode-${idx}`}
                                  checked={row.mode === 'append'}
                                  onChange={() =>
                                    updateRow(idx, { mode: 'append' })
                                  }
                                  className="h-3 w-3"
                                />
                                Append
                              </label>
                            </div>
                          )}
                          <details className="mt-2">
                            <summary className="text-xs text-gray-500 cursor-pointer">
                              Body preview ({m.section.body.length} chars)
                            </summary>
                            <p className="text-xs text-gray-700 whitespace-pre-wrap mt-1 max-h-32 overflow-y-auto bg-gray-50 p-2 rounded">
                              {m.section.body || '(empty)'}
                            </p>
                          </details>
                          {refinedPlans[idx] && (
                            <FieldPlanPreview
                              plan={refinedPlans[idx]}
                              mode={row.mode}
                            />
                          )}
                        </div>
                        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={!!row.skip}
                            onChange={(e) =>
                              updateRow(idx, { skip: e.target.checked })
                            }
                            className="h-4 w-4 rounded border-gray-300 text-umc-700"
                          />
                          skip
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveToSermon}
                    onChange={(e) => setSaveToSermon(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-umc-700"
                  />
                  <span>
                    Also save the full liturgy text to the linked sermon's
                    preaching record
                    <span className="block text-[10px] text-gray-500 leading-tight">
                      So the liturgy shows on the sermon detail page in the
                      Sermon Archive at this date + location.
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={apply}
                  className="btn-primary"
                >
                  Apply{' '}
                  {Object.values(rowState).filter((r) => !r.skip).length} change
                  {Object.values(rowState).filter((r) => !r.skip).length === 1
                    ? ''
                    : 's'}
                </button>
              </div>
            </>
          )}

          {phase === 'applying' && (
            <div className="text-center py-10 text-sm text-gray-600">
              Applying changes…
            </div>
          )}

          {phase === 'done' && results && (
            <div className="space-y-3">
              <p className="text-sm text-umc-900">
                Done. Updated <strong>{results.updatedItems}</strong> liturgy
                item{results.updatedItems === 1 ? '' : 's'}.
                {results.updatedPreachings > 0 && (
                  <>
                    {' '}
                    Saved liturgy text to{' '}
                    <strong>{results.updatedPreachings}</strong> sermon
                    preaching record
                    {results.updatedPreachings === 1 ? '' : 's'}.
                  </>
                )}
              </p>
              {results.errors.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-red-700">
                    {results.errors.length} error
                    {results.errors.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 space-y-1 font-mono text-red-600">
                    {results.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onApplied}
                  className="btn-primary"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Music import modal
// ---------------------------------------------------------------------
//
// Pastor Todd's music director provides a weekly .docx with:
//   - Single-line music items (Prelude, Offertory, Anthem, etc.)
//   - A "Hymns:" block with one hymn per line: "UMH #545 ... (TUNE)"
//   - One or more "HYMN BIO…" blocks with bio paragraphs
//
// The modal parses these into typed rows and lets the user confirm
// matches per row. Different row kinds write to different fields:
//   - music_item → fills inline_body
//   - hymn       → patches hymnal_source / hymn_number / hymn_title /
//                  tune_name on the matched hymn slot (in order)
//   - hymn_bio   → fills hymn_bio + (default) APPENDS to expanded_detail
//
// Default mode is "overwrite" since the music doc usually replaces
// stale values from last week. Hymn bios default to "append" because
// expanded_detail often holds other commentary that shouldn't be lost.

function MusicImportModal({ bulletin, items, onClose, onApplied }) {
  const [phase, setPhase] = useState('pick'); // pick | preview | applying | done
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]); // enriched rows (with suggestedItem)
  const [rowState, setRowState] = useState({});
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState(null);
  const [refinedPlans, setRefinedPlans] = useState({});
  const [refining, setRefining] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setParsing(true);
    try {
      const parsed = await parseMusicDocx(file);
      if (!parsed.rows.length) {
        setError(
          "Couldn't find any music items, hymns, or bios in that .docx. " +
            'Make sure each line uses one of the recognized formats ' +
            '(e.g., "Prelude: ...", "UMH #123 Hymn Title (TUNE)", "HYMN BIO… ...").'
        );
        return;
      }
      const enriched = suggestMusicMatches(parsed.rows, items);
      const initial = {};
      enriched.forEach((row, idx) => {
        initial[idx] = {
          selectedItemId: row.suggestedItem?.id ?? '',
          skip: !row.suggestedItem,
          // bios default to append; everything else defaults to overwrite
          mode: row.kind === 'hymn_bio' ? 'append' : 'overwrite',
        };
      });
      setRows(enriched);
      setRowState(initial);
      setPhase('preview');
    } catch (e2) {
      setError(e2.message || String(e2));
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateRow = (idx, patch) => {
    setRowState((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  };

  const runRefine = async () => {
    const eligible = rows
      .map((r, idx) => ({ r, idx }))
      .filter(({ idx }) => {
        const s = rowState[idx];
        return s && !s.skip && s.selectedItemId;
      })
      .map(({ r, idx }) => {
        const item = items.find((it) => it.id === rowState[idx].selectedItemId);
        return {
          idx,
          ...r,
          item: {
            id: item.id,
            title: item.title,
            item_type: item.item_type,
          },
        };
      });
    if (eligible.length === 0) {
      setError('Nothing selected to refine.');
      return;
    }
    setRefining(true);
    setError(null);
    try {
      const plans = await refineMusicRows(eligible);
      const map = {};
      for (const p of plans) {
        if (typeof p.idx === 'number') map[p.idx] = p;
      }
      setRefinedPlans(map);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRefining(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setPhase('applying');
    setError(null);
    const errors = [];
    let updatedItems = 0;

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const state = rowState[idx];
      if (!state || state.skip || !state.selectedItemId) continue;

      try {
        const update = {};
        let appendedExpanded = null;
        const plan = refinedPlans[idx];

        if (plan) {
          // Use Claude's plan for every field except expanded_detail —
          // that one honors the row's append/overwrite mode.
          for (const [key, value] of Object.entries(plan)) {
            if (key === 'idx') continue;
            if (key === 'expanded_detail') {
              if (state.mode === 'append' && value) appendedExpanded = value;
              else update.expanded_detail = value || null;
            } else {
              update[key] = value;
            }
          }
        } else {
          // Heuristic-only path (no refinement). Same behavior as before.
          if (row.kind === 'music_item') {
            if (state.mode === 'append' && row.body) appendedExpanded = null;
            update.inline_body =
              state.mode === 'append'
                ? null /* set below after re-fetch */
                : row.body || null;
          } else if (row.kind === 'hymn') {
            update.hymnal_source = row.hymnal_source || null;
            update.hymn_number = row.hymn_number || null;
            update.hymn_title = row.hymn_title || null;
            update.tune_name = row.tune_name || null;
          } else if (row.kind === 'hymn_bio') {
            update.hymn_bio = row.body || null;
            if (state.mode === 'append' && row.body) appendedExpanded = row.body;
            else update.expanded_detail = row.body || null;
          }
        }

        // For heuristic music_item append, we still need to concat
        // inline_body. Detect that case explicitly.
        const heuristicMusicAppend =
          !plan && row.kind === 'music_item' && state.mode === 'append' && row.body;

        if (appendedExpanded || heuristicMusicAppend) {
          const { data: cur, error: getErr } = await withTimeout(
            supabase
              .from('liturgy_items')
              .select('inline_body, expanded_detail')
              .eq('id', state.selectedItemId)
              .single()
          );
          if (getErr) throw getErr;
          if (appendedExpanded) {
            const existing = (cur?.expanded_detail || '').trim();
            update.expanded_detail = existing
              ? `${existing}\n\n${appendedExpanded}`.trim()
              : appendedExpanded;
          }
          if (heuristicMusicAppend) {
            const existing = (cur?.inline_body || '').trim();
            update.inline_body = existing
              ? `${existing}\n\n${row.body}`.trim()
              : row.body;
          }
        }

        if (Object.keys(update).length === 0) continue;
        const { error: err } = await withTimeout(
          supabase
            .from('liturgy_items')
            .update(update)
            .eq('id', state.selectedItemId)
        );
        if (err) throw err;
        updatedItems += 1;
      } catch (e) {
        errors.push(`${rowLabel(row)}: ${e.message || String(e)}`);
      }
    }

    setResults({ updatedItems, errors });
    setApplying(false);
    setPhase('done');
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !applying) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full my-4">
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl text-umc-900">
                Import music from .docx
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Drop the music director's weekly file. We'll fill in
                Prelude / Offertory / Anthem, parse each hymn line into
                its bulletin slot (in order), and append any "HYMN BIO…"
                paragraphs into the matching hymn's expanded section.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="text-gray-400 hover:text-gray-700 text-2xl leading-none disabled:opacity-30"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          {phase === 'pick' && (
            <div className="text-center py-10 space-y-3 border-2 border-dashed border-gray-300 rounded">
              <p className="text-sm text-gray-600">
                Pick the music .docx file.
              </p>
              <label
                className={`btn-primary inline-block cursor-pointer ${
                  parsing ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                {parsing ? 'Parsing…' : '🎵 Choose .docx file'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={handleFile}
                  disabled={parsing}
                />
              </label>
            </div>
          )}

          {phase === 'preview' && (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <p className="text-xs text-gray-500">
                  {rows.length} item{rows.length === 1 ? '' : 's'} parsed.
                  Defaults: overwrite for music items + hymn fields, append
                  for hymn bios. Adjust per row as needed.
                </p>
                <button
                  type="button"
                  onClick={runRefine}
                  disabled={refining}
                  className="btn-secondary text-xs disabled:opacity-50 whitespace-nowrap"
                  title="Ask Claude to distribute each row's content into structured fields (title, center, right, etc.)"
                >
                  {refining
                    ? 'Refining…'
                    : Object.keys(refinedPlans).length > 0
                      ? '✨ Re-refine with Claude'
                      : '✨ Refine with Claude'}
                </button>
              </div>
              {Object.keys(refinedPlans).length > 0 && (
                <p className="text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                  Claude proposed field-level plans for{' '}
                  {Object.keys(refinedPlans).length} row
                  {Object.keys(refinedPlans).length === 1 ? '' : 's'}. Review
                  per-row, then apply.
                </p>
              )}

              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {rows.map((row, idx) => {
                  const state = rowState[idx] || {};
                  const target = items.find((it) => it.id === state.selectedItemId);
                  return (
                    <div
                      key={idx}
                      className={`border rounded p-3 ${
                        state.skip
                          ? 'border-gray-200 bg-gray-50 opacity-60'
                          : 'border-umc-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-2">
                          <RowHeader row={row} score={row.score ?? 0} skip={state.skip} />

                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-600">
                              → fill into:
                            </label>
                            <select
                              className="text-xs border border-gray-300 rounded px-2 py-0.5 flex-1"
                              value={state.selectedItemId ?? ''}
                              onChange={(e) =>
                                updateRow(idx, {
                                  selectedItemId: e.target.value,
                                  skip: !e.target.value,
                                })
                              }
                              disabled={state.skip}
                            >
                              <option value="">— select item —</option>
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.title || '(untitled)'}
                                  {it.item_type === 'hymn' && ' (hymn)'}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Append/overwrite toggle — only meaningful for
                              text-field rows (music_item, hymn_bio). For
                              hymn rows the structured fields always replace. */}
                          {!state.skip && row.kind !== 'hymn' && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-500">
                                {row.kind === 'hymn_bio'
                                  ? 'Expanded section:'
                                  : 'Inline text:'}
                              </span>
                              <label className="text-[10px] text-gray-700 cursor-pointer flex items-center gap-1">
                                <input
                                  type="radio"
                                  name={`mmode-${idx}`}
                                  checked={state.mode === 'overwrite'}
                                  onChange={() =>
                                    updateRow(idx, { mode: 'overwrite' })
                                  }
                                  className="h-3 w-3"
                                />
                                Overwrite
                              </label>
                              <label className="text-[10px] text-gray-700 cursor-pointer flex items-center gap-1">
                                <input
                                  type="radio"
                                  name={`mmode-${idx}`}
                                  checked={state.mode === 'append'}
                                  onChange={() =>
                                    updateRow(idx, { mode: 'append' })
                                  }
                                  className="h-3 w-3"
                                />
                                Append
                              </label>
                            </div>
                          )}

                          {!state.skip && target && (
                            <RowDestinationSummary row={row} target={target} mode={state.mode} />
                          )}

                          <details className="mt-1">
                            <summary className="text-xs text-gray-500 cursor-pointer">
                              Source preview
                            </summary>
                            <RowSourcePreview row={row} />
                          </details>
                          {refinedPlans[idx] && (
                            <FieldPlanPreview
                              plan={refinedPlans[idx]}
                              mode={state.mode}
                            />
                          )}
                        </div>
                        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={!!state.skip}
                            onChange={(e) =>
                              updateRow(idx, { skip: e.target.checked })
                            }
                            className="h-4 w-4 rounded border-gray-300 text-umc-700"
                          />
                          skip
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="btn-secondary">
                  Cancel
                </button>
                <button type="button" onClick={apply} className="btn-primary">
                  Apply{' '}
                  {Object.values(rowState).filter((r) => !r.skip).length} change
                  {Object.values(rowState).filter((r) => !r.skip).length === 1
                    ? ''
                    : 's'}
                </button>
              </div>
            </>
          )}

          {phase === 'applying' && (
            <div className="text-center py-10 text-sm text-gray-600">
              Applying changes…
            </div>
          )}

          {phase === 'done' && results && (
            <div className="space-y-3">
              <p className="text-sm text-umc-900">
                Done. Updated <strong>{results.updatedItems}</strong> liturgy
                item{results.updatedItems === 1 ? '' : 's'}.
              </p>
              {results.errors.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-red-700">
                    {results.errors.length} error
                    {results.errors.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 space-y-1 font-mono text-red-600">
                    {results.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={onApplied} className="btn-primary">
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Tiny helpers for the music modal — keep the row rendering tidy.

function rowLabel(row) {
  if (row.kind === 'music_item') return row.label;
  if (row.kind === 'hymn')
    return `${row.hymnal_source} #${row.hymn_number} ${row.hymn_title}`;
  if (row.kind === 'hymn_bio') return `Bio: ${row.hymn_title}`;
  return 'Unknown';
}

function RowHeader({ row, score, skip }) {
  const KIND = {
    music_item: { label: 'Music', cls: 'bg-blue-100 text-blue-800' },
    hymn: { label: 'Hymn', cls: 'bg-purple-100 text-purple-800' },
    hymn_bio: { label: 'Hymn bio', cls: 'bg-amber-100 text-amber-800' },
  };
  const k = KIND[row.kind] ?? KIND.music_item;
  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span
        className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded ${k.cls}`}
      >
        {k.label}
      </span>
      <span className="text-sm font-medium text-umc-900">{rowLabel(row)}</span>
      {score >= 80 && !skip && (
        <span className="text-[10px] uppercase tracking-wide text-green-700">
          auto-matched
        </span>
      )}
      {score > 0 && score < 80 && !skip && (
        <span className="text-[10px] uppercase tracking-wide text-amber-700">
          fuzzy match
        </span>
      )}
      {score === 0 && (
        <span className="text-[10px] uppercase tracking-wide text-red-700">
          no match
        </span>
      )}
    </div>
  );
}

function RowDestinationSummary({ row, target, mode }) {
  if (row.kind === 'hymn') {
    return (
      <p className="text-[10px] text-gray-500">
        ↳ Sets <span className="font-mono">hymnal_source</span>,{' '}
        <span className="font-mono">hymn_number</span>,{' '}
        <span className="font-mono">hymn_title</span>,{' '}
        <span className="font-mono">tune_name</span> on "{target.title}".
      </p>
    );
  }
  const fieldName =
    row.kind === 'music_item' ? 'inline body' : 'expanded section';
  const existing =
    row.kind === 'music_item' ? target.inline_body : target.expanded_detail;
  return (
    <p
      className={`text-[10px] ${
        existing && mode === 'overwrite' ? 'text-amber-700' : 'text-gray-500'
      }`}
    >
      ↳{' '}
      {existing
        ? mode === 'append'
          ? `Will append to ${fieldName} of "${target.title}".`
          : `⚠️ Will replace ${fieldName} of "${target.title}".`
        : `Will fill ${fieldName} of "${target.title}".`}
    </p>
  );
}

function RowSourcePreview({ row }) {
  if (row.kind === 'music_item') {
    return (
      <p className="text-xs text-gray-700 mt-1 bg-gray-50 p-2 rounded">
        {row.body || '(empty)'}
      </p>
    );
  }
  if (row.kind === 'hymn') {
    return (
      <p className="text-xs text-gray-700 mt-1 bg-gray-50 p-2 rounded font-mono">
        {row.hymnal_source} #{row.hymn_number} — {row.hymn_title}
        {row.tune_name && ` (${row.tune_name})`}
      </p>
    );
  }
  if (row.kind === 'hymn_bio') {
    return (
      <p className="text-xs text-gray-700 mt-1 bg-gray-50 p-2 rounded whitespace-pre-wrap max-h-32 overflow-y-auto">
        {row.body || '(empty)'}
      </p>
    );
  }
  return null;
}

// Shared component used by both import modals to show what fields
// Claude proposes setting on the matched item. Renders only the keys
// with a non-null value so the user can scan quickly.
function FieldPlanPreview({ plan, mode }) {
  // Friendly labels for fields the modal may render.
  const LABELS = {
    title: 'Title',
    center_text: 'Center text',
    right_text: 'Right text',
    is_starred: 'Stand if able',
    inline_body: 'Inline body',
    expanded_detail: 'Expanded detail',
    hymnal_source: 'Hymnal',
    hymn_number: 'Hymn #',
    hymn_title: 'Hymn title',
    tune_name: 'Tune',
    hymn_bio: 'Hymn bio',
    scripture_reference: 'Scripture ref',
    scripture_translation: 'Translation',
    scripture_text: 'Scripture text',
  };
  const order = [
    'title', 'center_text', 'right_text', 'is_starred',
    'inline_body', 'expanded_detail',
    'hymnal_source', 'hymn_number', 'hymn_title', 'tune_name', 'hymn_bio',
    'scripture_reference', 'scripture_translation', 'scripture_text',
  ];
  const entries = order
    .filter((k) => k in plan && plan[k] != null && plan[k] !== '')
    .map((k) => [k, plan[k]]);
  if (entries.length === 0) return null;
  return (
    <details className="mt-2 border border-green-200 rounded bg-green-50/40">
      <summary className="text-xs text-green-800 cursor-pointer px-2 py-1 font-medium">
        ✨ Fields Claude will set ({entries.length})
      </summary>
      <dl className="text-[11px] text-gray-800 px-2 py-2 space-y-1">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <dt className="font-mono text-gray-500 shrink-0 w-28 truncate">
              {LABELS[key] || key}
              {key === 'expanded_detail' && mode === 'append' && (
                <span className="text-amber-700 ml-1">+</span>
              )}
            </dt>
            <dd className="flex-1 min-w-0">
              {key === 'is_starred' ? (
                <span className="font-mono">{value ? 'true' : 'false'}</span>
              ) : (
                <span className="whitespace-pre-wrap break-words line-clamp-3">
                  {String(value)}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {mode === 'append' && entries.some(([k]) => k === 'expanded_detail') && (
        <p className="text-[10px] text-amber-800 px-2 pb-2">
          ↳ Expanded detail will be appended to the item's existing text.
        </p>
      )}
    </details>
  );
}
