import { useEffect, useMemo, useState } from 'react';
import { api, HttpError } from '../api';
import type { Interview, InterviewsResponse, Profile, User } from '../types';
import { useAuth, isAdmin, isSuperAdmin } from '../auth';
import SortableTh from '../components/SortableTh';
import Modal from '../components/Modal';
import { useDialogs } from '../components/Dialog';
import InterviewViewModal from '../components/InterviewViewModal';
import InterviewEditor from '../components/InterviewEditor';
import Empty from '../components/Empty';
import LinkIcon from '../components/LinkIcon';
import HandlerChip from '../components/HandlerChip';
import ProfileColorBadge from '../components/ProfileColorBadge';
import CopyButton from '../components/CopyButton';
import ImportExportButtons, { type ImportResult } from '../components/ImportExportButtons';
import TruncatedText from '../components/TruncatedText';
import SlotInput from '../components/SlotInput';
import { StepPill, ProgressBadge } from '../components/StatusBadges';
import { sortRows, useSort } from '../util/sort';
import { getCached, setCached } from '../util/dataCache';
import { autoProfileColor } from '../util/profileColors';
import {
  currentMonthKey, followUpDaysOverdue, followUpWaitDays, formatDate, formatSlot,
  joinStepDetails, monthKey, monthLabel, needsFollowUp, normalizeProgress,
  parseSlotStartMinutes, parseStepDetails, STEPS, STEPS_WITH_SUB_TYPES, stepIndex,
  TECH_SUB_TYPES, todayIso, tomorrowIso,
} from '../util/format';

type SortField =
  | 'date' | 'meeting_slot' | 'profile_name' | 'company_name'
  | 'stepOrder' | 'progress' | 'handler' | 'notes';

type PipelineRow = Interview & { _passed_count?: number; _is_pipeline_latest?: boolean };

export default function InterviewsPage() {
  const { user: me } = useAuth();
  const { confirm, alert } = useDialogs();
  const admin = isAdmin(me);
  const devOnly = !admin && (me?.roles ?? []).includes('dev');

  const [data, setData] = useState<InterviewsResponse | null>(() => getCached<InterviewsResponse>('interviews') ?? null);
  const [profiles, setProfiles] = useState<Profile[]>(() => getCached<Profile[]>('profiles') ?? []);
  const [users, setUsers] = useState<User[]>(() => getCached<User[]>('users') ?? []);
  const [loading, setLoading] = useState(() => !getCached('interviews'));

  const [search, setSearch] = useState('');
  const [statFilter, setStatFilter] = useState<'thisMonth' | 'passed' | 'waiting' | 'failed' | 'live' | 'followup' | 'offered'>('thisMonth');
  const [stepFilter, setStepFilter] = useState<string>('All');
  const [profileFilter, setProfileFilter] = useState<string>('All');
  const [handlerFilter, setHandlerFilter] = useState<string>('All');
  const [month, setMonth] = useState<string>(currentMonthKey());
  const [upcomingOnly, setUpcomingOnly] = useState(false);
  const [editing, setEditing] = useState<Interview | 'new' | null>(null);
  const [viewing, setViewing] = useState<Interview | null>(null);
  const [confirmingFollowUp, setConfirmingFollowUp] = useState<Interview | null>(null);
  const isLive = statFilter === 'live';
  // "Needs follow-up" is a standalone global view (like Live pipelines): it
  // ignores the month and isn't combined with Passed/Waiting/Failed.
  const isFollowUp = statFilter === 'followup';
  // "Offers" is a global grouped view of pipelines where an offer landed.
  const isOffered = statFilter === 'offered';

  const { sort, onSort } = useSort<SortField>({ field: 'date', dir: 'asc' });

  // Revalidate in the background. Only show the "Loading…" state when there's
  // nothing cached to display — edits and tab navigation update silently.
  const load = async () => {
    if (!getCached('interviews')) setLoading(true);
    try {
      const [iv, pr] = await Promise.all([api.interviews.list(), api.profiles.list().catch(() => [])]);
      setData(iv); setCached('interviews', iv);
      setProfiles(pr); setCached('profiles', pr);
      if (admin) {
        try { const u = await api.users.list(); setUsers(u); setCached('users', u); } catch { /* non-fatal */ }
      } else if (me) {
        setUsers([me]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [admin, me?.id]);

  // Months present in current dataset, plus the current month even if empty.
  const allMonths = useMemo<string[]>(() => {
    if (!data) return [currentMonthKey()];
    const set = new Set<string>();
    for (const r of data.interviews) {
      const k = monthKey(r.date);
      if (k) set.add(k);
    }
    set.add(currentMonthKey());
    return Array.from(set).sort().reverse();
  }, [data]);

  // Pipeline rows = one row per live pipeline visible to this user.
  // Pipeline = (profile_name, company_name) — server returns pipeline_key,
  // pipeline_status, and pipeline_first_step_passed, all computed from the
  // FULL interviews table (so other handlers' work counts toward the pipeline).
  //
  // A pipeline is "live" iff ALL of:
  //   - the row at its earliest canonical step has progress=Passed
  //     (pipeline_first_step_passed); AND
  //   - no row anywhere has progress=Failed (pipeline_status !== 'failed'); AND
  //   - no row has step=Job (pipeline_status !== 'complete'; candidate is hired).
  //
  // The surfaced row is the candidate's MOST-ADVANCED step — including rows
  // that are scheduled but Not started yet (e.g. a HM call on the calendar
  // that hasn't happened). Earlier rows are visible in the view modal.
  const pipelineRows = useMemo<PipelineRow[]>(() => {
    if (!data) return [];
    const byKey = new Map<string, Interview[]>();
    for (const r of data.interviews) {
      const key = r.pipeline_key;
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(r);
    }
    const out: PipelineRow[] = [];
    for (const rows of byKey.values()) {
      const head = rows[0];
      if (!head.pipeline_first_step_passed) continue;
      if (head.pipeline_status === 'failed') continue;
      if (head.pipeline_offered) continue; // landed an offer (Job step or marked) → Offers card, not live
      if (rows.length === 0) continue;
      // Surface the candidate's LATEST meeting. Order by DATE first — step order
      // isn't reliable across companies (some do Hiring Manager before Tech Screen,
      // some after), so a step-first sort would bury a later-dated round (e.g. a
      // Hiring Manager call scheduled after the Tech Screen). Same date → break by
      // step (more-advanced last), then by slot (later last).
      const sorted = [...rows].sort((a, b) => {
        const da = a.date ?? '', dbb = b.date ?? '';
        if (da !== dbb) return da.localeCompare(dbb);
        const sa = stepIndex(a.step), sb = stepIndex(b.step);
        if (sa !== sb) return sa - sb;
        return (a.meeting_slot ?? '').localeCompare(b.meeting_slot ?? '');
      });
      const latest = sorted[sorted.length - 1];
      const passedCount = rows.filter((r) => normalizeProgress(r.progress) === 'Passed').length;
      out.push({ ...latest, _passed_count: passedCount, _is_pipeline_latest: true });
    }
    return out;
  }, [data]);

  // Offered pipelines: grouped by pipeline, each with ALL its interviews (the full
  // journey to the offer), sorted chronologically. Newest-offer pipeline first.
  const offeredPipelines = useMemo<{ key: string; rows: Interview[] }[]>(() => {
    if (!data) return [];
    const byKey = new Map<string, Interview[]>();
    for (const r of data.interviews) {
      if (!r.pipeline_offered || !r.pipeline_key) continue;
      if (r.step === 'Job') continue; // Offers lists interview steps only, not the "Job"/offer marker
      if (!byKey.has(r.pipeline_key)) byKey.set(r.pipeline_key, []);
      byKey.get(r.pipeline_key)!.push(r);
    }
    // A pipeline with no interview steps (e.g. only a "Job" row) doesn't belong in
    // Offers — nothing to show — so it's naturally excluded (it's never added above).
    const groups = [...byKey.entries()].map(([key, rows]) => ({
      key,
      rows: [...rows].sort((a, b) => {
        const da = a.date ?? '', dbb = b.date ?? '';
        if (da !== dbb) return da.localeCompare(dbb);
        const sa = stepIndex(a.step), sb = stepIndex(b.step);
        if (sa !== sb) return sa - sb;
        return (a.meeting_slot ?? '').localeCompare(b.meeting_slot ?? '');
      }),
    }));
    // Most recently-active pipeline first (by its latest interview date).
    groups.sort((a, b) => (b.rows[b.rows.length - 1].date ?? '').localeCompare(a.rows[a.rows.length - 1].date ?? ''));
    return groups;
  }, [data]);

  const visibleRows = useMemo<Interview[]>(() => {
    if (!data) return [];
    let base: Interview[] = isLive ? pipelineRows : data.interviews;

    // "Needs follow-up" is a global view: ignore the month and show every row
    // still Waiting past its follow-up window (matches the card's count).
    if (isFollowUp) {
      base = base.filter((r) => needsFollowUp(r));
    }

    // Month filter only in month-scoped views (not live, not follow-up), when
    // "Upcoming only" is off, AND when there's no search — a search spans every
    // month so you can find any interview you've taken regardless of the month.
    if (!isLive && !isFollowUp && month && !upcomingOnly && !search.trim()) {
      base = base.filter((r) => monthKey(r.date) === month);
    }
    // "Upcoming only" — every row with date >= today AND progress = "Not started"
    // (i.e. scheduled but hasn't happened yet). Waiting/Passed/Failed mean the
    // interview already took place, so they're excluded here.
    if (upcomingOnly) {
      const tKey = todayIso();
      base = base.filter((r) =>
        (r.date ?? '') >= tKey && normalizeProgress(r.progress) === 'Not started'
      );
    }
    // Stat-card sub-filter (Passed / Waiting / Failed). Live mode is its own thing.
    // "Job" step interviews only show in the "This month" view — they're hidden
    // from the Passed/Waiting/Failed/Live views since the candidate is hired.
    if (statFilter === 'passed') {
      base = base.filter((r) => normalizeProgress(r.progress) === 'Passed' && r.step !== 'Job');
    } else if (statFilter === 'waiting') {
      base = base.filter((r) => normalizeProgress(r.progress) === 'Waiting' && r.step !== 'Job');
    } else if (statFilter === 'failed') {
      base = base.filter((r) => normalizeProgress(r.progress) === 'Failed' && r.step !== 'Job');
    }
    if (stepFilter !== 'All') {
      base = base.filter((r) => r.step === stepFilter);
    }
    if (profileFilter !== 'All') {
      base = base.filter((r) => (r.profile_name ?? '') === profileFilter);
    }
    if (handlerFilter !== 'All') {
      base = base.filter((r) => (r.handler ?? '').toLowerCase() === handlerFilter.toLowerCase());
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter((r) =>
        [r.company_name, r.profile_name, r.step, r.notes, r.handler]
          .some((v) => String(v ?? '').toLowerCase().includes(q)),
      );
    }

    let sorted: Interview[];
    if (sort.field === 'date') {
      // Date sort with time-of-day tiebreak. Within a single day, ALWAYS earliest meeting
      // first — the user reads it as "what's first today, then what's next", regardless of
      // whether the overall date direction is asc or desc.
      const dir = sort.dir === 'asc' ? 1 : -1;
      sorted = [...base].sort((a, b) => {
        const da = a.date ?? '';
        const db = b.date ?? '';
        if (!da && db) return 1;
        if (da && !db) return -1;
        const dateC = da.localeCompare(db) * dir;
        if (dateC !== 0) return dateC;
        const sa = parseSlotStartMinutes(a.meeting_slot) ?? Number.POSITIVE_INFINITY;
        const sb = parseSlotStartMinutes(b.meeting_slot) ?? Number.POSITIVE_INFINITY;
        return sa - sb;
      });
    } else if (sort.field === 'meeting_slot') {
      const dir = sort.dir === 'asc' ? 1 : -1;
      sorted = [...base].sort((a, b) => {
        const sa = parseSlotStartMinutes(a.meeting_slot) ?? Number.POSITIVE_INFINITY;
        const sb = parseSlotStartMinutes(b.meeting_slot) ?? Number.POSITIVE_INFINITY;
        return (sa - sb) * dir;
      });
    } else {
      sorted = sortRows(base, sort, (r, f) => {
        if (f === 'stepOrder') return stepIndex(r.step);
        if (f === 'progress') return normalizeProgress(r.progress);
        return (r as unknown as Record<string, unknown>)[f];
      });
    }

    // Always display in natural sort order — never pin upcoming rows to the top.
    return sorted;
  }, [data, pipelineRows, isLive, isFollowUp, statFilter, stepFilter, profileFilter, month, handlerFilter, search, sort, upcomingOnly]);

  const todayKey = todayIso();
  const tomorrowKey = tomorrowIso();

  // Effective badge color (hex) for a profile: its chosen color, else an
  // auto-assigned palette color so each candidate is consistently distinct.
  const profileNames = useMemo(() => profiles.map((p) => p.name), [profiles]);
  const profileColor = (name: string): string => {
    const p = profiles.find((pp) => pp.name.toLowerCase() === name.toLowerCase());
    if (p && p.color) return p.color;
    return autoProfileColor(name, profileNames);
  };

  // Persist a profile's chosen badge color (admin only). Optimistic update so
  // every row for that profile recolors immediately.
  const setProfileColor = async (name: string, color: string | null) => {
    const p = profiles.find((pp) => pp.name.toLowerCase() === name.toLowerCase());
    if (!p) return;
    const next = profiles.map((x) => (x.id === p.id ? { ...x, color } : x));
    setProfiles(next); setCached('profiles', next);
    try { await api.profiles.update(p.id, { color }); }
    catch (e) { await load(); await alert({ title: 'Could not update color', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  // Stats reflect only the interviews this user can see (server has already
  // filtered for devs by handler). Live count matches the pipeline view exactly.
  // Note: "Job" step rows count toward `total` (so they show in the This month
  // view) but are excluded from Passed/Waiting/Failed counts to match the
  // filter behavior below.
  const counts = useMemo(() => {
    if (!data) return { total: 0, passed: 0, waiting: 0, failed: 0, live: 0, followUp: 0, offered: 0 };
    const monthRows = data.interviews.filter((r) => monthKey(r.date) === month);
    let passed = 0, waiting = 0, failed = 0;
    for (const r of monthRows) {
      if (r.step === 'Job') continue;
      const p = normalizeProgress(r.progress);
      if (p === 'Passed') passed++;
      else if (p === 'Waiting') waiting++;
      else if (p === 'Failed') failed++;
    }
    // Follow-ups are global (any month), not limited to the selected month.
    const followUp = data.interviews.filter((r) => needsFollowUp(r)).length;
    return { total: monthRows.length, passed, waiting, failed, live: pipelineRows.length, followUp, offered: offeredPipelines.length };
  }, [data, month, pipelineRows, offeredPipelines]);

  const onDelete = async (id: number) => {
    if (!(await confirm({ title: 'Delete interview?', message: 'This permanently removes the interview.', confirmLabel: 'Delete' }))) return;
    try { await api.interviews.remove(id); await load(); }
    catch (e) { await alert({ title: 'Could not delete', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  const onFollowUp = async (id: number) => {
    try { await api.interviews.markFollowedUp(id); await load(); }
    catch (e) { await alert({ title: 'Something went wrong', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  const confirmFollowUp = async () => {
    if (!confirmingFollowUp) return;
    const id = confirmingFollowUp.id;
    setConfirmingFollowUp(null);
    await onFollowUp(id);
  };

  const handleSaved = () => { setEditing(null); load(); };

  const importInterviews = async (rows: unknown[]): Promise<ImportResult> => {
    let imported = 0, skipped = 0;
    const errors: string[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') { skipped++; continue; }
      const r = row as Record<string, unknown>;
      if (!r.company_name) { skipped++; continue; }
      try {
        const {
          id: _id, created_at: _ca, updated_at: _ua,
          pipeline_key: _pk, pipeline_status: _ps, pipeline_first_step_passed: _pf,
          ...payload
        } = r;
        void _id; void _ca; void _ua; void _pk; void _ps; void _pf;
        await api.interviews.create(payload as Partial<Interview>);
        imported++;
      } catch (e) {
        errors.push(`${r.company_name}: ${e instanceof HttpError ? e.message : String(e)}`);
      }
    }
    return { imported, skipped, errors };
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Interviews</h1>
          <p className="page-subtitle">
            {devOnly
              ? <>Interviews assigned to you, <strong>{me?.name}</strong>.</>
              : "Every interview round across every pipeline. Toggle live pipelines to focus on what's still in play."}
          </p>
        </div>
        <div className="page-actions">
          <input className="input search-input" placeholder="Search company, profile, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {isSuperAdmin(me) && (
            <ImportExportButtons
              resource="interviews"
              data={() => data?.interviews ?? []}
              onImport={importInterviews}
              onAfterImport={load}
            />
          )}
          {admin && <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New interview</button>}
        </div>
      </div>

      <div className="stat-row">
        <button type="button" className={'stat' + (statFilter === 'thisMonth' ? ' active' : '')} onClick={() => setStatFilter('thisMonth')}>
          <div className="stat-label">This month</div>
          <div className="stat-value">{counts.total}</div>
          <div className="stat-sub">{monthLabel(month)}</div>
        </button>
        <button type="button" className={'stat' + (statFilter === 'passed' ? ' active' : '')} onClick={() => setStatFilter('passed')}>
          <div className="stat-label">Passed</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{counts.passed}</div>
          <div className="stat-sub">moved forward</div>
        </button>
        <button type="button" className={'stat' + (statFilter === 'waiting' ? ' active' : '')} onClick={() => setStatFilter('waiting')}>
          <div className="stat-label">Waiting</div>
          <div className="stat-value" style={{ color: 'var(--warning)' }}>{counts.waiting}</div>
          <div className="stat-sub">awaiting feedback</div>
        </button>
        <button type="button" className={'stat' + (statFilter === 'failed' ? ' active' : '')} onClick={() => setStatFilter('failed')}>
          <div className="stat-label">Failed</div>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>{counts.failed}</div>
          <div className="stat-sub">this month</div>
        </button>
        <button type="button" className={'stat accent' + (statFilter === 'live' ? ' active' : '')} onClick={() => setStatFilter('live')}>
          <div className="stat-label">Live pipelines</div>
          <div className="stat-value">{counts.live}</div>
          <div className="stat-sub">still in play</div>
        </button>
        {/* Follow-up management is admin/superadmin only — devs don't see it. */}
        {!devOnly && (
          <button
            type="button"
            className={'stat followup' + (isFollowUp ? ' active' : '')}
            onClick={() => setStatFilter(isFollowUp ? 'thisMonth' : 'followup')}
            title="All interviews still Waiting past their follow-up window (across every month)"
          >
            <div className="stat-label">Needs follow-up</div>
            <div className="stat-value">{counts.followUp}</div>
            <div className="stat-sub">{isFollowUp ? 'showing all' : 'across all months'}</div>
          </button>
        )}
        {/* Offers — pipelines where the candidate landed an offer. Everyone sees it. */}
        <button
          type="button"
          className={'stat offered' + (isOffered ? ' active' : '')}
          onClick={() => setStatFilter(isOffered ? 'thisMonth' : 'offered')}
          title="Pipelines where an offer was landed (marked, or with a Job step)"
        >
          <div className="stat-label">Offers</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{counts.offered}</div>
          <div className="stat-sub">landed 🎉</div>
        </button>
      </div>

      <div className="filter-bar">
        <div className="filter-group">
          <label>Month</label>
          <select className="select" value={month} onChange={(e) => setMonth(e.target.value)} disabled={isLive || isFollowUp || isOffered || upcomingOnly || !!search.trim()}>
            {allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            {!allMonths.includes(month) && <option value={month}>{monthLabel(month)}</option>}
          </select>
        </div>
        <div className="filter-group">
          <label>Step</label>
          <select className="select" value={stepFilter} onChange={(e) => setStepFilter(e.target.value)}>
            <option value="All">All</option>
            {STEPS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {!devOnly && (
          <div className="filter-group">
            <label>Handler</label>
            <select className="select" value={handlerFilter} onChange={(e) => setHandlerFilter(e.target.value)}>
              <option value="All">All</option>
              {users.filter((u) => u.active && u.roles.includes('dev')).map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          </div>
        )}
        <div className="filter-group">
          <label>Profile</label>
          <select className="select" value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
            <option value="All">All</option>
            {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        {/* Upcoming filter is available to everyone (incl. devs). Follow-up
            filtering lives on the admin-only "Needs follow-up" stat card. */}
        <label className="toggle">
          <input type="checkbox" checked={upcomingOnly} onChange={(e) => setUpcomingOnly(e.target.checked)} />
          <span className="toggle-switch"></span>
          <span>Upcoming only</span>
        </label>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {isOffered
            ? <>Showing {offeredPipelines.length} pipeline{offeredPipelines.length === 1 ? '' : 's'} with a landed offer (all months)</>
            : isLive
            ? <>Showing latest step for {visibleRows.length} live pipeline{visibleRows.length === 1 ? '' : 's'}</>
            : isFollowUp
              ? <>Showing {visibleRows.length} interview{visibleRows.length === 1 ? '' : 's'} needing follow-up (all months)</>
              : search.trim()
                ? <>Showing {visibleRows.length} interview{visibleRows.length === 1 ? '' : 's'} matching “{search.trim()}” (all months)</>
                : <>Showing {visibleRows.length} interview{visibleRows.length === 1 ? '' : 's'} in {monthLabel(month)}</>}
        </div>
      </div>

      {isOffered ? (
        <div className="offers-wrap">
          {offeredPipelines.length === 0
            ? <Empty title="No offers yet" hint="Open a pipeline's detail and check “Landed offer” to move it here." />
            : offeredPipelines.map(({ key, rows }) => {
                const head = rows[rows.length - 1];
                return (
                  <div key={key} className="offer-card">
                    <div className="offer-head">
                      <span className="offer-company">{head.company_name}</span>
                      <span className="offer-profile">· {head.profile_name}</span>
                      <span className="badge success">🎉 Offer landed</span>
                    </div>
                    <div className="offer-journey">
                      {rows.map((iv) => (
                        <button key={iv.id} type="button" className="offer-step" onClick={() => setViewing(iv)}
                                title="Open this interview">
                          <span className="offer-date">{formatDate(iv.date)}</span>
                          <StepPill step={iv.step} />
                          <ProgressBadge progress={iv.progress} />
                          {iv.meeting_slot && <span className="offer-slot">{formatSlot(iv.meeting_slot)}</span>}
                          {iv.handler && <span className="offer-handler">· {iv.handler}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
        </div>
      ) : (
      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <colgroup>
              <col style={{ width: 44 }} />   {/* No */}
              <col style={{ width: 100 }} />  {/* Handler */}
              <col style={{ width: 130 }} />  {/* Date — just "May 18, 2026" */}
              <col style={{ width: 150 }} />  {/* Slot */}
              <col style={{ width: 150 }} />  {/* Profile */}
              <col style={{ width: 260 }} />  {/* Company — name + Today/Tomorrow/Upcoming/Follow-up badges inline */}
              <col style={{ width: 150 }} />  {/* Step (room for pill + "N passed" badge) */}
              <col style={{ width: 110 }} />  {/* Links */}
              <col />                          {/* Notes (flex) */}
              <col style={{ width: 80 }} />   {/* Actions */}
            </colgroup>
            <thead>
              <tr>
                <th className="no-col">No</th>
                <SortableTh field="handler" sort={sort} onSort={onSort}>Handler</SortableTh>
                <SortableTh field="date" sort={sort} onSort={onSort}>Date</SortableTh>
                <SortableTh field="meeting_slot" sort={sort} onSort={onSort}>Slot (EST)</SortableTh>
                <SortableTh field="profile_name" sort={sort} onSort={onSort}>Profile</SortableTh>
                <SortableTh field="company_name" sort={sort} onSort={onSort}>Company</SortableTh>
                <SortableTh field="stepOrder" sort={sort} onSort={onSort}>Step</SortableTh>
                <th>Links</th>
                <SortableTh field="notes" sort={sort} onSort={onSort}>Notes</SortableTh>
                <th style={{ textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10}><Empty title="Loading…" /></td></tr>}
              {!loading && visibleRows.length === 0 && (
                <tr><td colSpan={10}>
                  <Empty
                    title={isLive ? 'No live pipelines' : isFollowUp ? 'Nothing needs follow-up' : 'No interviews this month'}
                    hint={isLive ? 'All pipelines have either failed or none exist yet.'
                      : isFollowUp ? 'Every Waiting interview is within its follow-up window.'
                      : 'Try a different month or add a new interview.'}
                  />
                </td></tr>
              )}
              {!loading && visibleRows.map((it, idx) => {
                // Today/Tomorrow/Upcoming row tints and badges only render on
                // the default "This month" view. The other stat-card filters
                // show every row in neutral styling so nothing is rearranged
                // visually either. Follow-up tint shows regardless of view —
                // it's a status flag, not a calendar bucket.
                const highlight = statFilter === 'thisMonth';
                const isToday = highlight && it.date === todayKey;
                const isTomorrow = highlight && it.date === tomorrowKey;
                // "Upcoming" badge shows for everyone; the follow-up badge is admin-only.
                const isFuture = highlight && !!it.date && !isToday && !isTomorrow && it.date > tomorrowKey;
                const followOverdue = devOnly ? null : followUpDaysOverdue(it);
                const isFollowUp = followOverdue != null;
                // Row tint reflects the interview's PROGRESS (Failed = red,
                // Waiting = yellow, Passed = green). Today/Tomorrow/Upcoming are
                // shown only as badges in the date cell — they no longer tint the row.
                const prog = normalizeProgress(it.progress);
                const rowCls = prog === 'Failed' ? 'row-failed'
                  : prog === 'Waiting' ? 'row-waiting'
                  : prog === 'Passed' ? 'row-passed'
                  : '';
                return (
                  <tr key={it.id} className={rowCls} style={{ cursor: 'pointer' }} onClick={() => setViewing(it)}>
                    <td className="no-col">{idx + 1}</td>
                    <td><HandlerChip handlerName={it.handler} users={users} /></td>
                    <td className="num" style={{ fontWeight: 600 }}>{formatDate(it.date)}</td>
                    <td className="num nowrap">{it.meeting_slot ? formatSlot(it.meeting_slot) : <span className="cell-empty">·</span>}</td>
                    <td>{it.profile_name
                      ? <ProfileColorBadge name={it.profile_name} color={profileColor(it.profile_name)} canEdit={admin} onPick={(c) => setProfileColor(it.profile_name!, c)} />
                      : <span className="cell-empty">·</span>}</td>
                    <td style={{ fontWeight: 600 }} title={it.company_name ?? undefined}>
                      <span className="date-cell" style={{ display: 'flex', width: '100%' }}>
                        <span>{it.company_name || <span className="dash">—</span>}</span>
                        <span className="date-cell" style={{ marginLeft: 'auto' }}>
                          {isToday && <span className="date-tag today">Today</span>}
                          {isTomorrow && <span className="date-tag tomorrow">Tomorrow</span>}
                          {isFuture && <span className="date-tag future">Upcoming</span>}
                          {isFollowUp && (() => {
                            const waited = followUpWaitDays(it.step) + (followOverdue ?? 0);
                            return (
                              <button
                                type="button"
                                className="badge follow-up"
                                title={`Waiting ${waited} day${waited === 1 ? '' : 's'} — click when you've nudged them.`}
                                onClick={(e) => { e.stopPropagation(); setConfirmingFollowUp(it); }}
                              >
                                ⚑ Follow up · {waited}d
                              </button>
                            );
                          })()}
                        </span>
                      </span>
                    </td>
                    <td>
                      <StepPill step={it.step} />
                    </td>
                    <td>
                      <span className="link-icons">
                        {it.meeting_type === 'phone' ? (
                          <span className="link-icon" title="Phone call (no URL)" style={{ cursor: 'default' }}>📞</span>
                        ) : (
                          <LinkIcon href={it.meeting_url} label="🎥" title="Meeting" />
                        )}
                        <LinkIcon href={it.jd_url} label="JD" title="JD" />
                        <LinkIcon href={it.recording_url} label="REC" title="Recording" />
                      </span>
                    </td>
                    <td>{it.notes && it.notes.trim()
                      ? <TruncatedText value={it.notes} limit={80} title={`${it.company_name ?? ''} · ${it.step ?? ''}`} />
                      : <span className="cell-empty">·</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="row-actions">
                        <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setEditing(it); }} title={admin ? 'Edit interview' : 'Edit notes'} aria-label="Edit">✎</button>
                        {admin && <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); onDelete(it.id); }} title="Delete interview" aria-label="Delete">🗑</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {editing && (
        <InterviewEditor
          existing={editing === 'new' ? null : editing}
          profiles={profiles}
          users={users}
          currentUser={me!}
          devOnly={devOnly}
          allInterviews={data?.interviews ?? []}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {viewing && (
        <InterviewViewModal
          interview={viewing}
          users={users}
          allInterviews={data?.interviews ?? []}
          onClose={() => setViewing(null)}
          onEdit={() => { const v = viewing; setViewing(null); setEditing(v); }}
          onChanged={load}
        />
      )}

      {confirmingFollowUp && (() => {
        const c = confirmingFollowUp;
        const wait = followUpWaitDays(c.step);
        return (
          <Modal
            title="Mark as followed up?"
            onClose={() => setConfirmingFollowUp(null)}
            footer={<>
              <button className="btn" onClick={() => setConfirmingFollowUp(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmFollowUp}>Yes, I followed up</button>
            </>}
          >
            <div style={{ fontSize: 14, lineHeight: 1.55 }}>
              Confirm you nudged the contact for{' '}
              <strong>{c.company_name ?? '—'}</strong>
              {c.step ? <> ({c.step})</> : null}
              .
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-muted)' }}>
                The Follow up badge will hide for {wait} day{wait === 1 ? '' : 's'}.
                If progress is still <em>Waiting</em> after that, the badge will reappear automatically.
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

