// Calendar recurrence: option labels and occurrence expansion.
//
// One interview row is the source of truth. A recurring interview is expanded
// into virtual occurrences across the visible date range at render time — no
// extra rows are stored. Each occurrence reuses the parent interview's data but
// carries its own `date`; everything else (pipeline, resume, follow-ups) keeps
// working off the single underlying row.
import type { Interview, Recurrence } from '../types';

export const RECURRENCE_OPTIONS: { value: '' | Recurrence; label: string }[] = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekday', label: 'Every weekday (Mon–Fri)' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
];

export function recurrenceLabel(r: Recurrence | null | undefined): string {
  if (!r) return 'Does not repeat';
  return RECURRENCE_OPTIONS.find((o) => o.value === r)?.label ?? 'Does not repeat';
}

// Short badge text shown on calendar event pills/blocks.
export function recurrenceShort(r: Recurrence | null | undefined): string {
  switch (r) {
    case 'daily': return 'Daily';
    case 'weekday': return 'Weekdays';
    case 'weekly': return 'Weekly';
    case 'biweekly': return 'Biweekly';
    case 'monthly': return 'Monthly';
    case 'yearly': return 'Yearly';
    default: return '';
  }
}

// Local-time YYYY-MM-DD (calendar dates are timezone-agnostic day keys).
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Does a recurring interview that starts on `startIso` have an occurrence on the
// calendar day `dayIso`? `dayIso` must be on/after the start date.
function occursOn(rec: Recurrence, startIso: string, dayIso: string): boolean {
  const start = new Date(startIso + 'T00:00:00');
  const day = new Date(dayIso + 'T00:00:00');
  if (day < start) return false;
  if (isoOf(day) === isoOf(start)) return true;

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((day.getTime() - start.getTime()) / msPerDay);

  switch (rec) {
    case 'daily':
      return true;
    case 'weekday':
      return day.getDay() !== 0 && day.getDay() !== 6;
    case 'weekly':
      return diffDays % 7 === 0;
    case 'biweekly':
      return diffDays % 14 === 0;
    case 'monthly':
      // Same day-of-month. Days past a short month's end (e.g. the 31st in
      // February) simply don't occur that month.
      return day.getDate() === start.getDate();
    case 'yearly':
      return day.getMonth() === start.getMonth() && day.getDate() === start.getDate();
    default:
      return false;
  }
}

// Expand interviews into per-day occurrences across [rangeStartIso, rangeEndIso]
// (inclusive). Non-recurring interviews contribute a single occurrence on their
// own date if it falls in range. Recurring ones contribute an occurrence for
// every matching day in range. Each occurrence is a shallow clone with its
// `date` set to the occurrence day, plus `_occurrenceDate` for reference.
export type Occurrence = Interview & { _occurrenceDate: string; _isRecurring: boolean };

export function expandOccurrences(
  interviews: Interview[],
  rangeStartIso: string,
  rangeEndIso: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  const rangeStart = new Date(rangeStartIso + 'T00:00:00');
  const rangeEnd = new Date(rangeEndIso + 'T00:00:00');

  for (const it of interviews) {
    if (!it.date) continue;
    const rec = it.recurrence ?? null;

    if (!rec) {
      // One-off: include only if its single date is within range.
      const d = new Date(it.date + 'T00:00:00');
      if (d >= rangeStart && d <= rangeEnd) {
        out.push({ ...it, _occurrenceDate: it.date, _isRecurring: false });
      }
      continue;
    }

    // Recurring: walk each day in range from max(start, rangeStart).
    const start = new Date(it.date + 'T00:00:00');
    const cursor = start > rangeStart ? new Date(start) : new Date(rangeStart);
    for (let d = cursor; d <= rangeEnd; d.setDate(d.getDate() + 1)) {
      const dayIso = isoOf(d);
      if (occursOn(rec, it.date, dayIso)) {
        out.push({ ...it, date: dayIso, _occurrenceDate: dayIso, _isRecurring: true });
      }
    }
  }
  return out;
}
