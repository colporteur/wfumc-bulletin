import { useEffect, useState } from 'react';
import { supabase, withTimeout } from '../../../lib/supabase';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';
import SortableList, { DragHandle } from '../../../components/SortableList.jsx';

// Block types we expose in the admin "Add" menu. ('photo' is in the DB
// schema but waits until the Supabase Storage bucket is set up.)
const BLOCK_TYPES = [
  { value: 'result', label: 'Game / event result' },
  { value: 'quote', label: 'Quote' },
  { value: 'table', label: 'Table (label / value rows)' },
  { value: 'note', label: 'Freeform note' },
];

const blockTypeLabel = (t) =>
  BLOCK_TYPES.find((b) => b.value === t)?.label ?? t;

function defaultDataForType(t) {
  switch (t) {
    case 'result':
      return { winner: '', winner_score: '', loser: '', loser_score: '' };
    case 'quote':
      return { text: '', author: '' };
    case 'table':
      return { title: '', rows: [{ label: '', value: '' }] };
    case 'note':
      return { text: '' };
    default:
      return {};
  }
}

export default function CommunitySection({ bulletin }) {
  const bulletinId = bulletin?.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [addType, setAddType] = useState('result');

  const load = async () => {
    if (!bulletinId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('tools_blocks')
          .select('*')
          .eq('bulletin_id', bulletinId)
          .order('position', { ascending: true })
      );
      if (err) throw err;
      setBlocks(data ?? []);
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

  const addBlock = async () => {
    setError(null);
    try {
      const nextPos =
        blocks.length === 0
          ? 0
          : Math.max(...blocks.map((b) => b.position)) + 1;
      const { data, error: err } = await withTimeout(
        supabase
          .from('tools_blocks')
          .insert({
            bulletin_id: bulletinId,
            position: nextPos,
            block_type: addType,
            data: defaultDataForType(addType),
          })
          .select()
          .single()
      );
      if (err) throw err;
      setBlocks((bs) => [...bs, data]);
    } catch (e) {
      setError(e.message);
    }
  };

  const updateBlockData = async (id, newData) => {
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('tools_blocks')
          .update({ data: newData })
          .eq('id', id)
          .select()
          .single()
      );
      if (err) throw err;
      setBlocks((bs) => bs.map((b) => (b.id === id ? data : b)));
    } catch (e) {
      setError(e.message);
    }
  };

  const removeBlock = async (id) => {
    if (!window.confirm('Remove this block?')) return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('tools_blocks').delete().eq('id', id)
      );
      if (err) throw err;
      setBlocks((bs) => bs.filter((b) => b.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  const reorderBlocks = async (newOrderedIds) => {
    setError(null);
    const oldBlocks = blocks;
    const newBlocks = newOrderedIds
      .map((id) => oldBlocks.find((b) => b.id === id))
      .filter(Boolean);
    setBlocks(newBlocks.map((b, i) => ({ ...b, position: i })));
    try {
      await Promise.all(
        oldBlocks.map((b, i) =>
          withTimeout(
            supabase.from('tools_blocks').update({ position: -1 - i }).eq('id', b.id)
          )
        )
      );
      await Promise.all(
        newBlocks.map((b, i) =>
          withTimeout(
            supabase.from('tools_blocks').update({ position: i }).eq('id', b.id)
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
        <h2 className="font-serif text-xl text-umc-900">Community (TOOLs)</h2>
        <p className="text-sm text-gray-600 mt-1">
          Flexible blocks for the Time Of Our Lives section. Mix and match
          results, quotes, tables, and notes. Drag the ⋮⋮ handle to reorder.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="card flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-600">Add block:</span>
        <select
          className="text-sm border border-gray-300 rounded px-2 py-1"
          value={addType}
          onChange={(e) => setAddType(e.target.value)}
        >
          {BLOCK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={addBlock} className="btn-primary">
          + Add
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          (Photo blocks coming after image upload is set up.)
        </span>
      </div>

      {blocks.length === 0 && (
        <div className="card text-center text-gray-400 italic text-sm">
          No blocks yet. Use "Add block" above to get started.
        </div>
      )}

      <SortableList
        items={blocks}
        onReorder={reorderBlocks}
        renderItem={(b, handleProps) => (
          <BlockCard
            block={b}
            onUpdate={(newData) => updateBlockData(b.id, newData)}
            onRemove={() => removeBlock(b.id)}
            dragHandleProps={handleProps}
          />
        )}
      />
    </div>
  );
}

function BlockCard({ block, onUpdate, onRemove, dragHandleProps }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <div className="flex items-center gap-1">
          <DragHandle handleProps={dragHandleProps} />
          <span className="text-xs uppercase tracking-wide text-gray-500">
            {blockTypeLabel(block.block_type)}
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

      {block.block_type === 'result' && (
        <ResultEditor data={block.data} onChange={onUpdate} />
      )}
      {block.block_type === 'quote' && (
        <QuoteEditor data={block.data} onChange={onUpdate} />
      )}
      {block.block_type === 'table' && (
        <TableEditor data={block.data} onChange={onUpdate} />
      )}
      {block.block_type === 'note' && (
        <NoteEditor data={block.data} onChange={onUpdate} />
      )}
    </div>
  );
}

function ResultEditor({ data, onChange }) {
  const update = (patch) => onChange({ ...data, ...patch });
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Winner</label>
        <input
          type="text"
          className="input"
          defaultValue={data.winner ?? ''}
          onBlur={(e) => update({ winner: e.target.value })}
          placeholder="e.g., Falcons"
        />
      </div>
      <div>
        <label className="label">Winner score</label>
        <input
          type="text"
          className="input"
          defaultValue={data.winner_score ?? ''}
          onBlur={(e) => update({ winner_score: e.target.value })}
          placeholder="28"
        />
      </div>
      <div>
        <label className="label">Loser</label>
        <input
          type="text"
          className="input"
          defaultValue={data.loser ?? ''}
          onBlur={(e) => update({ loser: e.target.value })}
          placeholder="Saints"
        />
      </div>
      <div>
        <label className="label">Loser score</label>
        <input
          type="text"
          className="input"
          defaultValue={data.loser_score ?? ''}
          onBlur={(e) => update({ loser_score: e.target.value })}
          placeholder="14"
        />
      </div>
    </div>
  );
}

function QuoteEditor({ data, onChange }) {
  const update = (patch) => onChange({ ...data, ...patch });
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Quote</label>
        <textarea
          className="input min-h-[80px]"
          defaultValue={data.text ?? ''}
          onBlur={(e) => update({ text: e.target.value })}
          placeholder="The quote text"
        />
      </div>
      <div>
        <label className="label">Attribution</label>
        <input
          type="text"
          className="input"
          defaultValue={data.author ?? ''}
          onBlur={(e) => update({ author: e.target.value })}
          placeholder="— Mark Twain"
        />
      </div>
    </div>
  );
}

function TableEditor({ data, onChange }) {
  const rows = Array.isArray(data.rows) ? data.rows : [];

  const updateRow = (idx, patch) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange({ ...data, rows: next });
  };

  const addRow = () => onChange({ ...data, rows: [...rows, { label: '', value: '' }] });

  const removeRow = (idx) => onChange({ ...data, rows: rows.filter((_, i) => i !== idx) });

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Title (optional)</label>
        <input
          type="text"
          className="input"
          defaultValue={data.title ?? ''}
          onBlur={(e) => onChange({ ...data, title: e.target.value })}
          placeholder="e.g., Season standings"
        />
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              className="input flex-1"
              defaultValue={r.label ?? ''}
              onBlur={(e) => updateRow(i, { label: e.target.value })}
              placeholder="Label"
            />
            <input
              type="text"
              className="input flex-1"
              defaultValue={r.value ?? ''}
              onBlur={(e) => updateRow(i, { value: e.target.value })}
              placeholder="Value"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="text-xs text-red-600 hover:text-red-800 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addRow} className="btn-secondary text-sm">
          + Add row
        </button>
      </div>
    </div>
  );
}

function NoteEditor({ data, onChange }) {
  return (
    <div>
      <label className="label">Note</label>
      <textarea
        className="input min-h-[120px]"
        defaultValue={data.text ?? ''}
        onBlur={(e) => onChange({ ...data, text: e.target.value })}
        placeholder="Type whatever you'd like to share."
      />
    </div>
  );
}
