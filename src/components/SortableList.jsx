// Thin wrapper around @dnd-kit/sortable for our position-ordered lists.
//
// Usage:
//   <SortableList
//     items={[{id:'a',...}, {id:'b',...}]}
//     onReorder={(orderedIds) => /* persist new order */}
//     renderItem={(item, dragHandleProps) => <div>{item.title} <Handle {...dragHandleProps}/></div>}
//   />
//
// Each rendered item receives `dragHandleProps` — spread these onto a
// small handle element (we provide <DragHandle/> below for convenience).
//
// Touch support: a small activation distance prevents accidental drags
// when the user means to scroll on mobile.

import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function SortableList({ items, onReorder, renderItem }) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(items, oldIndex, newIndex);
    onReorder(reordered.map((i) => i.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        {items.map((item) => (
          <SortableRow key={item.id} id={item.id}>
            {(handleProps) => renderItem(item, handleProps)}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : 'auto',
  };

  // Pass listeners + attributes down via render-prop so the consumer
  // can apply them to whichever element should be the drag handle.
  const handleProps = { ...attributes, ...listeners };

  return (
    <div ref={setNodeRef} style={style}>
      {children(handleProps)}
    </div>
  );
}

// Convenience: a small grippy drag handle. Spread `handleProps` onto it.
export function DragHandle({ handleProps, label = 'Drag to reorder' }) {
  return (
    <button
      type="button"
      {...handleProps}
      aria-label={label}
      title={label}
      className="text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing touch-none px-1.5 py-1 rounded select-none"
    >
      <span aria-hidden="true" className="font-mono text-base leading-none">
        ⋮⋮
      </span>
    </button>
  );
}
