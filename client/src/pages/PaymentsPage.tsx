import { useEffect, useMemo, useState, useRef, createContext, useContext, Fragment, type CSSProperties } from 'react';
import { api, HttpError } from '../api';
import type { FinancialAccount, Transaction, TransactionGroup, TransactionKind, JobRef } from '../types';
import { isAdmin, isSuperAdmin, useAuth } from '../auth';
import { useDialogs } from '../components/Dialog';
import Modal from '../components/Modal';
import Empty from '../components/Empty';
import SortableTh from '../components/SortableTh';
import { sortRows, useSort } from '../util/sort';
import { formatMoney, monthKey, monthLabel, currentMonthKey } from '../util/format';
import { estNow, minToTimeInput, shiftMonth } from '../util/calendar';

type View = 'transactions' | 'accounts';
type TxnSortField = 'ts' | 'kind' | 'from_label' | 'to_label' | 'amount';

// Income = money in (stored kind 'deposit'); Expense = money out ('payout').
const KIND_LABEL: Record<TransactionKind, string> = { deposit: 'Income', payout: 'Expense', transfer: 'Transfer' };

const BASE_ACCT_TYPES = ['Relay', 'Unifi', 'Coinbase'];

function accountLabel(a: FinancialAccount): string { return `${a.acct_type} ${a.name}`.trim(); }

// ts is "YYYY-MM-DDTHH:MM" in ET — parse the parts directly (no TZ conversion).
// Format: "Jun 18, 2:00pm" (ET is noted once in the column header, not per row).
function formatTxnTime(ts: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(ts || '');
  if (!m) return ts || '—';
  const [, y, mo, d, hh, mm] = m;
  const monDay = new Date(Number(y), Number(mo) - 1, Number(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let h = Number(hh); const ampm = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${monDay}, ${h}:${mm}${ampm}`;
}

// When true, money values are shown; otherwise they're masked (shoulder-surfing
// privacy). A value still reveals individually on hover/focus regardless.
const RevealContext = createContext(false);

// A money value hidden behind animated "moving dots" (Telegram-spoiler style).
// Reveals on hover, on keyboard focus, or when the global toggle is on.
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
      {/* The real value is always rendered (just hidden when masked) so the
          element never changes size — masking is an absolutely-positioned
          overlay with pointer-events:none, so it can't cause hover flicker. */}
      <span className="num" style={style}>{text}</span>
      {!shown && <span className="masked-dots" aria-hidden="true" style={{ color: style?.color }} />}
    </span>
  );
}

// Signed, colored amount by kind (deposit +, payout −, transfer neutral), masked.
function AmountCell({ kind, amount }: { kind: TransactionKind; amount: number }) {
  const sign = kind === 'deposit' ? '+' : kind === 'payout' ? '−' : '';
  const color = kind === 'deposit' ? 'var(--success)' : kind === 'payout' ? 'var(--warning)' : 'var(--text)';
  return <MaskedMoney text={`${sign}${formatMoney(amount)}`} style={{ fontWeight: 600, color }} />;
}

export default function PaymentsPage() {
  const { user: me } = useAuth();
  const { confirm, alert } = useDialogs();
  const admin = isAdmin(me);
  const superAdmin = isSuperAdmin(me);

  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [view, setView] = useState<View>('transactions');
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [groups, setGroups] = useState<TransactionGroup[]>([]);
  const [groupMode, setGroupMode] = useState(false);           // grouped-by-cycle view toggle
  const [sel, setSel] = useState<Set<number>>(() => new Set()); // selected txn ids (for grouping)
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  // Monthly view: filter transactions / account activity to one month, or show
  // everything ("all time"). Defaults to the current month.
  const [month, setMonth] = useState(currentMonthKey());
  const [allTime, setAllTime] = useState(false);
  // Money values are masked by default (privacy); this reveals all at once.
  const [revealAll, setRevealAll] = useState(false);

  const [editingTxn, setEditingTxn] = useState<Transaction | 'new' | null>(null);
  const [editingAcct, setEditingAcct] = useState<FinancialAccount | 'new' | null>(null);
  const [drillAccount, setDrillAccount] = useState<FinancialAccount | null>(null);
  const [changingPagePw, setChangingPagePw] = useState(false);

  const { sort, onSort } = useSort<TxnSortField>({ field: 'ts', dir: 'desc' });

  const load = async () => {
    setLoading(true);
    try {
      const [acc, tx, jb, gr] = await Promise.all([
        api.payments.accounts(),
        api.payments.transactions(),
        api.payments.jobs().catch(() => [] as JobRef[]),
        api.payments.txnGroups().catch(() => [] as TransactionGroup[]),
      ]);
      setAccounts(acc); setTxns(tx); setJobs(jb); setGroups(gr);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    (async () => {
      try {
        const s = await api.payments.unlockStatus();
        setUnlocked(s.unlocked);
        if (s.unlocked) await load();
      } catch { setUnlocked(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLock = async () => {
    try { await api.payments.lock(); } catch { /* ignore */ }
    setUnlocked(false);
    setAccounts([]); setTxns([]); setJobs([]);
  };

  const reloadAfterSave = () => { setEditingTxn(null); setEditingAcct(null); load(); };

  const onDeleteTxn = async (t: Transaction) => {
    if (!(await confirm({ title: 'Delete transaction?', message: 'This permanently removes the transaction.', confirmLabel: 'Delete' }))) return;
    try { await api.payments.removeTransaction(t.id); await load(); }
    catch (e) { await alert({ title: 'Could not delete', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  const onDeleteAcct = async (a: FinancialAccount) => {
    if (!(await confirm({ title: 'Delete account?', message: `Remove “${accountLabel(a)}”? Its transactions stay in the log but will show the account as deleted.`, confirmLabel: 'Delete' }))) return;
    try { await api.payments.removeAccount(a.id); await load(); }
    catch (e) { await alert({ title: 'Could not delete', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  const inMonth = (ts: string) => allTime || monthKey(ts) === month;

  const txnRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = txns.filter((t) => inMonth(t.ts) && (!q || [t.from_label, t.to_label, t.purpose, KIND_LABEL[t.kind]]
      .some((v) => String(v || '').toLowerCase().includes(q))));
    return sortRows(filtered, sort, (t, f) => (t as unknown as Record<string, unknown>)[f]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, sort, search, month, allTime]);

  // --- Grouping (payment cycles) ---------------------------------------------
  const groupLabel = useMemo(() => new Map(groups.map((g) => [g.id, g.label || 'Payment'])), [groups]);
  const clearSel = () => setSel(new Set());
  const toggleSel = (id: number) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const netOf = (list: Transaction[]) => list.reduce((s, t) => s + (t.kind === 'deposit' ? t.amount : t.kind === 'payout' ? -t.amount : 0), 0);

  const doGroup = async () => {
    const ids = [...sel]; if (!ids.length) return;
    try { await api.payments.groupTxns(ids); clearSel(); await load(); }
    catch (e) { await alert({ title: 'Could not group', message: e instanceof HttpError ? e.message : String(e) }); }
  };
  const doAddToGroup = async (gid: number) => {
    const ids = [...sel]; if (!ids.length) return;
    try { await api.payments.addToGroup(gid, ids); clearSel(); await load(); }
    catch (e) { await alert({ title: 'Could not add to group', message: e instanceof HttpError ? e.message : String(e) }); }
  };
  const doUngroup = async () => {
    const ids = [...sel]; if (!ids.length) return;
    try { await api.payments.ungroupTxns(ids); clearSel(); await load(); }
    catch (e) { await alert({ title: 'Could not ungroup', message: e instanceof HttpError ? e.message : String(e) }); }
  };
  const doDeleteGroup = async (gid: number) => {
    if (!(await confirm({ title: 'Disband this cycle?', message: 'Its transactions return to Ungrouped (nothing is deleted).', confirmLabel: 'Disband' }))) return;
    try { await api.payments.deleteTxnGroup(gid); await load(); }
    catch (e) { await alert({ title: 'Could not disband', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  // Grouped view data: cycles (each with its legs in flow order) + ungrouped.
  const groupedView = useMemo(() => {
    const byGroup = new Map<number, Transaction[]>();
    const ungrouped: Transaction[] = [];
    for (const t of txnRows) {
      if (t.group_id != null) { if (!byGroup.has(t.group_id)) byGroup.set(t.group_id, []); byGroup.get(t.group_id)!.push(t); }
      else ungrouped.push(t);
    }
    const ordered = [...byGroup.entries()].map(([id, list]) => ({
      id, label: groupLabel.get(id) || 'Payment',
      rows: [...list].sort((a, b) => a.ts.localeCompare(b.ts)), // deposit → cwallet → deduction
    }));
    ordered.sort((a, b) => b.rows[b.rows.length - 1].ts.localeCompare(a.rows[a.rows.length - 1].ts));
    return { ordered, ungrouped };
  }, [txnRows, groupLabel]);

  // One transaction row (checkbox + cells) — shared by the flat and grouped views.
  const renderTxnRow = (t: Transaction) => (
    <tr key={t.id} className={sel.has(t.id) ? 'row-selected' : ''} style={{ cursor: 'pointer' }} onClick={() => setEditingTxn(t)}>
      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
        <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggleSel(t.id)} aria-label="Select transaction" />
      </td>
      <td className="num">{formatTxnTime(t.ts)}</td>
      <td><span className={'badge dot ' + (t.kind === 'deposit' ? 'success' : t.kind === 'payout' ? 'warning' : '')}>{KIND_LABEL[t.kind]}</span></td>
      <td>
        {t.from_job_id != null && <span className="badge accent" style={{ marginRight: 6 }} title="Income from a running job">Job</span>}
        {t.from_label || <span className="dash">—</span>}
      </td>
      <td>{t.to_label || <span className="dash">—</span>}</td>
      <td title={t.purpose ?? undefined}>{t.purpose || <span className="dash">—</span>}</td>
      <td style={{ textAlign: 'right' }}><AmountCell kind={t.kind} amount={t.amount} /></td>
      <td style={{ textAlign: 'right' }}>
        <span className="row-actions">
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setEditingTxn(t); }} title="Edit" aria-label="Edit">✎</button>
          <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); onDeleteTxn(t); }} title="Delete" aria-label="Delete">🗑</button>
        </span>
      </td>
    </tr>
  );

  // Per-account money in / out within the active scope (month or all time).
  // Transfers count as out of the source account and in to the destination.
  const acctActivity = useMemo(() => {
    const map = new Map<number, { in: number; out: number }>();
    for (const a of accounts) map.set(a.id, { in: 0, out: 0 });
    for (const t of txns) {
      if (!inMonth(t.ts)) continue;
      if (t.to_account_id != null && map.has(t.to_account_id)) map.get(t.to_account_id)!.in += t.amount;
      if (t.from_account_id != null && map.has(t.from_account_id)) map.get(t.from_account_id)!.out += t.amount;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, txns, month, allTime]);

  // Scope totals (selected month or all time): income, out, net, count. Drives
  // the summary stat cards on both views — independent of the search box.
  // Business rules:
  //  - Total income counts ONLY deposits sourced from a Job (from_job_id set);
  //    text-typed payers don't count.
  //  - Total out EXCLUDES payouts whose payee is a Cwallet (payee starts with
  //    "Cwallet", e.g. "Cwallet" or "Cwallet Kangston") — treated as own-wallet
  //    movement, not a real expense.
  const isCwalletPayee = (t: typeof txns[number]) => /^\s*cwallet\b/i.test(t.to_text ?? '');
  const scope = useMemo(() => {
    let income = 0, out = 0, count = 0;
    for (const t of txns) {
      if (!inMonth(t.ts)) continue;
      count++;
      if (t.kind === 'deposit') { if (t.from_job_id != null) income += t.amount; }
      else if (t.kind === 'payout') { if (!isCwalletPayee(t)) out += t.amount; }
    }
    return { count, income, out, net: income - out };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, month, allTime]);
  const totalBalance = useMemo(() => accounts.reduce((s, a) => s + a.balance, 0), [accounts]);
  const scopeLabel = allTime ? 'all time' : monthLabel(month);

  if (unlocked === null) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (!unlocked) return <PaymentsLockGate onUnlocked={async () => { setUnlocked(true); await load(); }} />;

  return (
    <RevealContext.Provider value={revealAll}>
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Account balances and the transaction ledger. Values are hidden — hover any figure to reveal. Times are ET.</p>
        </div>
        <div className="page-actions">
          {superAdmin && (
            <button className="btn" onClick={() => setChangingPagePw(true)} title="Change the page password">🔑 Page password</button>
          )}
          <button className="btn" onClick={onLock} title="Lock the Payments page">🔒 Lock</button>
          <div className="seg">
            {(['transactions', 'accounts'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                {v === 'transactions' ? 'Transactions' : 'Accounts'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="btn btn-icon" onClick={() => setMonth((m) => shiftMonth(m, -1))} title="Previous month" disabled={allTime}>‹</button>
          <button className="btn btn-icon" onClick={() => setMonth((m) => shiftMonth(m, 1))} title="Next month" disabled={allTime}>›</button>
        </div>
        <span className="cal-month-label">{allTime ? 'All time' : monthLabel(month)}</span>
        {!allTime && <button className="btn" onClick={() => setMonth(currentMonthKey())}>This month</button>}
        <label className="toggle" style={{ marginLeft: 8 }} title="Show everything instead of a single month">
          <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} />
          <span className="toggle-switch"></span>
          <span>All time</span>
        </label>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {view === 'transactions' && (
            <input className="input search-input" style={{ width: 200 }} placeholder="Search transactions…" value={search} onChange={(e) => setSearch(e.target.value)} />
          )}
          {view === 'transactions'
            ? <button className="btn btn-primary" onClick={() => setEditingTxn('new')}>＋ Transaction</button>
            : <button className="btn btn-primary" onClick={() => setEditingAcct('new')}>＋ Account</button>}
          <label className="toggle pay-reveal-toggle" style={{ marginLeft: 4 }} title="Hover any value to reveal it — or flip this to show all">
            <input type="checkbox" checked={revealAll} onChange={(e) => setRevealAll(e.target.checked)} />
            <span className="toggle-switch"></span>
            <span>{revealAll ? '👁 Values shown' : '🙈 Values hidden'}</span>
          </label>
        </div>
      </div>

      {view === 'transactions' && (<>
        <div className="stat-row">
          <div className="stat">
            <div className="stat-label">Transactions · {scopeLabel}</div>
            <div className="stat-value">{scope.count}</div>
            <div className="stat-sub">{allTime ? 'all time' : 'this month'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total income</div>
            <div className="stat-value mono"><MaskedMoney text={formatMoney(scope.income)} style={{ color: 'var(--success)' }} /></div>
            <div className="stat-sub">money in</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total out</div>
            <div className="stat-value mono"><MaskedMoney text={formatMoney(scope.out)} style={{ color: 'var(--warning)' }} /></div>
            <div className="stat-sub">money out</div>
          </div>
          <div className="stat" style={{ background: '#0c0a09', borderColor: '#0c0a09' }}>
            <div className="stat-label" style={{ color: 'rgba(255,255,255,0.6)' }}>Net · {scopeLabel}</div>
            <div className="stat-value mono"><MaskedMoney text={(scope.net < 0 ? '−' : '') + formatMoney(Math.abs(scope.net))} style={{ fontWeight: 700, color: 'white' }} /></div>
            <div className="stat-sub" style={{ color: 'rgba(255,255,255,0.6)' }}>income − out</div>
          </div>
        </div>
        {/* Group-by-cycle toggle + selection actions */}
        <div className="txn-toolbar">
          <label className="toggle">
            <input type="checkbox" checked={groupMode} onChange={(e) => setGroupMode(e.target.checked)} />
            <span className="toggle-switch"></span>
            <span>Group by cycle</span>
          </label>
          {sel.size > 0 && (
            <span className="txn-sel-actions">
              <span className="txn-sel-count">{sel.size} selected</span>
              <button className="btn btn-sm btn-primary" onClick={doGroup}>Group as cycle</button>
              {groups.length > 0 && (
                <select className="select select-sm" value="" onChange={(e) => { const g = Number(e.target.value); if (g) void doAddToGroup(g); }}
                        title="Add the selected transactions to an existing cycle">
                  <option value="">Add to cycle…</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.label || 'Payment'}</option>)}
                </select>
              )}
              <button className="btn btn-sm" onClick={doUngroup}>Ungroup</button>
              <button className="btn btn-sm" onClick={clearSel}>Clear</button>
            </span>
          )}
        </div>
        <div className="table-wrap"><div className="table-scroll">
          <table className="data">
            <colgroup>
              <col style={{ width: 34 }} />{/* Select */}
              <col style={{ width: 150 }} />{/* Date/time */}
              <col style={{ width: 110 }} />{/* Type */}
              <col style={{ width: 290 }} />{/* From */}
              <col style={{ width: 290 }} />{/* To */}
              <col />{/* Purpose */}
              <col style={{ width: 130 }} />{/* Amount */}
              <col style={{ width: 80 }} />{/* Actions */}
            </colgroup>
            <thead>
              <tr>
                <th></th>
                <SortableTh field="ts" sort={sort} onSort={onSort}>Date &amp; time (ET)</SortableTh>
                <SortableTh field="kind" sort={sort} onSort={onSort}>Type</SortableTh>
                <SortableTh field="from_label" sort={sort} onSort={onSort}>From</SortableTh>
                <SortableTh field="to_label" sort={sort} onSort={onSort}>To</SortableTh>
                <th>Purpose</th>
                <SortableTh field="amount" sort={sort} onSort={onSort} align="right">Amount</SortableTh>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8}><Empty title="Loading…" /></td></tr>}
              {!loading && txnRows.length === 0 && <tr><td colSpan={8}><Empty title="No transactions" hint="Record your first transaction to get started." /></td></tr>}
              {!loading && !groupMode && txnRows.map(renderTxnRow)}
              {!loading && groupMode && (<>
                {groupedView.ordered.map((g) => (
                  <Fragment key={'g' + g.id}>
                    <tr className="txn-group-head">
                      <td colSpan={5}>
                        <span className="badge success" style={{ marginRight: 8 }}>🎉 {g.label}</span>
                        <span className="dash">{g.rows.length} transaction{g.rows.length === 1 ? '' : 's'}</span>
                      </td>
                      <td style={{ textAlign: 'right' }} className="dash">net</td>
                      <td style={{ textAlign: 'right' }}><MaskedMoney text={(netOf(g.rows) < 0 ? '−' : '') + formatMoney(Math.abs(netOf(g.rows)))} style={{ fontWeight: 700 }} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="icon-btn" title="Disband cycle (return to Ungrouped)" onClick={() => doDeleteGroup(g.id)}>✕</button>
                      </td>
                    </tr>
                    {g.rows.map(renderTxnRow)}
                  </Fragment>
                ))}
                {groupedView.ungrouped.length > 0 && (<>
                  <tr className="txn-group-head ungrouped"><td colSpan={8}><span className="dash">Ungrouped · {groupedView.ungrouped.length}</span></td></tr>
                  {groupedView.ungrouped.map(renderTxnRow)}
                </>)}
              </>)}
            </tbody>
            {!loading && txnRows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, background: 'var(--surface-2)' }}>
                  <td colSpan={6} style={{ textAlign: 'right' }}>Net total · {scopeLabel}</td>
                  <td style={{ textAlign: 'right' }}><MaskedMoney text={(scope.net < 0 ? '−' : '') + formatMoney(Math.abs(scope.net))} style={{ fontWeight: 700 }} /></td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div></div>
      </>)}

      {view === 'accounts' && (<>
        <div className="stat-row">
          <div className="stat">
            <div className="stat-label">Total balance</div>
            <div className="stat-value mono"><MaskedMoney text={formatMoney(totalBalance)} style={{ fontWeight: 700 }} /></div>
            <div className="stat-sub">{accounts.length} account{accounts.length === 1 ? '' : 's'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Income · {scopeLabel}</div>
            <div className="stat-value mono"><MaskedMoney text={formatMoney(scope.income)} style={{ color: 'var(--success)' }} /></div>
            <div className="stat-sub">received</div>
          </div>
          <div className="stat">
            <div className="stat-label">Spent · {scopeLabel}</div>
            <div className="stat-value mono"><MaskedMoney text={formatMoney(scope.out)} style={{ color: 'var(--warning)' }} /></div>
            <div className="stat-sub">paid out</div>
          </div>
          <div className="stat" style={{ background: '#0c0a09', borderColor: '#0c0a09' }}>
            <div className="stat-label" style={{ color: 'rgba(255,255,255,0.6)' }}>Net · {scopeLabel}</div>
            <div className="stat-value mono"><MaskedMoney text={(scope.net < 0 ? '−' : '') + formatMoney(Math.abs(scope.net))} style={{ fontWeight: 700, color: 'white' }} /></div>
            <div className="stat-sub" style={{ color: 'rgba(255,255,255,0.6)' }}>income − spent</div>
          </div>
        </div>

        {loading && <div className="empty"><div className="empty-title">Loading…</div></div>}
        {!loading && accounts.length === 0 && <Empty title="No accounts" hint="Add a financial account (e.g. Relay Dynamic)." />}
        {!loading && accounts.length > 0 && (
          <div className="acct-grid">
            {accounts.map((a) => {
              const act = acctActivity.get(a.id) ?? { in: 0, out: 0 };
              return (
                <div key={a.id} className="acct-card" onClick={() => setDrillAccount(a)} title="View this account's transactions">
                  {admin && (
                    <span className="acct-card-actions">
                      <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setEditingAcct(a); }} title="Edit / seed balance" aria-label="Edit">✎</button>
                      {superAdmin && <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); onDeleteAcct(a); }} title="Delete" aria-label="Delete">🗑</button>}
                    </span>
                  )}
                  <div className="acct-card-top">
                    <span className="acct-badge" data-type={a.acct_type}>{a.acct_type.slice(0, 2).toUpperCase()}</span>
                    <div>
                      <div className="acct-type">{a.acct_type}</div>
                      <div className="acct-name">{a.name}</div>
                    </div>
                  </div>
                  <div className="acct-balance-label">Current balance</div>
                  <div className="acct-balance"><MaskedMoney text={formatMoney(a.balance)} style={{ fontWeight: 700 }} /></div>
                  <div className="acct-month-out">
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>▲ In</span>
                    <MaskedMoney text={formatMoney(act.in)} style={{ color: 'var(--success)' }} />
                    <span style={{ color: 'var(--warning)', fontWeight: 600, marginLeft: 10 }}>▼ Out</span>
                    <MaskedMoney text={formatMoney(act.out)} style={{ color: 'var(--warning)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>)}

      {editingTxn && (
        <TransactionEditor existing={editingTxn === 'new' ? null : editingTxn} accounts={accounts} jobs={jobs}
                           onClose={() => setEditingTxn(null)} onSaved={reloadAfterSave} />
      )}
      {editingAcct && (
        <AccountEditor existing={editingAcct === 'new' ? null : editingAcct} accounts={accounts} canSeedBalance={admin}
                       onClose={() => setEditingAcct(null)} onSaved={reloadAfterSave} />
      )}
      {drillAccount && (
        <AccountTransactionsModal account={drillAccount} onClose={() => setDrillAccount(null)} />
      )}
      {changingPagePw && <ChangePagePasswordModal onClose={() => setChangingPagePw(false)} />}
    </div>
    </RevealContext.Provider>
  );
}

// ---------- Account drill-down: that account's transactions (oldest → newest) ----------
function AccountTransactionsModal({ account, onClose }: { account: FinancialAccount; onClose: () => void }) {
  const [rows, setRows] = useState<Transaction[] | null>(null);
  useEffect(() => {
    let live = true;
    api.payments.transactions(account.id).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [account.id]);

  return (
    <Modal title={accountLabel(account)} onClose={onClose}>
      {rows === null && <Empty title="Loading…" />}
      {rows !== null && rows.length === 0 && <Empty title="No transactions" hint="Nothing recorded for this account yet." />}
      {rows !== null && rows.length > 0 && (
        <table className="data" style={{ tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th>Date &amp; time (ET)</th><th>Type</th><th>From</th><th>To</th><th>Purpose</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="num">{formatTxnTime(t.ts)}</td>
                <td><span className={'badge dot ' + (t.kind === 'deposit' ? 'success' : t.kind === 'payout' ? 'warning' : '')}>{KIND_LABEL[t.kind]}</span></td>
                <td>
                  {t.from_job_id != null && <span className="badge accent" style={{ marginRight: 6 }} title="Income from a running job">Job</span>}
                  {t.from_label || '—'}
                </td>
                <td>{t.to_label || '—'}</td>
                <td>{t.purpose || '—'}</td>
                <td style={{ textAlign: 'right' }}><AmountCell kind={t.kind} amount={t.amount} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ---------- Transaction editor ----------
// Two modes mirroring the design: Income (money in) and Expense (money out).
//   Income  → kind 'deposit': From = a running job OR a custom payer; To = account.
//   Expense → kind 'payout' : From = account;                         To = person/vendor text.
// The "To" side is never a job. Timestamp is captured automatically (ET) and
// shown as a static label — never a manual picker.
type TxnMode = 'income' | 'expense';
type TxnDraft = {
  mode: TxnMode;
  ts: string;
  fromJobId: number | null;   // income: job source (else custom)
  fromCustom: string;         // income: custom payer
  toAccountId: number | null; // income: destination account
  fromAccountId: number | null; // expense: source account
  toText: string;             // expense: person / vendor
  amount: number; purpose: string;
};

function TransactionEditor({ existing, accounts, jobs, onClose, onSaved }: {
  existing: Transaction | null; accounts: FinancialAccount[]; jobs: JobRef[];
  onClose: () => void; onSaved: () => void;
}) {
  const nowTs = `${estNow().iso}T${minToTimeInput(estNow().minutes)}`;
  const [draft, setDraft] = useState<TxnDraft>(() => {
    if (existing) {
      const income = existing.kind === 'deposit';
      return {
        mode: income ? 'income' : 'expense',
        ts: (existing.ts || nowTs).slice(0, 16),
        fromJobId: existing.from_job_id, fromCustom: existing.from_text ?? '',
        toAccountId: existing.to_account_id ?? accounts[0]?.id ?? null,
        fromAccountId: existing.from_account_id ?? accounts[0]?.id ?? null,
        toText: existing.to_text ?? '', amount: existing.amount, purpose: existing.purpose ?? '',
      };
    }
    return {
      mode: 'expense', ts: nowTs,
      fromJobId: null, fromCustom: '', toAccountId: accounts[0]?.id ?? null,
      fromAccountId: accounts[0]?.id ?? null, toText: '', amount: 0, purpose: '',
    };
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TxnDraft>(k: K, v: TxnDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    if (!draft.amount || draft.amount <= 0) { setError('Amount must be greater than 0'); return; }
    let payload: Partial<Transaction>;
    if (draft.mode === 'income') {
      if (draft.toAccountId == null) { setError('Choose the account the money went into'); return; }
      if (draft.fromJobId == null && !draft.fromCustom.trim()) { setError('Choose a job source or enter a custom payer'); return; }
      payload = {
        kind: 'deposit', ts: draft.ts, amount: draft.amount, purpose: draft.purpose,
        from_job_id: draft.fromJobId, from_text: draft.fromJobId != null ? null : draft.fromCustom.trim(),
        from_account_id: null, to_account_id: draft.toAccountId, to_job_id: null, to_text: null,
      };
    } else {
      if (draft.fromAccountId == null) { setError('Choose the account the money came from'); return; }
      if (!draft.toText.trim()) { setError('Enter who was paid'); return; }
      payload = {
        kind: 'payout', ts: draft.ts, amount: draft.amount, purpose: draft.purpose,
        from_account_id: draft.fromAccountId, from_job_id: null, from_text: null,
        to_text: draft.toText.trim(), to_account_id: null, to_job_id: null,
      };
    }
    setError(null); setBusy(true);
    try {
      if (existing) await api.payments.updateTransaction(existing.id, payload);
      else await api.payments.createTransaction(payload);
      onSaved();
    } catch (e) { setError(e instanceof HttpError ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const income = draft.mode === 'income';

  return (
    <Modal
      title={existing ? 'Edit transaction' : 'New transaction'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save transaction'}</button>
      </>}
    >
      <div className="form-grid">
        <div className="form-field full">
          <label>Type</label>
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            <button type="button" className={!income ? 'active' : ''} onClick={() => set('mode', 'expense')}>Expense (out)</button>
            <button type="button" className={income ? 'active' : ''} onClick={() => set('mode', 'income')}>Income (in)</button>
          </div>
        </div>

        <div className="form-field full">
          <label>Date &amp; time (ET)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', fontWeight: 600 }}>
            <span className="num">{formatTxnTime(draft.ts)}</span>
            <span className="badge">auto</span>
          </div>
        </div>

        {income ? (<>
          <div className="form-field">
            <label>From — job source</label>
            <select value={draft.fromJobId ?? ''} onChange={(e) => set('fromJobId', e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">— Custom source —</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.company_name}{j.profile_name ? ` (${j.profile_name})` : ''}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>From — custom payer</label>
            <input value={draft.fromCustom} onChange={(e) => set('fromCustom', e.target.value)}
                   disabled={draft.fromJobId != null} placeholder={draft.fromJobId != null ? 'Using job source' : 'e.g. McKinsey'} />
          </div>
          <div className="form-field">
            <label>To — account</label>
            <select value={draft.toAccountId ?? ''} onChange={(e) => set('toAccountId', e.target.value === '' ? null : Number(e.target.value))}>
              {accounts.length === 0 && <option value="">— add an account first —</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.acct_type} {a.name}</option>)}
            </select>
          </div>
        </>) : (<>
          <div className="form-field">
            <label>From — account</label>
            <select value={draft.fromAccountId ?? ''} onChange={(e) => set('fromAccountId', e.target.value === '' ? null : Number(e.target.value))}>
              {accounts.length === 0 && <option value="">— add an account first —</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.acct_type} {a.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>To — person / vendor</label>
            <input value={draft.toText} onChange={(e) => set('toText', e.target.value)} placeholder="e.g. Juan, AWS…" />
          </div>
        </>)}

        <div className="form-field">
          <label>Amount ($)</label>
          <input type="number" min={0} step="0.01" value={draft.amount} onChange={(e) => set('amount', Number(e.target.value) || 0)} />
        </div>
        <div className="form-field">
          <label>Purpose</label>
          <input value={draft.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="e.g. Monthly laptop fee" />
        </div>
        {error && <div className="form-field full"><div className="form-error">{error}</div></div>}
      </div>
    </Modal>
  );
}

// ---------- Account editor (create / rename / seed balance) ----------
function AccountEditor({ existing, accounts, canSeedBalance, onClose, onSaved }: {
  existing: FinancialAccount | null; accounts: FinancialAccount[]; canSeedBalance: boolean; onClose: () => void; onSaved: () => void;
}) {
  // Type dropdown = base set + any custom types already in use. Picking "Other"
  // reveals a field to add a brand-new type; once saved it shows up here next time.
  const types = useMemo(() => {
    const all = [...BASE_ACCT_TYPES];
    for (const a of accounts) if (a.acct_type && !all.includes(a.acct_type)) all.push(a.acct_type);
    return all;
  }, [accounts]);

  const [type, setType] = useState(existing?.acct_type ?? types[0] ?? 'Relay');
  const [customType, setCustomType] = useState('');
  const [name, setName] = useState(existing?.name ?? '');
  const [balance, setBalance] = useState(existing?.balance ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Synchronous re-entrancy guard: `disabled={busy}` only applies on the next
  // render, so a fast double-click can fire save() twice and create duplicate
  // accounts. A ref blocks the second call immediately.
  const savingRef = useRef(false);

  const finalType = type === '__other__' ? customType.trim() : type;

  const save = async () => {
    if (savingRef.current) return;
    if (!finalType || !name.trim()) { setError('Account type and name are required'); return; }
    savingRef.current = true;
    setError(null); setBusy(true);
    try {
      if (existing) {
        const data: Partial<{ acct_type: string; name: string; balance: number }> = { acct_type: finalType, name };
        if (canSeedBalance) data.balance = balance;
        await api.payments.updateAccount(existing.id, data);
      } else {
        await api.payments.createAccount({ acct_type: finalType, name, ...(canSeedBalance ? { balance } : {}) });
      }
      onSaved();
    } catch (e) { setError(e instanceof HttpError ? e.message : String(e)); }
    finally { savingRef.current = false; setBusy(false); }
  };

  return (
    <Modal
      title={existing ? 'Edit account' : 'New account'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button>
      </>}
    >
      <div className="form-grid">
        <div className="form-field">
          <label>Account type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value="__other__">Other (add new…)</option>
          </select>
        </div>
        {type === '__other__' && (
          <div className="form-field">
            <label>New account type</label>
            <input value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder="e.g. Mercury, Wise…" autoFocus />
          </div>
        )}
        <div className="form-field">
          <label>Account name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dynamic, Chris" />
        </div>
        {canSeedBalance && (
          <div className="form-field full">
            <label>Current balance ($) <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-soft)' }}>— sets the balance right now; transactions adjust it from here</span></label>
            <input type="number" step="0.01" value={balance} onChange={(e) => setBalance(Number(e.target.value) || 0)} />
          </div>
        )}
        {error && <div className="form-field full"><div className="form-error">{error}</div></div>}
      </div>
    </Modal>
  );
}

// ---------- Page lock gate (mirrors Running Jobs) ----------
function PaymentsLockGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    setError(null); setBusy(true);
    try { await api.payments.unlock(pw); onUnlocked(); }
    catch (e) { setError(e instanceof HttpError ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="lock-card">
      <div className="lock-icon">🔒</div>
      <h2 className="lock-title">Payments is password-protected</h2>
      <p className="lock-sub">Enter the page password to view accounts and transactions.</p>
      <form className="lock-form" onSubmit={submit}>
        <div className="form-field">
          <label>Page password</label>
          <input type="password" autoFocus autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
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
    setError(null); setBusy(true);
    try { await api.payments.changePagePassword(current, next); setDone(true); setTimeout(onClose, 900); }
    catch (e) { setError(e instanceof HttpError ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="Change Payments page password"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || done}>{done ? 'Saved ✓' : busy ? 'Saving…' : 'Change password'}</button>
      </>}
    >
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="form-field"><label>Current page password</label>
          <input type="password" autoComplete="off" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="form-field"><label>New page password</label>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="form-field"><label>Confirm new page password</label>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  );
}
