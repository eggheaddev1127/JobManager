// Calendar helpers: time-range parsing, month/week grids, and event packing.
// Reuses the slot parsing from format.ts. Times are minutes-since-midnight,
// interpreted in EST (the app's canonical timezone for meeting slots).
import { parseSlotStartMinutes } from './format';

const SLOT_24H = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

// Parse a meeting slot into start/end minutes-since-midnight. Falls back to a
// 30-minute block when only a start is known.
export function parseSlotRange(slot: string | null | undefined): { start: number; end: number } {
  const start = parseSlotStartMinutes(slot) ?? 0;
  if (!slot) return { start: 0, end: 30 };
  const m = SLOT_24H.exec(slot.trim());
  if (m) {
    const end = Number(m[3]) * 60 + Number(m[4]);
    return { start, end: end > start ? end : start + 30 };
  }
  // Legacy free-text ("1:00–1:45pm"): end inherits the trailing meridiem.
  const s = slot.toLowerCase();
  const trailing = (s.match(/(am|pm)\s*$/) || [])[1] || '';
  const tokens = [...s.matchAll(/(\d{1,2})[.:](\d{2})/g)];
  if (tokens.length >= 2) {
    let h = Number(tokens[1][1]);
    const mm = Number(tokens[1][2]);
    if (trailing === 'pm' && h !== 12) h += 12;
    if (trailing === 'am' && h === 12) h = 0;
    let end = h * 60 + mm;
    if (end <= start) end = start + 30;
    return { start, end };
  }
  return { start, end: start + 30 };
}

// "today" and "now" in EST, regardless of the viewer's local timezone.
export function estNow(): { iso: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + Number(parts.minute) };
}

// minutes <-> "HH:MM" (for <input type=time>) and "8:30 AM" labels.
export function minToTimeInput(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
export function timeInputToMin(str: string): number {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + (m || 0);
}
export function minToLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  const mer = h < 12 ? 'AM' : 'PM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${mer}`;
}
export function fmtHour(h: number): string {
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  return `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
}

// Pack a day's items into side-by-side lanes for overlap layout.
export type PackedEvent<T> = { it: T; start: number; end: number; lane: number; lanes: number };
export function packDayEvents<T extends { meeting_slot: string | null }>(items: T[]): PackedEvent<T>[] {
  const evs: PackedEvent<T>[] = items
    .map((it) => ({ it, ...parseSlotRange(it.meeting_slot), lane: 0, lanes: 1 }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: PackedEvent<T>[] = [];
  let group: PackedEvent<T>[] = [];
  let groupEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    for (const e of group) {
      let placed = false;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= e.start) { e.lane = i; laneEnds[i] = e.end; placed = true; break; }
      }
      if (!placed) { e.lane = laneEnds.length; laneEnds.push(e.end); }
    }
    for (const e of group) { e.lanes = laneEnds.length; out.push(e); }
    group = [];
  };
  for (const e of evs) {
    if (group.length && e.start >= groupEnd) { flush(); groupEnd = -1; }
    group.push(e);
    groupEnd = Math.max(groupEnd, e.end);
  }
  flush();
  return out;
}

// ---- Date grid helpers (iso = YYYY-MM-DD) ----
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export type DayCell = { iso: string; day: number; dow: string; inMonth: boolean };

export function buildMonthGrid(mKey: string): DayCell[][] {
  const [y, m] = mKey.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const cursor = new Date(y, m - 1, 1 - first.getDay());
  const weeks: DayCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        iso: isoOf(cursor),
        day: cursor.getDate(),
        dow: cursor.toLocaleDateString('en-US', { weekday: 'short' }),
        inMonth: cursor.getMonth() === m - 1,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function shiftMonth(mKey: string, delta: number): string {
  const [y, m] = mKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function shiftDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
function startOfWeek(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - d.getDay());
  return isoOf(d);
}
export function weekDays(iso: string): DayCell[] {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + i);
    return {
      iso: isoOf(d), day: d.getDate(),
      dow: d.toLocaleDateString('en-US', { weekday: 'short' }), inMonth: true,
    };
  });
}
export function weekRangeLabel(iso: string): string {
  const days = weekDays(iso);
  const a = new Date(days[0].iso + 'T00:00:00');
  const b = new Date(days[6].iso + 'T00:00:00');
  const sameMonth = a.getMonth() === b.getMonth();
  const aStr = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const bStr = b.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${aStr} – ${bStr}, ${b.getFullYear()}`;
}
export function dayLabel(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
