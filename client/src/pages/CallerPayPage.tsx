import { useCallback, useContext, useEffect, useMemo, useState, createContext, type CSSProperties } from 'react';
import { api, HttpError } from '../api';
import { useAuth, isAdmin } from '../auth';
import { formatDate, formatMoney } from '../util/format';
import type { CallerPayResponse } from '../types';
import Empty from '../components/Empty';

const SECTION_TITLE: CSSProperties = { fontSize: 15, fontWeight: 700, margin: '0 0 10px', color: 'var(--text)' };

// When true money values are shown; otherwise masked (shoulder-surfing privacy).
// Any single value still reveals on hover/focus regardless. Mirrors Payments.
const RevealContext = createContext(false);

function MaskedMoney({ text, style }: { text: string; style?: CSSProperties }) {
  const revealAll = useContext(RevealContext);
  const [hover, setHover] = useState(false);
  const shown = revealAll || hover;
  return (
    <span
      className={'masked-wrap' + (shown ? '' : ' masked')}
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      title={shown ? undefined : 'Hover to reveal'}
    >
      <span className="num" style={style}>{text}</span>
      {!shown && <span className="masked-dots" aria-hidden="true" style={{ color: style?.color }} />}
    </span>
  );
}

const PERIODS: { v: number; label: string }[] = [
  { v: 1, label: 'This month' },
  { v: 2, label: '2 months' },
  { v: 3, label: '3 months' },
  { v: 6, label: '6 months' },
  { v: 12, label: '1 year' },
];

const CYCLE_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  'bi-weekly': 'Bi-weekly',
  'semi-monthly': 'Semi-monthly',
  monthly: 'Monthly',
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CallerPayPage() {
  const { user } = useAuth();
  const admin = isAdmin(user);

  const [callers, setCallers] = useState<string[]>([]);
  const [selectedCaller, setSelectedCaller] = useState<string>(admin ? '' : (user?.name ?? ''));
  const [months, setMonths] = useState(1);
  const [data, setData] = useState<CallerPayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingKey, setMarkingKey] = useState<string | null>(null);
  // Money values masked by default (privacy); this toggle reveals all at once.
  const [revealAll, setRevealAll] = useState(false);

  // Admins pick from the list of callers with payable jobs; the first is selected.
  useEffect(() => {
    if (!admin) return;
    api.callerPay.callers()
      .then((r) => {
        setCallers(r.callers);
        setSelectedCaller((cur) => cur || r.callers[0] || '');
      })
      .catch((e) => setError(e instanceof HttpError ? e.message : String(e)));
  }, [admin]);

  const load = useCallback(() => {
    const caller = admin ? selectedCaller : (user?.name ?? '');
    if (!caller) { setData(null); setLoading(false); return; }
    setLoading(true);
    api.callerPay.get(caller, months)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e instanceof HttpError ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [admin, selectedCaller, months, user?.name]);

  useEffect(() => { load(); }, [load]);

  const mark = async (jobId: number, payDate: string, paid: boolean) => {
    const key = `${jobId}|${payDate}`;
    setMarkingKey(key);
    try {
      await api.callerPay.mark(jobId, payDate, paid);
      load();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : String(e));
    } finally {
      setMarkingKey(null);
    }
  };

  const schedule = data?.schedule ?? [];
  const today = todayIso();

  const totals = useMemo(() => {
    let upcoming = 0;
    let paid = 0;
    for (const s of schedule) {
      if (s.paid) paid += s.amount;
      else upcoming += s.amount;
    }
    // All-time total ever paid out to this caller (from the full paid history).
    const totalPaid = (data?.history ?? []).reduce((sum, h) => sum + (h.amount || 0), 0);
    return { upcoming, paid, totalPaid };
  }, [schedule, data]);

  // Paid history scoped to the selected period, looking back N months (so "This
  // month" shows this month's paid rows, "3 months" the last three, etc.).
  const paidHistory = useMemo(() => {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth() + 1 - (months - 1);
    while (m < 1) { m += 12; y--; }
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    return (data?.history ?? []).filter((h) => h.pay_date >= start);
  }, [data, months]);

  return (
    <RevealContext.Provider value={revealAll}>
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{admin ? 'Pay Schedule' : 'Payment'}</h1>
          <p className="page-subtitle">
            {admin ? 'Payout schedules and paid history for each caller.' : 'Your upcoming payouts and paid history.'} Values are hidden — hover any figure to reveal.
          </p>
        </div>
        <div className="page-actions">
          <div className="filter-group">
            <label>Period</label>
            <select className="select" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>
          <label className="toggle pay-reveal-toggle" style={{ marginLeft: 4 }} title="Hover any value to reveal it — or flip this to show all">
            <input type="checkbox" checked={revealAll} onChange={(e) => setRevealAll(e.target.checked)} />
            <span className="toggle-switch"></span>
            <span>{revealAll ? '👁 Values shown' : '🙈 Values hidden'}</span>
          </label>
        </div>
      </div>

      {admin && (
        <div className="filter-bar">
          <div className="filter-group" style={{ flexWrap: 'wrap' }}>
            <label>Caller</label>
            {callers.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No callers with payable jobs yet.</span>}
            {callers.map((c) => (
              <button
                key={c}
                type="button"
                className={'btn' + (c === selectedCaller ? ' btn-primary' : '')}
                onClick={() => setSelectedCaller(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

      {(admin ? selectedCaller : true) && (
        <div className="stat-row">
          <div className="stat">
            <div className="stat-label">Upcoming (unpaid)</div>
            <div className="stat-value mono"><MaskedMoney text={formatMoney(totals.upcoming)} /></div>
            <div className="stat-sub">in selected period</div>
          </div>
          <div className="stat">
            <div className="stat-label">Paid</div>
            <div className="stat-value mono"><MaskedMoney text={formatMoney(totals.paid)} style={{ color: 'var(--danger)' }} /></div>
            <div className="stat-sub">in selected period</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total paid out</div>
            <div className="stat-value mono"><MaskedMoney text={formatMoney(totals.totalPaid)} style={{ color: 'var(--success)' }} /></div>
            <div className="stat-sub">all time</div>
          </div>
        </div>
      )}

      <h2 style={{ ...SECTION_TITLE, marginTop: 20 }}>Payment schedule</h2>
      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <colgroup>
              <col style={{ width: 130 }} />
              <col style={{ width: 200 }} />
              <col />
              <col style={{ width: 130 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              {admin && <col style={{ width: 120 }} />}
            </colgroup>
            <thead>
              <tr>
                <th>Pay date</th>
                <th>Company</th>
                <th>Role</th>
                <th>Cycle</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
                {admin && <th style={{ textAlign: 'right' }}></th>}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={admin ? 7 : 6}><Empty title="Loading…" /></td></tr>}
              {!loading && schedule.length === 0 && (
                <tr><td colSpan={admin ? 7 : 6}><Empty title="No payouts scheduled" hint="Jobs need a caller, a caller payout amount, a first paid date and a cycle (set on Running Jobs)." /></td></tr>
              )}
              {!loading && schedule.map((s) => {
                const key = `${s.job_id}|${s.pay_date}`;
                const isPast = s.pay_date < today;
                return (
                  <tr key={key} style={s.paid ? { opacity: 0.72 } : undefined}>
                    <td className="num" style={{ color: !s.paid && isPast ? 'var(--warning)' : undefined }}>
                      {formatDate(s.pay_date)}
                    </td>
                    <td>{s.company_name}</td>
                    <td>{s.role_title || <span className="dash">—</span>}</td>
                    <td>{s.pay_cycle ? (CYCLE_LABEL[s.pay_cycle] ?? s.pay_cycle) : <span className="dash">—</span>}</td>
                    <td className="num" style={{ textAlign: 'right' }}><MaskedMoney text={formatMoney(s.amount)} style={{ fontWeight: 600 }} /></td>
                    <td>
                      {s.paid
                        ? <span className="badge success">Paid</span>
                        : <span className="badge">{isPast ? 'Due' : 'Scheduled'}</span>}
                    </td>
                    {admin && (
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className={'btn btn-sm' + (s.paid ? '' : ' btn-primary')}
                          disabled={markingKey === key}
                          onClick={() => mark(s.job_id, s.pay_date, !s.paid)}
                        >
                          {markingKey === key ? '…' : s.paid ? 'Unmark' : 'Mark paid'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <h2 style={{ ...SECTION_TITLE, marginTop: 24 }}>Paid history</h2>
      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <colgroup>
              <col style={{ width: 130 }} />
              <col style={{ width: 200 }} />
              <col />
              <col style={{ width: 120 }} />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Pay date</th>
                <th>Company</th>
                <th>Role</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Marked paid</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5}><Empty title="Loading…" /></td></tr>}
              {!loading && paidHistory.length === 0 && (
                <tr><td colSpan={5}><Empty title="No paid history in this period" hint="Payouts appear here once marked paid. Try a longer period." /></td></tr>
              )}
              {!loading && paidHistory.map((h) => (
                <tr key={`${h.job_id}|${h.pay_date}`}>
                  <td className="num">{formatDate(h.pay_date)}</td>
                  <td>{h.company_name}</td>
                  <td>{h.role_title || <span className="dash">—</span>}</td>
                  <td className="num" style={{ textAlign: 'right' }}><MaskedMoney text={formatMoney(h.amount)} style={{ fontWeight: 600 }} /></td>
                  <td className="num" style={{ color: 'var(--text-muted)' }}>{h.paid_at?.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </RevealContext.Provider>
  );
}
