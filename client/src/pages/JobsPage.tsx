import { useEffect, useMemo, useState } from 'react';
import { api, HttpError } from '../api';
import type { Job, JobsResponse, PayCycle } from '../types';
import SortableTh from '../components/SortableTh';
import Modal from '../components/Modal';
import { useDialogs } from '../components/Dialog';
import Empty from '../components/Empty';
import ImportExportButtons, { type ImportResult } from '../components/ImportExportButtons';
import { isSuperAdmin, useAuth } from '../auth';
import { JobStatusBadge } from '../components/StatusBadges';
import { sortRows, useSort } from '../util/sort';
import { getCached, setCached } from '../util/dataCache';
import { formatDate, formatMoney } from '../util/format';

const SOURCES = ['LinkedIn', 'Job Apply', 'Agency', 'Referral', 'Indeed', 'Other'];

type SortField =
  | 'company_name' | 'role_title' | 'source' | 'started_on' | 'status'
  | 'salary_monthly' | 'caller_payout' | 'dev_payout' | 'net';

export default function JobsPage() {
  const { user: me } = useAuth();
  const { confirm, alert } = useDialogs();
  const [data, setData] = useState<JobsResponse | null>(() => getCached<JobsResponse>('jobs') ?? null);
  const [loading, setLoading] = useState(() => !getCached('jobs'));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'active' | 'paused' | 'ended'>('All');
  const [editing, setEditing] = useState<Job | 'new' | null>(null);
  const [unlocked, setUnlocked] = useState<boolean | null>(null); // null = checking
  const [changingPagePw, setChangingPagePw] = useState(false);
  const [editingBaseFee, setEditingBaseFee] = useState(false);
  const [baseFeeInput, setBaseFeeInput] = useState('');
  const [savingBaseFee, setSavingBaseFee] = useState(false);
  const { sort, onSort } = useSort<SortField>({ field: 'started_on', dir: 'desc' });

  const openBaseFeeEditor = () => { setBaseFeeInput(String(data?.summary?.base_fee ?? 0)); setEditingBaseFee(true); };
  const saveBaseFee = async () => {
    setSavingBaseFee(true);
    try { await api.jobs.setBaseFee(Number(baseFeeInput) || 0); setEditingBaseFee(false); await load(); }
    catch (e) { await alert({ title: 'Could not save base fee', message: e instanceof HttpError ? e.message : String(e) }); }
    finally { setSavingBaseFee(false); }
  };

  const load = async () => {
    if (!getCached('jobs')) setLoading(true);
    try { const j = await api.jobs.list(); setData(j); setCached('jobs', j); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // On mount: check if the page lock has already been satisfied this session.
  useEffect(() => {
    (async () => {
      try {
        const s = await api.jobs.unlockStatus();
        setUnlocked(s.unlocked);
        if (s.unlocked) await load();
      } catch {
        setUnlocked(false);
      }
    })();
  }, []);

  const onUnlock = async () => {
    setUnlocked(true);
    await load();
  };

  const onLock = async () => {
    try { await api.jobs.lock(); } catch { /* ignore */ }
    setUnlocked(false);
    setData(null);
    setCached('jobs', null); // don't keep job data cached once the page is locked
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const filtered = data.jobs.filter((j) => {
      const matchesSearch = !search || [j.company_name, j.role_title, j.source]
        .some((v) => String(v || '').toLowerCase().includes(search.toLowerCase()));
      const matchesStatus = statusFilter === 'All' || (j.status ?? '').toLowerCase() === statusFilter;
      return matchesSearch && matchesStatus;
    });
    return sortRows(filtered, sort, (j, f) => {
      if (f === 'net') return (j.salary_monthly || 0) - (j.caller_payout || 0) - (j.dev_payout || 0);
      return (j as unknown as Record<string, unknown>)[f];
    });
  }, [data, sort, search, statusFilter]);

  const summary = data?.summary;

  const onDelete = async (id: number) => {
    if (!(await confirm({ title: 'Delete job?', message: 'This permanently removes the job.', confirmLabel: 'Delete' }))) return;
    try { await api.jobs.remove(id); await load(); }
    catch (e) { await alert({ title: 'Could not delete', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  const handleSaved = () => { setEditing(null); load(); };

  const importJobs = async (incoming: unknown[]): Promise<ImportResult> => {
    let imported = 0, skipped = 0;
    const errors: string[] = [];
    for (const row of incoming) {
      if (!row || typeof row !== 'object') { skipped++; continue; }
      const r = row as Record<string, unknown>;
      if (!r.company_name) { skipped++; continue; }
      try {
        const { id: _id, created_at: _ca, updated_at: _ua, ...payload } = r;
        void _id; void _ca; void _ua;
        await api.jobs.create(payload as Partial<Job>);
        imported++;
      } catch (e) {
        errors.push(`${String(r.company_name)}: ${e instanceof HttpError ? e.message : String(e)}`);
      }
    }
    return { imported, skipped, errors };
  };

  if (unlocked === null) {
    return <div className="empty"><div className="empty-title">Loading…</div></div>;
  }

  if (!unlocked) {
    return <JobsLockGate onUnlocked={onUnlock} />;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Running Jobs</h1>
          <p className="page-subtitle">Active job pipelines, their economics, and monthly run-rate.</p>
        </div>
        <div className="page-actions">
          <input className="input search-input" placeholder="Search jobs…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {isSuperAdmin(me) && (
            <ImportExportButtons
              resource="jobs"
              data={() => data?.jobs ?? []}
              onImport={importJobs}
              onAfterImport={load}
            />
          )}
          {isSuperAdmin(me) && (
            <button className="btn" onClick={() => setChangingPagePw(true)} title="Change the page password">🔑 Page password</button>
          )}
          <button className="btn" onClick={onLock} title="Lock the Running Jobs page">🔒 Lock</button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New job</button>
        </div>
      </div>

      {summary && (
        <div className="stat-row">
          <div className="stat">
            <div className="stat-label">Active jobs</div>
            <div className="stat-value">{summary.active_count}</div>
            <div className="stat-sub">of {data?.jobs.length ?? 0} total</div>
          </div>
          <div className="stat">
            <div className="stat-label">Monthly gross</div>
            <div className="stat-value mono">{formatMoney(summary.monthly_income)}</div>
            <div className="stat-sub">sum of salaries</div>
          </div>
          <div className="stat">
            <div className="stat-label">Caller payouts</div>
            <div className="stat-value mono" style={{ color: 'var(--warning)' }}>−{formatMoney(summary.monthly_caller_payout)}</div>
            <div className="stat-sub">monthly</div>
          </div>
          <div className="stat">
            <div className="stat-label">Dev payouts</div>
            <div className="stat-value mono" style={{ color: 'var(--warning)' }}>−{formatMoney(summary.monthly_dev_payout)}</div>
            <div className="stat-sub">monthly</div>
          </div>
          <button type="button" className="stat" style={{ cursor: 'pointer', textAlign: 'left' }}
                  onClick={openBaseFeeEditor} title="Fixed monthly fee (not a job) — click to adjust">
            <div className="stat-label">Base fee ✎</div>
            <div className="stat-value mono" style={{ color: 'var(--warning)' }}>−{formatMoney(summary.base_fee)}</div>
            <div className="stat-sub">monthly · click to edit</div>
          </button>
          <div className="stat dark">
            <div className="stat-label">Net monthly income</div>
            <div className="stat-value mono">{formatMoney(summary.monthly_net)}</div>
            <div className="stat-sub">gross − payouts − base fee</div>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <div className="filter-group">
          <label>Status</label>
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="All">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="ended">Closed</option>
          </select>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          Showing {rows.length} of {data?.jobs.length ?? 0} jobs
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <colgroup>
              <col style={{ width: 180 }} />
              <col />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <SortableTh field="company_name" sort={sort} onSort={onSort}>Company</SortableTh>
                <SortableTh field="role_title" sort={sort} onSort={onSort}>Job Title</SortableTh>
                <SortableTh field="source" sort={sort} onSort={onSort}>Source</SortableTh>
                <SortableTh field="salary_monthly" sort={sort} onSort={onSort} align="right">Salary / mo</SortableTh>
                <SortableTh field="caller_payout" sort={sort} onSort={onSort} align="right">Caller</SortableTh>
                <SortableTh field="dev_payout" sort={sort} onSort={onSort} align="right">Dev</SortableTh>
                <SortableTh field="net" sort={sort} onSort={onSort} align="right">Net / mo</SortableTh>
                <SortableTh field="started_on" sort={sort} onSort={onSort}>Started</SortableTh>
                <SortableTh field="status" sort={sort} onSort={onSort}>Status</SortableTh>
                <th style={{ textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10}><Empty title="Loading…" /></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={10}><Empty title="No jobs match" hint="Try a different status or clear the search." /></td></tr>}
              {!loading && rows.map((j) => {
                const net = (j.salary_monthly || 0) - (j.caller_payout || 0) - (j.dev_payout || 0);
                return (
                  <tr key={j.id}>
                    <td style={{ fontWeight: 600 }} title={j.company_name ?? undefined}>{j.company_name}</td>
                    <td title={j.role_title ?? undefined}>{j.role_title || <span className="dash">—</span>}</td>
                    <td>{j.source ? <span className="badge">{j.source}</span> : <span className="dash">—</span>}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{formatMoney(j.salary_monthly || 0)}</td>
                    <td className="num" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatMoney(j.caller_payout || 0)}</td>
                    <td className="num" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatMoney(j.dev_payout || 0)}</td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(net)}</td>
                    <td className="num">{formatDate(j.started_on)}</td>
                    <td><JobStatusBadge status={j.status} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="row-actions">
                        <button className="icon-btn" onClick={() => setEditing(j)} title="Edit job" aria-label="Edit">✎</button>
                        <button className="icon-btn danger" onClick={() => onDelete(j.id)} title="Delete job" aria-label="Delete">🗑</button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <JobEditor
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {changingPagePw && (
        <ChangePagePasswordModal onClose={() => setChangingPagePw(false)} />
      )}

      {editingBaseFee && (
        <Modal
          title="Monthly base fee"
          onClose={() => setEditingBaseFee(false)}
          footer={<>
            <button className="btn" onClick={() => setEditingBaseFee(false)} disabled={savingBaseFee}>Cancel</button>
            <button className="btn btn-primary" onClick={saveBaseFee} disabled={savingBaseFee}>{savingBaseFee ? 'Saving…' : 'Save'}</button>
          </>}
        >
          <div className="form-field full">
            <label>Base fee ($ / month) <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-soft)' }}>— a fixed monthly deduction, not tied to any job; subtracted from net monthly income</span></label>
            <input type="number" step="0.01" min="0" autoFocus value={baseFeeInput}
                   onChange={(e) => setBaseFeeInput(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter' && !savingBaseFee) void saveBaseFee(); }} />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============= Page-lock components ===========================================

function JobsLockGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) { setError('Password required'); return; }
    setError(null);
    setBusy(true);
    try {
      await api.jobs.unlock(pw);
      onUnlocked();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-card">
      <div className="lock-icon">🔒</div>
      <h2 className="lock-title">Running Jobs is password-protected</h2>
      <p className="lock-sub">Enter the page password to view monthly income and payouts.</p>
      <form className="lock-form" onSubmit={submit}>
        <div className="form-field">
          <label>Page password</label>
          <input
            type="password"
            autoFocus
            autoComplete="off"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}

function ChangePagePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (!current || !next) { setError('Both fields are required'); return; }
    if (next !== confirm) { setError('New passwords do not match'); return; }
    setError(null);
    setBusy(true);
    try {
      await api.jobs.changePagePassword(current, next);
      setDone(true);
      setTimeout(onClose, 900);
    } catch (e) {
      setError(e instanceof HttpError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Change Running Jobs page password"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || done}>
          {done ? 'Saved ✓' : busy ? 'Saving…' : 'Change password'}
        </button>
      </>}
    >
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="form-field">
          <label>Current page password</label>
          <input type="password" autoComplete="off" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="form-field">
          <label>New page password</label>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="form-field">
          <label>Confirm new page password</label>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  );
}

type Draft = {
  company_name: string;
  role_title: string;
  source: string;
  salary_monthly: number;
  caller_payout: number;
  dev_payout: number;
  started_on: string;
  status: 'active' | 'paused' | 'ended';
  notes: string;
  // Caller Pay: who gets paid, and this job's payout cycle.
  caller: string;
  pay_first_date: string;
  pay_cycle: '' | PayCycle;
};

function JobEditor({ existing, onClose, onSaved }: { existing: Job | null; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  // Auto-suggest the caller from the matching pipeline when none is assigned yet.
  const suggestedCaller = existing?.suggested_caller ?? null;
  const [draft, setDraft] = useState<Draft>(() => ({
    company_name: existing?.company_name ?? '',
    role_title: existing?.role_title ?? '',
    source: existing?.source ?? 'LinkedIn',
    salary_monthly: existing?.salary_monthly ?? 0,
    caller_payout: existing?.caller_payout ?? 0,
    dev_payout: existing?.dev_payout ?? 0,
    started_on: existing?.started_on ?? today,
    status: (existing?.status as Draft['status']) ?? 'active',
    notes: existing?.notes ?? '',
    caller: existing?.caller ?? suggestedCaller ?? '',
    pay_first_date: existing?.pay_first_date ?? '',
    pay_cycle: (existing?.pay_cycle as Draft['pay_cycle']) ?? '',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [callerOptions, setCallerOptions] = useState<string[]>([]);

  // Names to suggest in the Caller field (all users — there's no caller role).
  useEffect(() => {
    let alive = true;
    api.users.list()
      .then((users) => { if (alive) setCallerOptions(users.map((u) => u.name)); })
      .catch(() => { /* non-fatal; the Caller field stays free-text */ });
    return () => { alive = false; };
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    if (!draft.company_name.trim()) { setError('Company is required'); return; }
    setError(null);
    setBusy(true);
    // Normalize the optional Dev Pay fields: empty strings persist as null.
    const payload: Partial<Job> = {
      ...draft,
      caller: draft.caller.trim() || null,
      pay_cycle: draft.pay_cycle || null,
      pay_first_date: draft.pay_first_date || null,
    };
    try {
      if (existing) await api.jobs.update(existing.id, payload);
      else await api.jobs.create(payload);
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Edit job' : 'New job'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save job'}</button>
      </>}
    >
      <div className="form-grid">
        <div className="form-field">
          <label>Company *</label>
          <input value={draft.company_name} onChange={(e) => set('company_name', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Job Title</label>
          <input value={draft.role_title} onChange={(e) => set('role_title', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Source</label>
          <select value={draft.source} onChange={(e) => set('source', e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Status</label>
          <select value={draft.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="ended">Closed</option>
          </select>
        </div>
        <div className="form-field">
          <label>Salary / month ($)</label>
          <input type="number" value={draft.salary_monthly} onChange={(e) => set('salary_monthly', Number(e.target.value) || 0)} />
        </div>
        <div className="form-field">
          <label>Start date</label>
          <input type="date" value={draft.started_on} onChange={(e) => set('started_on', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Caller payout ($)</label>
          <input type="number" value={draft.caller_payout} onChange={(e) => set('caller_payout', Number(e.target.value) || 0)} />
        </div>
        <div className="form-field">
          <label>Dev payout ($ / month)</label>
          <input type="number" value={draft.dev_payout} onChange={(e) => set('dev_payout', Number(e.target.value) || 0)} />
        </div>

        <div className="form-field full">
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0 2px', paddingTop: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-soft)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Pay schedule
          </div>
        </div>
        <div className="form-field">
          <label>Caller {suggestedCaller && draft.caller !== suggestedCaller && (
            <button
              type="button"
              onClick={() => set('caller', suggestedCaller)}
              style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, textTransform: 'none', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              suggest {suggestedCaller}
            </button>
          )}</label>
          <input list="caller-options" value={draft.caller} onChange={(e) => set('caller', e.target.value)} placeholder="Unassigned" />
          <datalist id="caller-options">
            {callerOptions.map((d) => <option key={d} value={d} />)}
          </datalist>
        </div>
        <div className="form-field">
          <label>Pay cycle <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-soft)' }}>— splits the caller payout</span></label>
          <select value={draft.pay_cycle} onChange={(e) => set('pay_cycle', e.target.value as Draft['pay_cycle'])}>
            <option value="">— none —</option>
            <option value="weekly">Weekly (¼ of monthly)</option>
            <option value="bi-weekly">Bi-weekly (½ of monthly)</option>
            <option value="semi-monthly">Semi-monthly (½ of monthly)</option>
            <option value="monthly">Monthly (full)</option>
          </select>
        </div>
        <div className="form-field">
          <label>First paid date <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-soft)' }}>— schedule anchor</span></label>
          <input type="date" value={draft.pay_first_date} onChange={(e) => set('pay_first_date', e.target.value)} />
        </div>

        <div className="form-field full">
          <label>Notes</label>
          <textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {error && <div className="form-field full"><div className="form-error">{error}</div></div>}
      </div>
    </Modal>
  );
}
