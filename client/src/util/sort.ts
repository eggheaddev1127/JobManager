import { useState } from 'react';

export type SortState<F extends string> = { field: F; dir: 'asc' | 'desc' };

export function useSort<F extends string>(initial: SortState<F>) {
  const [sort, setSort] = useState<SortState<F>>(initial);
  const onSort = (field: F) =>
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }));
  return { sort, setSort, onSort };
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortRows<R, F extends string>(
  rows: R[],
  sort: SortState<F>,
  getValue: (row: R, field: F) => unknown,
): R[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => cmp(getValue(a, sort.field), getValue(b, sort.field)) * dir);
}
