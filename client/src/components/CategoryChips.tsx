import type { Category } from '../types';

// Category chips. Click to toggle. Read-only when onToggle omitted. In `single`
// mode, selecting one chip deselects the rest (radio-like) and clicking the
// active chip clears it.
export default function CategoryChips({ categories, selected, onToggle, empty, single }: {
  categories: Category[];
  selected: number[];
  onToggle?: (id: number) => void;
  empty?: string; // text shown when no categories exist at all
  single?: boolean;
}) {
  if (categories.length === 0) {
    return <span className="cat-chips-empty">{empty ?? 'No categories yet.'}</span>;
  }
  const sel = new Set(selected);
  return (
    <div className="cat-chips">
      {categories.map((c) => {
        const on = sel.has(c.id);
        return (
          <span
            key={c.id}
            className={'cat-chip' + (on ? ' on' : '') + (onToggle ? ' clickable' : '') + (single ? ' cat-chip-radio' : '')}
            onClick={onToggle ? () => onToggle(c.id) : undefined}
          >
            {on && <span className="cat-chip-tick">✓</span>}{c.name}
          </span>
        );
      })}
    </div>
  );
}

// Tiny read-only badges (for a link row): shows just the assigned category names.
export function CategoryTags({ categories, ids }: { categories: Category[]; ids: number[] }) {
  if (!ids || ids.length === 0) return null;
  const byId = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <span className="cat-tags">
      {ids.map((id) => byId.has(id) ? <span key={id} className="cat-tag">{byId.get(id)}</span> : null)}
    </span>
  );
}
