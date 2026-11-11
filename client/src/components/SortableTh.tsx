import type { SortState } from '../util/sort';

type Props<F extends string> = {
  field: F;
  sort: SortState<F>;
  onSort: (field: F) => void;
  children: React.ReactNode;
  align?: 'left' | 'right';
  width?: number;
};

export default function SortableTh<F extends string>({ field, sort, onSort, children, align, width }: Props<F>) {
  const active = sort.field === field;
  const style: React.CSSProperties = {};
  if (align) style.textAlign = align;
  if (width) style.width = width;
  return (
    <th
      onClick={() => onSort(field)}
      className={'sortable' + (active ? ' sorted' : '')}
      style={style}
    >
      {children}
      <span className="sort-indicator">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  );
}
