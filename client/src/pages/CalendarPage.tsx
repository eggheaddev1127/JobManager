import { useEffect, useMemo, useRef, useState } from 'react';
import { api, HttpError } from '../api';
import type { Interview, InterviewsResponse, Profile, Unavailability, User } from '../types';
import { useAuth, isAdmin as isAdminUser } from '../auth';
import { getCached, setCached } from '../util/dataCache';
import Modal from '../components/Modal';
import { useDialogs } from '../components/Dialog';
import InterviewViewModal from '../components/InterviewViewModal';
import InterviewEditor from '../components/InterviewEditor';
import Empty from '../components/Empty';
import HandlerChip, { HandlerAvatar } from '../components/HandlerChip';
import { ProgressBadge, StepPill } from '../components/StatusBadges';
import { formatDate, formatSlot, monthKey, monthLabel, normalizeProgress } from '../util/format';
import {
  buildMonthGrid, dayLabel, estNow, fmtHour, minToLabel, minToTimeInput,
  packDayEvents, shiftDays, shiftMonth, timeInputToMin, weekDays, weekRangeLabel,
  type DayCell,
} from '../util/calendar';
import { expandOccurrences, recurrenceShort } from '../util/recurrence';

type View = 'day' | 'week' | 'month';
type ByDate = Record<string, Interview[]>;
type UnavailByDate = Record<string, Unavailability[]>;
// A draft block while editing (id may be 0 for a not-yet-saved one).
type UnavailDraft = { id: number; date: string; start: number; end: number; note: string; _isNew?: boolean };

const progressClass = (p: string | null | undefined): string => {
  const n = normalizeProgress(p);
  return n === 'Passed' ? 'passed' : n === 'Failed' ? 'failed' : n === 'Waiting' ? 'waiting' : 'notstarted';
};

export default function CalendarPage() {
  const { user: me } = useAuth();
  const { alert, confirm } = useDialogs();
  const admin = isAdminUser(me);
  const isDevOnly = !admin && (me?.roles ?? []).includes('dev');

  // Initialize from the shared cache (set by either this page or Interviews) so
  // tab navigation renders instantly and revalidates in the background.
  const [interviews, setInterviews] = useState<Interview[]>(() => getCached<InterviewsResponse>('interviews')?.interviews ?? []);
  const [users, setUsers] = useState<User[]>(() => getCached<User[]>('users') ?? []);
  const [profiles, setProfiles] = useState<Profile[]>(() => getCached<Profile[]>('profiles') ?? []);
  const [unavail, setUnavail] = useState<Unavailability[]>(() => getCached<Unavailability[]>('unavailability') ?? []);

  // Remember the chosen view (day/week/month) across navigation.
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem('calendar.view');
    return saved === 'day' || saved === 'week' || saved === 'month' ? saved : 'month';
  });
  useEffect(() => { localStorage.setItem('calendar.view', view); }, [view]);
  // Show/hide Sat+Sun in week & month views (persisted).
  const [showWeekends, setShowWeekends] = useState<boolean>(() => localStorage.getItem('calendar.weekends') !== 'false');
  useEffect(() => { localStorage.setItem('calendar.weekends', String(showWeekends)); }, [showWeekends]);
  // Admins can show/hide dev-marked unavailability (persisted). Devs always see their own.
  const [showUnavail, setShowUnavail] = useState<boolean>(() => localStorage.getItem('calendar.unavail') !== 'false');
  useEffect(() => { localStorage.setItem('calendar.unavail', String(showUnavail)); }, [showUnavail]);
  const [anchor, setAnchor] = useState<string>(() => estNow().iso);
  const [dayModal, setDayModal] = useState<{ iso: string; items: Interview[] } | null>(null);
  const [viewing, setViewing] = useState<Interview | null>(null); // single interview detail (week/day)
  const [editing, setEditing] = useState<Interview | null>(null); // open the editor (existing)
  const [creating, setCreating] = useState<{ date: string; meeting_slot: string } | null>(null); // new, prefilled from a calendar drag
  const [unavailModal, setUnavailModal] = useState<UnavailDraft | null>(null);
  const [handlerHidden, setHandlerHidden] = useState<string[]>([]); // admin: hidden handler NAMES
  const [marking, setMarking] = useState(false);

  const today = estNow().iso;
  const canEditUnavail = isDevOnly;
  const showNames = !isDevOnly;

  const load = async () => {
    try {
      const [iv, un, pr] = await Promise.all([
        api.interviews.list(),
        api.unavailability.list().catch(() => []),
        api.profiles.list().catch(() => []),
      ]);
      setInterviews(iv.interviews); setCached('interviews', iv);
      setUnavail(un); setCached('unavailability', un);
      setProfiles(pr); setCached('profiles', pr);
      if (admin) {
        try { const u = await api.users.list(); setUsers(u); setCached('users', u); } catch { /* non-fatal */ }
      } else if (me) {
        setUsers([me]);
      }
    } catch (e) {
      console.error(e);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [admin, me?.id]);

  // Marking mode must never survive becoming a non-dev.
  useEffect(() => { if (!canEditUnavail && marking) setMarking(false); }, [canEditUnavail, marking]);

  const visible = useMemo(() => interviews.filter((it) => {
    if (isDevOnly) return true; // server already scopes devs to their own
    if (handlerHidden.includes(it.handler ?? '')) return false;
    return true;
  }), [interviews, isDevOnly, handlerHidden]);

  // The date span currently on screen — used to expand recurring interviews into
  // virtual per-day occurrences just for what's visible (month grid is 6 weeks).
  const range = useMemo<{ start: string; end: string }>(() => {
    if (view === 'month') {
      const cells = buildMonthGrid(monthKey(anchor)).flat();
      return { start: cells[0].iso, end: cells[cells.length - 1].iso };
    }
    if (view === 'week') {
      const wd = weekDays(anchor);
      return { start: wd[0].iso, end: wd[6].iso };
    }
    return { start: anchor, end: anchor };
  }, [view, anchor]);

  // byDate keys are occurrence days: a recurring interview appears on every day
  // it repeats within the visible range; one-offs appear on their single date.
  const byDate = useMemo<ByDate>(() => {
    const m: ByDate = {};
    for (const occ of expandOccurrences(visible, range.start, range.end)) {
      (m[occ.date!] = m[occ.date!] || []).push(occ);
    }
    return m;
  }, [visible, range]);

  const unavailByDate = useMemo<UnavailByDate>(() => {
    const m: UnavailByDate = {};
    for (const u of unavail) {
      if (!isDevOnly && handlerHidden.includes(u.user_name)) continue;
      (m[u.date] = m[u.date] || []).push(u);
    }
    return m;
  }, [unavail, isDevOnly, handlerHidden]);
  // Admins can hide dev-marked unavailability via the toggle; devs always see their own.
  const visibleUnavail = (!isDevOnly && !showUnavail) ? {} : unavailByDate;

  // ---- Unavailability mutations (devs only) ----
  const onCreateUnavail = async (iso: string, start: number, end: number) => {
    if (!canEditUnavail) return;
    const temp: Unavailability = { id: -Date.now(), user_id: me!.id, user_name: me!.name, date: iso, start_min: start, end_min: end, note: null };
    setUnavail((list) => [...list, temp]);
    try {
      const saved = await api.unavailability.create({ date: iso, start, end });
      setUnavail((list) => list.map((b) => (b.id === temp.id ? saved : b)));
    } catch (e) {
      setUnavail((list) => list.filter((b) => b.id !== temp.id));
      await alert({ title: 'Could not save', message: e instanceof HttpError ? e.message : String(e) });
    }
  };

  const saveUnavail = async (d: UnavailDraft) => {
    try {
      if (d._isNew || d.id <= 0) {
        const saved = await api.unavailability.create({ date: d.date, start: d.start, end: d.end, note: d.note });
        setUnavail((list) => [...list, saved]);
      } else {
        const saved = await api.unavailability.update(d.id, { date: d.date, start: d.start, end: d.end, note: d.note });
        setUnavail((list) => list.map((b) => (b.id === d.id ? saved : b)));
      }
      setUnavailModal(null);
    } catch (e) {
      await alert({ title: 'Could not save', message: e instanceof HttpError ? e.message : String(e) });
    }
  };

  const removeUnavail = async (id: number) => {
    const prev = unavail;
    setUnavail((list) => list.filter((b) => b.id !== id));
    if (id <= 0) return; // temp/unsaved
    try { await api.unavailability.remove(id); }
    catch (e) { setUnavail(prev); await alert({ title: 'Could not delete', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  // ---- Interview delete (admin only) ----
  const removeInterview = async (it: Interview) => {
    if (!admin) return;
    // A recurring interview is a single row expanded across the calendar, so
    // deleting it removes every occurrence — make that explicit.
    const recurring = !!it.recurrence;
    const message = recurring
      ? 'This is a repeating interview — deleting it removes the whole series (every occurrence on the calendar).'
      : 'This permanently removes the interview.';
    if (!(await confirm({ title: recurring ? 'Delete repeating interview?' : 'Delete interview?', message, confirmLabel: 'Delete' }))) return;
    const prev = interviews;
    setInterviews((list) => list.filter((x) => x.id !== it.id));
    try {
      await api.interviews.remove(it.id);
      load();
    } catch (e) {
      setInterviews(prev);
      await alert({ title: 'Could not delete', message: e instanceof HttpError ? e.message : String(e) });
    }
  };

  // ---- Navigation ----
  const go = (dir: number) => {
    if (view === 'month') setAnchor((a) => shiftMonth(monthKey(a), dir) + '-01');
    else if (view === 'week') setAnchor((a) => shiftDays(a, dir * 7));
    else setAnchor((a) => shiftDays(a, dir));
  };
  const label = view === 'month' ? monthLabel(monthKey(anchor)) : view === 'week' ? weekRangeLabel(anchor) : dayLabel(anchor);

  const rangeCount = useMemo(() => {
    // Count occurrences actually shown in the current range (includes repeats).
    if (view === 'month') {
      return Object.entries(byDate)
        .filter(([iso]) => monthKey(iso) === monthKey(anchor))
        .reduce((n, [, items]) => n + items.length, 0);
    }
    if (view === 'week') {
      const set = new Set(weekDays(anchor).map((d) => d.iso));
      return Object.entries(byDate)
        .filter(([iso]) => set.has(iso))
        .reduce((n, [, items]) => n + items.length, 0);
    }
    return (byDate[anchor] || []).length;
  }, [view, anchor, byDate]);

  const handlers = users.filter((u) => u.active && u.roles.includes('dev'));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-subtitle">
            {isDevOnly
              ? <>Your scheduled interviews, <strong>{me?.name}</strong>. Times are EST.</>
              : 'All scheduled interviews across the team. Times are EST.'}
          </p>
        </div>
        <div className="page-actions">
          <div className="seg">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="btn btn-icon" onClick={() => go(-1)} title="Previous">‹</button>
          <button className="btn btn-icon" onClick={() => go(1)} title="Next">›</button>
        </div>
        <span className="cal-month-label">{label}</span>
        <button className="btn" onClick={() => setAnchor(today)}>Today</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {rangeCount} interview{rangeCount === 1 ? '' : 's'}
        </span>

        {canEditUnavail && (
          <button
            className={'btn' + (marking ? ' btn-primary' : '')}
            style={{ marginLeft: 4 }}
            onClick={() => {
              const next = !marking;
              setMarking(next);
              if (next && view === 'month') setView('week');
            }}
          >
            {marking ? '✓ Done marking' : '＋ Mark unavailability'}
          </button>
        )}

        {!isDevOnly && (
          <div className="filter-group" style={{ marginLeft: 8 }}>
            <label>Handlers</label>
            <HandlerFilter users={users} handlers={handlers} hidden={handlerHidden} setHidden={setHandlerHidden} />
          </div>
        )}

        {/* Admins can show/hide dev-marked unavailability (week + day views). */}
        {!isDevOnly && view !== 'month' && (
          <label className="toggle" style={{ marginLeft: 8 }}>
            <input type="checkbox" checked={showUnavail} onChange={(e) => setShowUnavail(e.target.checked)} />
            <span className="toggle-switch"></span>
            <span>Dev unavailability</span>
          </label>
        )}

        {view !== 'day' && (
          <label className="toggle" style={{ marginLeft: isDevOnly ? 8 : 0 }}>
            <input type="checkbox" checked={showWeekends} onChange={(e) => setShowWeekends(e.target.checked)} />
            <span className="toggle-switch"></span>
            <span>Weekends</span>
          </label>
        )}

        <span className="cal-legend">
          <span className="cal-legend-item"><span className="cal-dot passed"></span>Passed</span>
          <span className="cal-legend-item"><span className="cal-dot waiting"></span>Waiting</span>
          <span className="cal-legend-item"><span className="cal-dot failed"></span>Failed</span>
          <span className="cal-legend-item"><span className="cal-dot notstarted"></span>Not started</span>
          {view !== 'month' && <span className="cal-legend-item"><span className="legend-swatch unavail"></span>Unavailable</span>}
        </span>
      </div>

      {view !== 'month' && (
        <div style={{ margin: '0 0 12px', fontSize: 12.5 }}>
          {canEditUnavail
            ? (marking
                ? <span className="tg-hint" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>✏️ Marking on — drag down a column to block out time. Click a block to edit or remove it. Press “Done marking” when finished.</span>
                : <span className="tg-hint">🔒 Click “Mark unavailability”, then drag on the calendar to block your time. Admins can see it.</span>)
            : showNames
              ? <span className="tg-hint">{admin ? '🖱️ Drag on a day to create an interview for that time range. ' : ''}🔒 Hatched blocks are dev-marked unavailable time (labelled by person).</span>
              : null}
        </div>
      )}

      {view === 'month' && (
        <MonthView anchor={anchor} byDate={byDate} today={today} showWeekends={showWeekends}
                   onOpenDay={(iso, items) => setDayModal({ iso, items })} />
      )}
      {view === 'week' && (
        <TimeGrid days={showWeekends ? weekDays(anchor) : weekDays(anchor).filter((d) => d.dow !== 'Sat' && d.dow !== 'Sun')} byDate={byDate} today={today}
                  unavailByDate={visibleUnavail} canEdit={canEditUnavail} showNames={showNames}
                  currentUserId={me!.id} marking={marking && canEditUnavail} onCreateUnavail={onCreateUnavail}
                  canCreate={admin} onCreateInterview={(iso, start, end) => setCreating({ date: iso, meeting_slot: `${minToTimeInput(start)}-${minToTimeInput(end)}` })}
                  onEditUnavail={(b) => setUnavailModal(b)} onRemoveUnavail={removeUnavail}
                  onOpenInterview={(it) => setViewing(it)} />
      )}
      {view === 'day' && (
        <TimeGrid days={[dayCellOf(anchor)]} byDate={byDate} today={today}
                  unavailByDate={visibleUnavail} canEdit={canEditUnavail} showNames={showNames}
                  currentUserId={me!.id} marking={marking && canEditUnavail} onCreateUnavail={onCreateUnavail}
                  canCreate={admin} onCreateInterview={(iso, start, end) => setCreating({ date: iso, meeting_slot: `${minToTimeInput(start)}-${minToTimeInput(end)}` })}
                  onEditUnavail={(b) => setUnavailModal(b)} onRemoveUnavail={removeUnavail}
                  onOpenInterview={(it) => setViewing(it)} />
      )}

      {dayModal && (
        <DayModal iso={dayModal.iso} items={dayModal.items} users={users}
                  onClose={() => setDayModal(null)} onOpenInterview={(it) => { setDayModal(null); setViewing(it); }} />
      )}
      {viewing && (
        <InterviewViewModal
          interview={viewing}
          users={users}
          allInterviews={interviews}
          onClose={() => setViewing(null)}
          onEdit={() => {
            // `viewing` may be a recurring *occurrence* (cloned with the clicked
            // day's date). Edit the underlying master row so saving never moves
            // the series onto a single occurrence's date.
            const orig = interviews.find((x) => x.id === viewing.id) ?? viewing;
            setViewing(null); setEditing(orig);
          }}
          onDelete={admin ? () => { const it = viewing; setViewing(null); void removeInterview(it); } : undefined}
          onChanged={load}
        />
      )}
      {editing && (
        <InterviewEditor
          existing={editing}
          profiles={profiles}
          users={users}
          currentUser={me!}
          devOnly={isDevOnly}
          allInterviews={interviews}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {creating && (
        <InterviewEditor
          existing={null}
          prefill={creating}
          profiles={profiles}
          users={users}
          currentUser={me!}
          devOnly={isDevOnly}
          allInterviews={interviews}
          onClose={() => setCreating(null)}
          onSaved={() => { setCreating(null); load(); }}
        />
      )}
      {unavailModal && (
        <UnavailModal block={unavailModal} onSave={saveUnavail} onClose={() => setUnavailModal(null)} onDelete={removeUnavail} />
      )}
    </div>
  );
}

function dayCellOf(iso: string): DayCell {
  const d = new Date(iso + 'T00:00:00');
  return { iso, day: d.getDate(), dow: d.toLocaleDateString('en-US', { weekday: 'long' }), inMonth: true };
}

// ---------- Month view ----------
const isWeekendDow = (dow: string) => dow === 'Sat' || dow === 'Sun';

function MonthView({ anchor, byDate, today, showWeekends, onOpenDay }: {
  anchor: string; byDate: ByDate; today: string; showWeekends: boolean;
  onOpenDay: (iso: string, items: Interview[]) => void;
}) {
  const weeks = useMemo(() => buildMonthGrid(monthKey(anchor)), [anchor]);
  const weekdayLabels = showWeekends ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const cells = weeks.flat().filter((c) => showWeekends || !isWeekendDow(c.dow));
  return (
    <div className={'cal' + (showWeekends ? '' : ' no-weekends')}>
      <div className="cal-weekdays">
        {weekdayLabels.map((d) => <div key={d} className="cal-weekday">{d}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((cell) => {
          const items = (byDate[cell.iso] || []).slice().sort((a, b) => (a.meeting_slot ?? '').localeCompare(b.meeting_slot ?? ''));
          const isToday = cell.iso === today;
          const shown = items.slice(0, 3);
          const extra = items.length - shown.length;
          return (
            <div key={cell.iso} className={'cal-cell' + (cell.inMonth ? '' : ' out') + (isToday ? ' is-today' : '')}>
              <div className="cal-daynum">
                <span></span>
                <span className="cal-daynum-badge">{cell.day}</span>
              </div>
              {shown.map((it) => <EventPill key={it.id} it={it} cls={progressClass(it.progress)} onClick={() => onOpenDay(cell.iso, items)} />)}
              {extra > 0 && <button className="cal-event-more" onClick={() => onOpenDay(cell.iso, items)}>+{extra} more</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Time-grid (Day + Week) — full 24h, scrollable ----------
const TG_HOUR_H = 48;
const TG_SCROLL_TO = 7;

function TimeGrid({ days, byDate, today, onOpenInterview, unavailByDate, canEdit, showNames, currentUserId, marking, onCreateUnavail, canCreate, onCreateInterview, onEditUnavail, onRemoveUnavail }: {
  days: DayCell[]; byDate: ByDate; today: string;
  onOpenInterview: (it: Interview) => void;
  unavailByDate: UnavailByDate; canEdit: boolean; showNames: boolean; currentUserId: number;
  marking: boolean;
  onCreateUnavail: (iso: string, start: number, end: number) => void;
  canCreate: boolean;
  onCreateInterview: (iso: string, start: number, end: number) => void;
  onEditUnavail: (b: UnavailDraft) => void;
  onRemoveUnavail: (id: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pxPerMin = TG_HOUR_H / 60;
  const gridHeight = 24 * TG_HOUR_H;
  const hours = Array.from({ length: 24 }, (_, h) => h);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = TG_SCROLL_TO * TG_HOUR_H; }, [days.length]);

  const nowMin = estNow().minutes;
  const nowTop = nowMin * pxPerMin;

  // Drag-to-create. Two modes, mutually exclusive per user: devs drag in
  // "marking" mode to block unavailable time; admins drag to create an
  // interview (Google-Calendar style) — on release the editor opens prefilled
  // with that date and time range.
  type DragMode = 'unavail' | 'interview';
  const dragRef = useRef<{ iso: string; colTop: number; a: number; b: number; mode: DragMode } | null>(null);
  const [drag, setDrag] = useState<{ iso: string; a: number; b: number; mode: DragMode } | null>(null);
  const snap = (m: number) => Math.max(0, Math.min(24 * 60, Math.round(m / 15) * 15));
  const yToMin = (clientY: number, colTop: number) => snap((clientY - colTop) / pxPerMin);

  const onColMouseDown = (e: React.MouseEvent, iso: string) => {
    const mode: DragMode | null = (marking && canEdit) ? 'unavail' : (canCreate ? 'interview' : null);
    if (!mode) return;
    if ((e.target as HTMLElement).closest('.tg-unavail') || (e.target as HTMLElement).closest('.tg-event')) return;
    e.preventDefault();
    const colTop = (e.currentTarget as HTMLElement).getBoundingClientRect().top;
    const a = yToMin(e.clientY, colTop);
    dragRef.current = { iso, colTop, a, b: a, mode };
    setDrag({ iso, a, b: a, mode });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      d.b = yToMin(e.clientY, d.colTop);
      setDrag({ iso: d.iso, a: d.a, b: d.b, mode: d.mode });
    };
    const up = () => {
      const d = dragRef.current;
      if (d) {
        let start = Math.min(d.a, d.b), end = Math.max(d.a, d.b);
        // A click (no real drag) → a sensible default block: 45 min for an
        // interview, 30 min for unavailability.
        if (end - start < 15) end = Math.min(start + (d.mode === 'interview' ? 45 : 30), 24 * 60);
        if (end > start) {
          if (d.mode === 'interview') onCreateInterview(d.iso, start, end);
          else onCreateUnavail(d.iso, start, end);
        }
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    // eslint-disable-next-line
  }, [!!drag]);

  return (
    <div className="tg">
      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-head">
          <div className="tg-gutter-head">EST</div>
          {days.map((d) => (
            <div key={d.iso} className={'tg-dayhead' + (d.iso === today ? ' is-today' : '')}>
              <span className="tg-dow">{d.dow}</span>
              <span className="tg-num">{d.day}</span>
            </div>
          ))}
        </div>
        <div className="tg-body">
          <div className="tg-gutter" style={{ height: gridHeight }}>
            {hours.map((h) => (
              <div key={h} className="tg-hour" style={{ height: TG_HOUR_H }}>
                {h !== 0 && <span className="tg-hour-label">{fmtHour(h)}</span>}
              </div>
            ))}
          </div>
          <div className="tg-cols">
            {days.map((d) => {
              const packed = packDayEvents(byDate[d.iso] || []);
              const blocks = unavailByDate[d.iso] || [];
              const isToday = d.iso === today;
              const showPreview = drag && drag.iso === d.iso;
              return (
                <div key={d.iso}
                     className={'tg-col' + (isToday ? ' is-today' : '') + (marking ? ' marking' : '') + (!marking && canCreate ? ' creating' : '')}
                     style={{ height: gridHeight }}
                     onMouseDown={(e) => onColMouseDown(e, d.iso)}>
                  {hours.map((h) => <div key={h} className="tg-line" style={{ height: TG_HOUR_H }}></div>)}

                  {blocks.map((b) => {
                    const top = b.start_min * pxPerMin;
                    const height = Math.max((b.end_min - b.start_min) * pxPerMin - 2, 16);
                    const tall = height >= 30;
                    const mine = b.user_id === currentUserId;
                    return (
                      <div key={b.id} className="tg-unavail" style={{ top, height }}
                           title={`Unavailable${showNames ? ' · ' + b.user_name : ''} · ${minToLabel(b.start_min)}–${minToLabel(b.end_min)}${b.note ? ' · ' + b.note : ''}`}
                           onMouseDown={(e) => e.stopPropagation()}
                           onClick={(e) => { e.stopPropagation(); if (marking && mine) onEditUnavail({ id: b.id, date: b.date, start: b.start_min, end: b.end_min, note: b.note ?? '' }); }}>
                        <span className="tg-unavail-title">{showNames ? b.user_name : 'Unavailable'}</span>
                        {tall && <span className="tg-unavail-sub">{minToLabel(b.start_min)}–{minToLabel(b.end_min)}</span>}
                        {tall && b.note && <span className="tg-unavail-sub">{b.note}</span>}
                        {marking && mine && (
                          <button className="tg-unavail-x" title="Remove"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => { e.stopPropagation(); onRemoveUnavail(b.id); }}>✕</button>
                        )}
                      </div>
                    );
                  })}

                  {showPreview && (() => {
                    const s = Math.min(drag!.a, drag!.b), en = Math.max(drag!.a, drag!.b);
                    return <div className={'tg-drag-preview' + (drag!.mode === 'interview' ? ' interview' : '')} style={{ top: s * pxPerMin, height: Math.max((en - s) * pxPerMin, 4) }}>
                      {en - s >= 30 ? `${minToLabel(s)}–${minToLabel(en)}` : ''}
                    </div>;
                  })()}

                  {isToday && <div className="tg-now" style={{ top: nowTop }}></div>}

                  {packed.map((e) => {
                    const top = e.start * pxPerMin;
                    const height = Math.max((e.end - e.start) * pxPerMin - 2, 18);
                    const widthPct = 100 / e.lanes;
                    const leftPct = e.lane * widthPct;
                    const dur = e.end - e.start;            // slot length in minutes
                    const oneLine = dur <= 30;              // ≤30 min slot → company + time on one line
                    const phone = e.it.meeting_type === 'phone' ? '📞 ' : '';
                    const repeat = e.it.recurrence ? '↻ ' : '';
                    const company = e.it.company_name || '—';
                    const timeLabel = formatSlot(e.it.meeting_slot);
                    return (
                      <button key={e.it.id}
                              className={'tg-event ' + progressClass(e.it.progress) + (oneLine ? ' oneline' : '')}
                              style={{ top, height, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, zIndex: e.lane + 1 }}
                              title={`${timeLabel} · ${company}`}
                              onMouseDown={(ev) => ev.stopPropagation()}
                              onClick={(ev) => { ev.stopPropagation(); onOpenInterview(e.it); }}>
                        {oneLine ? (
                          <span className="tg-ev-oneline">{phone}{repeat}{company} · {timeLabel}</span>
                        ) : (
                          <>
                            <span className="tg-ev-title">{phone}{repeat}{company}</span>
                            <span className="tg-ev-sub">{timeLabel}</span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Shared event pill (month) ----------
function EventPill({ it, cls, onClick }: { it: Interview; cls: string; onClick: () => void }) {
  return (
    <button className={'cal-event ' + cls} onClick={onClick} title={it.recurrence ? recurrenceShort(it.recurrence) : undefined}>
      <span className="cal-event-top">{it.meeting_type === 'phone' ? '📞 ' : ''}{it.recurrence ? '↻ ' : ''}{it.company_name || '—'}</span>
      <span className="cal-event-slot">{formatSlot(it.meeting_slot)} · {it.profile_name || '—'}</span>
    </button>
  );
}

// ---------- Day modal (month view: lists a day's interviews; click one for full detail) ----------
function DayModal({ iso, items, users, onClose, onOpenInterview }: {
  iso: string; items: Interview[]; users: User[]; onClose: () => void; onOpenInterview: (it: Interview) => void;
}) {
  const sorted = items.slice().sort((a, b) => (a.meeting_slot ?? '').localeCompare(b.meeting_slot ?? ''));
  return (
    <Modal title={formatDate(iso)} onClose={onClose}>
      {sorted.length === 0 && <Empty title="No interviews" hint="Nothing scheduled this day." />}
      {sorted.map((it) => (
        <button className="detail-card detail-card-btn" key={it.id} onClick={() => onOpenInterview(it)}>
          <div className="detail-card-head">
            <div className="detail-title">{it.company_name || '—'}</div>
            <ProgressBadge progress={it.progress} />
          </div>
          <div className="detail-list">
            <div className="detail-row"><span className="detail-k">Time</span>
              <span className="detail-v num">{formatSlot(it.meeting_slot) || '—'} <span className="muted">EST</span></span></div>
            <div className="detail-row"><span className="detail-k">Profile</span>
              <span className="detail-v">{it.profile_name || '—'}</span></div>
            <div className="detail-row"><span className="detail-k">Step</span>
              <span className="detail-v"><StepPill step={it.step} /></span></div>
            <div className="detail-row"><span className="detail-k">Handler</span>
              <span className="detail-v"><HandlerChip handlerName={it.handler} users={users} /></span></div>
          </div>
          <span className="detail-card-cta">View full details →</span>
        </button>
      ))}
    </Modal>
  );
}

// ---------- Unavailability editor ----------
function UnavailModal({ block, onSave, onClose, onDelete }: {
  block: UnavailDraft; onSave: (b: UnavailDraft) => void; onClose: () => void; onDelete: (id: number) => void;
}) {
  const [b, setB] = useState<UnavailDraft>(block);
  const set = <K extends keyof UnavailDraft>(k: K, v: UnavailDraft[K]) => setB((x) => ({ ...x, [k]: v }));
  const valid = b.end > b.start;
  return (
    <Modal
      title={block._isNew ? 'Mark unavailable' : 'Edit unavailable time'}
      onClose={onClose}
      footer={<>
        {!block._isNew && (
          <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => { onDelete(b.id); onClose(); }}>Delete</button>
        )}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!valid} onClick={() => valid && onSave(b)}>Save</button>
      </>}
    >
      <div className="form-grid">
        <div className="form-field full">
          <label>Date</label>
          <input type="date" value={b.date} onChange={(e) => set('date', e.target.value)} />
        </div>
        <div className="form-field">
          <label>From</label>
          <input type="time" step={900} value={minToTimeInput(b.start)} onChange={(e) => set('start', timeInputToMin(e.target.value))} />
        </div>
        <div className="form-field">
          <label>To</label>
          <input type="time" step={900} value={minToTimeInput(b.end)} onChange={(e) => set('end', timeInputToMin(e.target.value))} />
        </div>
        <div className="form-field full">
          <label>Note <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-soft)' }}>(optional)</span></label>
          <input value={b.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Lunch, appointment…" />
        </div>
        {!valid && <div className="form-field full" style={{ color: 'var(--danger)', fontSize: 12 }}>End time must be after start time.</div>}
      </div>
    </Modal>
  );
}

// ---------- Admin handler filter ----------
function HandlerFilter({ users, handlers, hidden, setHidden }: {
  users: User[]; handlers: User[]; hidden: string[]; setHidden: (fn: (h: string[]) => string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const shownCount = handlers.filter((h) => !hidden.includes(h.name)).length;
  const allShown = handlers.every((h) => !hidden.includes(h.name));
  const toggle = (name: string) => setHidden((h) => h.includes(name) ? h.filter((x) => x !== name) : [...h, name]);

  return (
    <div className="hf" ref={ref}>
      <button className={'select hf-trigger' + (allShown ? '' : ' active')} onClick={() => setOpen((o) => !o)}>
        {allShown ? 'All devs' : `${shownCount} of ${handlers.length} devs`}
        <span className="hf-caret">▾</span>
      </button>
      {open && (
        <div className="hf-pop">
          <div className="hf-actions">
            <button className="btn btn-ghost" onClick={() => setHidden(() => [])}>Show all</button>
            <button className="btn btn-ghost" onClick={() => setHidden(() => handlers.map((h) => h.name))}>Hide all</button>
          </div>
          {handlers.map((h) => (
            <label key={h.id} className="hf-row">
              <input type="checkbox" checked={!hidden.includes(h.name)} onChange={() => toggle(h.name)} />
              <HandlerAvatar name={h.name} users={users} />
              <span className="hf-name">{h.name}</span>
            </label>
          ))}
          {handlers.length === 0 && <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--text-muted)' }}>No dev handlers.</div>}
        </div>
      )}
    </div>
  );
}
