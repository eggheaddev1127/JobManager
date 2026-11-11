export function formatMoney(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '$0';
  return '$' + Number(n).toLocaleString('en-US');
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function monthKey(iso: string | null | undefined): string {
  if (!iso || iso.length < 7) return '';
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

// Ordered interview steps (used for "latest step" pipeline computation).
// "Job" is the terminal step: the candidate is now working there; the pipeline is complete (not live).
export const STEPS = [
  'Agency Recruiter',
  'Intro',
  'Client Screen',
  'Hiring Manager',
  'Tech Screen',
  'Job',
] as const;

// Steps that have sub-types (multi-select chips below the step dropdown).
export const STEPS_WITH_SUB_TYPES: readonly string[] = ['Tech Screen', 'Client Screen'];

// The available sub-types for tech screens (and client tech screens).
export const TECH_SUB_TYPES = ['Live Coding', 'System Design', 'Discussion'] as const;

export function parseStepDetails(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export function joinStepDetails(arr: string[]): string {
  return Array.from(new Set(arr.filter(Boolean))).join(',');
}

export function stepIndex(step: string | null | undefined): number {
  if (!step) return 999;
  const i = (STEPS as readonly string[]).indexOf(step);
  return i === -1 ? 999 : i;
}

// Normalize progress to one of: Passed / Failed / Waiting / Not started
export function normalizeProgress(p: string | null | undefined): 'Passed' | 'Failed' | 'Waiting' | 'Not started' {
  const v = (p ?? '').toLowerCase().trim();
  if (v === 'passed') return 'Passed';
  if (v === 'failed') return 'Failed';
  if (v.startsWith('waiting')) return 'Waiting';
  return 'Not started';
}

// Canonical storage format is 24-hour "HH:MM-HH:MM" (e.g. "09:00-09:30", "13:30-14:00"),
// produced by the form's two <input type="time"> fields. Old free-text values like
// "9-9.30am", "11.45-12pm", "12:30-1pm" are also accepted for backward compatibility
// (parser falls back to a tolerant 12-hour interpretation).

const SLOT_24H = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/;

export function isCanonicalSlot(slot: string | null | undefined): boolean {
  return !!slot && SLOT_24H.test(slot.trim());
}

// Form-part helpers: four independent digit fields + two independent AM/PM
// toggles. No auto-format rules; the form just collects whatever the user
// types and produces a canonical 24-hour HH:MM-HH:MM on save.

export type SlotParts = {
  startH: string;      // 1-12 (12-hour)
  startM: string;      // 0-59
  startMer: 'AM' | 'PM';
  endH: string;
  endM: string;
  endMer: 'AM' | 'PM';
};

export const EMPTY_SLOT_PARTS: SlotParts = {
  startH: '', startM: '', startMer: 'AM',
  endH: '', endM: '', endMer: 'AM',
};

function to24Hour(h: number, mer: 'AM' | 'PM'): number | null {
  if (isNaN(h) || h < 1 || h > 12) return null;
  if (mer === 'PM' && h < 12) return h + 12;
  if (mer === 'AM' && h === 12) return 0;
  return h;
}

function to12Hour(h: number): { h: string; mer: 'AM' | 'PM' } {
  if (h === 0) return { h: '12', mer: 'AM' };
  if (h === 12) return { h: '12', mer: 'PM' };
  if (h > 12) return { h: String(h - 12), mer: 'PM' };
  return { h: String(h), mer: 'AM' };
}

export function slotToFormParts(slot: string | null | undefined): SlotParts {
  if (!slot) return { ...EMPTY_SLOT_PARTS };
  const m = SLOT_24H.exec(slot.trim());
  if (!m) return { ...EMPTY_SLOT_PARTS };
  const sH = +m[1], sM = m[2], eH = +m[3], eM = m[4];
  const s = to12Hour(sH);
  const e = to12Hour(eH);
  return {
    startH: s.h, startM: sM, startMer: s.mer,
    endH: e.h, endM: eM, endMer: e.mer,
  };
}

export function formPartsToSlot(parts: SlotParts): string {
  const sH = parseInt(parts.startH, 10);
  const eH = parseInt(parts.endH, 10);
  if (isNaN(sH) || isNaN(eH)) return '';
  const sMRaw = parts.startM === '' ? 0 : parseInt(parts.startM, 10);
  const eMRaw = parts.endM === '' ? 0 : parseInt(parts.endM, 10);
  if (isNaN(sMRaw) || isNaN(eMRaw)) return '';
  // Clamp minutes to 0-59
  const sM = Math.max(0, Math.min(59, sMRaw));
  const eM = Math.max(0, Math.min(59, eMRaw));
  const sH24 = to24Hour(sH, parts.startMer);
  const eH24 = to24Hour(eH, parts.endMer);
  if (sH24 === null || eH24 === null) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(sH24)}:${pad(sM)}-${pad(eH24)}:${pad(eM)}`;
}

export function formatSlot(slot: string | null | undefined): string {
  if (!slot) return '';
  const m = SLOT_24H.exec(slot.trim());
  if (!m) return slot; // legacy free-text value — render as-is
  const sH = +m[1], sM = m[2], eH = +m[3], eM = m[4];
  const sMer = sH >= 12 ? 'PM' : 'AM';
  const eMer = eH >= 12 ? 'PM' : 'AM';
  const to12 = (h: number) => (h === 0 ? 12 : h > 12 ? h - 12 : h);
  // Same-meridian: "9:00–9:30am" (one am/pm at the end).
  // Cross-meridian: "11:30am–12:30pm" (one on each side).
  const ls = sMer.toLowerCase();
  const le = eMer.toLowerCase();
  if (sMer === eMer) {
    return `${to12(sH)}:${sM}–${to12(eH)}:${eM}${ls}`;
  }
  return `${to12(sH)}:${sM}${ls}–${to12(eH)}:${eM}${le}`;
}

// Parse a meeting-slot string and return the START time as minutes since midnight.
// Returns null if it can't parse. Used as a tiebreak when sorting interviews by date.
export function parseSlotStartMinutes(slot: string | null | undefined): number | null {
  if (!slot) return null;
  // Canonical 24h "HH:MM-HH:MM" first — unambiguous.
  const m24 = SLOT_24H.exec(slot.trim());
  if (m24) return Number(m24[1]) * 60 + Number(m24[2]);

  // Legacy free-text fallback.
  const s = slot.toLowerCase().trim();
  const parts = s.split(/[-–—]/);
  if (parts.length === 0) return null;
  let startStr = parts[0].trim();
  let endStr = parts.length > 1 ? parts[1].trim() : '';
  const startMer = (startStr.match(/am|pm/) ?? [])[0] ?? '';
  const endMer = (endStr.match(/am|pm/) ?? [])[0] ?? '';
  startStr = startStr.replace(/am|pm/g, '').trim();
  endStr = endStr.replace(/am|pm/g, '').trim();
  const parseTime = (str: string): { h: number; m: number } | null => {
    const m = /(\d+)(?:[.:](\d+))?/.exec(str);
    if (!m) return null;
    return { h: Number(m[1]), m: Number(m[2] ?? 0) };
  };
  const start = parseTime(startStr);
  if (!start) return null;
  const end = parseTime(endStr);
  let merForStart = startMer || endMer || 'am';
  const toMinutes = (h: number, m: number, mer: string) => {
    let hh = h;
    if (mer === 'pm' && h < 12) hh += 12;
    else if (mer === 'am' && h === 12) hh = 0;
    return hh * 60 + m;
  };
  let startMin = toMinutes(start.h, start.m, merForStart);
  if (!startMer && endMer && end) {
    const endMin = toMinutes(end.h, end.m, endMer);
    if (startMin > endMin) {
      const flipped = merForStart === 'pm' ? 'am' : 'pm';
      startMin = toMinutes(start.h, start.m, flipped);
    }
  }
  return startMin;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Follow-up window per step. Intro callbacks tend to take longer than later
// stages — we wait a week before nudging for Intro, 3 days for everything else.
export function followUpWaitDays(step: string | null | undefined): number {
  return (step ?? '').toLowerCase() === 'intro' ? 7 : 3;
}

// "Needs follow up" = progress is Waiting AND ≥ waitDays have elapsed since
// the later of (interview date) or (last time we marked it as followed-up).
// Returns null if no follow-up is needed or the row doesn't qualify.
export function followUpDaysOverdue(it: {
  progress: string | null;
  step: string | null;
  date: string | null;
  last_followed_up_at: string | null;
}): number | null {
  if (normalizeProgress(it.progress) !== 'Waiting') return null;
  const baseline = it.last_followed_up_at || it.date;
  if (!baseline) return null;
  const baselineMs = new Date(baseline + 'T00:00:00').getTime();
  if (isNaN(baselineMs)) return null;
  const days = Math.floor((Date.now() - baselineMs) / (1000 * 60 * 60 * 24));
  const wait = followUpWaitDays(it.step);
  if (days < wait) return null;
  return days - wait;
}

export function needsFollowUp(it: {
  progress: string | null;
  step: string | null;
  date: string | null;
  last_followed_up_at: string | null;
}): boolean {
  return followUpDaysOverdue(it) !== null;
}
