// Caller Pay schedule projection.
//
// Each job has a payout cycle set on the Running Jobs page: a first-paid date
// (the anchor) and a frequency. From the anchor we project every payout date
// forward. The per-payout amount is the job's monthly caller_payout split by the
// cycle: monthly = full, bi-weekly & semi-monthly = half, weekly = a quarter.

export type PayCycle = 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';

export type Occurrence = { date: string; ts: number };

const DAY = 86400000;

export function cycleDivisor(cycle: string | null | undefined): number {
  switch (cycle) {
    case 'weekly': return 4;
    case 'bi-weekly': return 2;
    case 'semi-monthly': return 2;
    case 'monthly': return 1;
    default: return 0; // unknown/unset cycle → no payouts
  }
}

function parseYMD(s: string | null | undefined): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

function ymd(y: number, mo: number, d: number): string {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// mo is 1-based.
function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function tsOf(y: number, mo: number, d: number): number {
  return Date.UTC(y, mo - 1, d);
}

// Start of the current month and end of the month `months-1` ahead, as a window
// [startTs, endTs]. `months` = how many months the view spans (1 = this month).
export function viewWindow(months: number, now = new Date()): { startTs: number; endTs: number } {
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const startTs = tsOf(curY, curM, 1);
  let endY = curY;
  let endM = curM + (Math.max(1, months) - 1);
  while (endM > 12) { endM -= 12; endY++; }
  const endTs = tsOf(endY, endM, daysInMonth(endY, endM));
  return { startTs, endTs };
}

// Every payout date from the first-paid anchor up to (and including) windowEndTs.
export function projectOccurrences(
  firstPaidDate: string | null | undefined,
  cycle: string | null | undefined,
  windowEndTs: number,
): Occurrence[] {
  const first = parseYMD(firstPaidDate);
  if (!first) return [];
  const firstTs = tsOf(first.y, first.mo, first.d);
  if (firstTs > windowEndTs) return [];
  const out: Occurrence[] = [];

  if (cycle === 'weekly' || cycle === 'bi-weekly') {
    const step = cycle === 'weekly' ? 7 : 14;
    for (let ts = firstTs; ts <= windowEndTs; ts += step * DAY) {
      const dt = new Date(ts);
      out.push({ date: ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()), ts });
    }
  } else if (cycle === 'monthly') {
    let y = first.y;
    let mo = first.mo;
    while (true) {
      const d = Math.min(first.d, daysInMonth(y, mo));
      const ts = tsOf(y, mo, d);
      if (ts > windowEndTs) break;
      if (ts >= firstTs) out.push({ date: ymd(y, mo, d), ts });
      mo++; if (mo > 12) { mo = 1; y++; }
    }
  } else if (cycle === 'semi-monthly') {
    // Two payouts a month: the anchor day D, and D+15 (clamped to month length).
    let y = first.y;
    let mo = first.mo;
    while (tsOf(y, mo, 1) <= windowEndTs) {
      const dim = daysInMonth(y, mo);
      for (const d of [Math.min(first.d, dim), Math.min(first.d + 15, dim)]) {
        const ts = tsOf(y, mo, d);
        if (ts >= firstTs && ts <= windowEndTs) out.push({ date: ymd(y, mo, d), ts });
      }
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    out.sort((a, b) => a.ts - b.ts);
  }

  return out;
}
