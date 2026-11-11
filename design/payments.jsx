// ============ Payments page ============
// Two views: Transactions + Accounts, with monthly navigation.
// Money values are masked with animated dots (Telegram-style) and reveal on
// hover; a global eye toggle reveals all at once.

// ---------- Masked money value ----------
function Money({ amount, reveal, prefix = "$" }) {
  const text = prefix + Number(amount || 0).toLocaleString("en-US");
  return (
    <span className={"money" + (reveal ? " reveal" : "")}>
      <span className="money-mask" title={reveal ? "" : "Hover to reveal"}>
        <span className="money-val">{text}</span>
      </span>
    </span>
  );
}

function PaymentsPage({ state, setState, currentUser }) {
  const [view, setView] = useState("transactions"); // 'transactions' | 'accounts'
  const [month, setMonth] = useState("2026-06"); // YYYY-MM
  const [reveal, setReveal] = useState(false);
  const [txnModal, setTxnModal] = useState(false);
  const [acctModal, setAcctModal] = useState(false);

  const accounts = state.accounts || [];
  const txns = state.transactions || [];
  const jobs = state.jobs || [];

  const addTransaction = (t) => setState(s => ({ ...s, transactions: [...(s.transactions || []), { ...t, id: genId("t") }] }));
  const addAccount = (a) => setState(s => ({ ...s, accounts: [...(s.accounts || []), { ...a, id: genId("a") }] }));

  const monthTxns = useMemo(
    () => txns.filter(t => monthKey(t.ts) === month)
              .sort((a, b) => b.ts.localeCompare(a.ts)),
    [txns, month]
  );

  const totals = useMemo(() => {
    let income = 0, out = 0;
    for (const t of monthTxns) {
      if (t.kind === "in") income += (t.amount || 0);
      else out += (t.amount || 0);
    }
    return { income, out, net: income - out };
  }, [monthTxns]);

  // per-account in/out for the selected month
  const monthByAccount = useMemo(() => {
    const m = {};
    const bump = (id, key, amt) => { if (!id) return; m[id] = m[id] || { in: 0, out: 0 }; m[id][key] += amt; };
    for (const t of monthTxns) {
      if (t.kind === "in") bump(t.toAccountId, "in", t.amount || 0);
      else bump(t.fromAccountId, "out", t.amount || 0);
    }
    return m;
  }, [monthTxns]);

  const totalBalance = useMemo(() => accounts.reduce((s, a) => s + (a.balance || 0), 0), [accounts]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">
            Account balances and transactions across Relay, Unifi and Coinbase. Values are hidden — hover any figure to reveal it.
          </p>
        </div>
        <div className="page-actions">
          <div className="seg">
            {[["transactions", "Transactions"], ["accounts", "Accounts"]].map(([v, lbl]) => (
              <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="btn btn-icon" onClick={() => setMonth(m => shiftMonth(m, -1))} title="Previous month">‹</button>
          <button className="btn btn-icon" onClick={() => setMonth(m => shiftMonth(m, 1))} title="Next month">›</button>
        </div>
        <span className="cal-month-label">{monthLabel(month)}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {view === "accounts"
            ? <button className="btn" onClick={() => setAcctModal(true)}>＋ Account</button>
            : <button className="btn btn-primary" onClick={() => setTxnModal(true)}>＋ Transaction</button>}
          <label className="toggle pay-reveal-toggle" style={{ marginLeft: 4 }}>
            <input type="checkbox" checked={reveal} onChange={e => setReveal(e.target.checked)} />
            <span className="toggle-switch"></span>
            <span>{reveal ? "👁 Values shown" : "🙈 Values hidden"}</span>
          </label>
        </div>
      </div>

      {view === "accounts" ? (
        <AccountsView accounts={accounts} monthByAccount={monthByAccount} monthLabelStr={monthLabel(month)}
                      totalBalance={totalBalance} totals={totals} reveal={reveal} />
      ) : (
        <TransactionsView state={state} txns={monthTxns} totals={totals}
                          monthLabelStr={monthLabel(month)} reveal={reveal} />
      )}

      {txnModal && (
        <TransactionModal accounts={accounts} jobs={jobs}
                          onSave={(t) => { addTransaction(t); setTxnModal(false); }}
                          onClose={() => setTxnModal(false)} />
      )}
      {acctModal && (
        <AccountModal accounts={accounts}
                      onSave={(a) => { addAccount(a); setAcctModal(false); }}
                      onClose={() => setAcctModal(false)} />
      )}
    </div>
  );
}

// ---------- shared: render a transaction party (account badge or plain text) ----------
const KNOWN_TYPES = ["Relay", "Unifi", "Coinbase"];
function badgeType(t) { return KNOWN_TYPES.includes(t) ? t : "other"; }
function Party({ account, text }) {
  if (account) {
    return (
      <span className="txn-from">
        <span className="txn-acct-badge" data-type={badgeType(account.type)}>{(account.type || "?").slice(0, 1)}</span>
        {accountLabel(account)}
      </span>
    );
  }
  return <span>{text}</span>;
}

// ---------- Accounts view ----------
function AccountsView({ accounts, monthByAccount, monthLabelStr, totalBalance, totals, reveal }) {
  return (
    <div>
      <div className="pay-summary">
        <div className="stat">
          <div className="stat-label">Total balance</div>
          <div className="stat-value mono"><Money amount={totalBalance} reveal={reveal} /></div>
          <div className="stat-sub">{accounts.length} accounts</div>
        </div>
        <div className="stat">
          <div className="stat-label">Income · {monthLabelStr}</div>
          <div className="stat-value mono" style={{ color: "var(--success)" }}><Money amount={totals.income} reveal={reveal} /></div>
          <div className="stat-sub">received</div>
        </div>
        <div className="stat">
          <div className="stat-label">Spent · {monthLabelStr}</div>
          <div className="stat-value mono" style={{ color: "var(--warning)" }}><Money amount={totals.out} reveal={reveal} /></div>
          <div className="stat-sub">paid out</div>
        </div>
        <div className="stat" style={{ background: "#0c0a09", borderColor: "#0c0a09" }}>
          <div className="stat-label" style={{ color: "rgba(255,255,255,0.6)" }}>Net · {monthLabelStr}</div>
          <div className="stat-value mono" style={{ color: "white" }}><Money amount={totals.net} reveal={reveal} /></div>
          <div className="stat-sub" style={{ color: "rgba(255,255,255,0.6)" }}>income − spent</div>
        </div>
      </div>

      <div className="acct-grid">
        {accounts.map(a => {
          const m = monthByAccount[a.id] || { in: 0, out: 0 };
          return (
            <div className="acct-card" key={a.id}>
              <div className="acct-card-top">
                <span className="acct-badge" data-type={badgeType(a.type)}>{a.type.slice(0, 2).toUpperCase()}</span>
                <div>
                  <div className="acct-type">{a.type}</div>
                  <div className="acct-name">{a.name}</div>
                </div>
              </div>
              <div className="acct-balance-label">Current balance</div>
              <div className="acct-balance"><Money amount={a.balance} reveal={reveal} /></div>
              <div className="acct-month-out">
                <span style={{ color: "var(--success)" }}>▲ In</span>
                <Money amount={m.in} reveal={reveal} />
                <span style={{ color: "var(--warning)", marginLeft: 10 }}>▼ Out</span>
                <Money amount={m.out} reveal={reveal} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Transactions view ----------
function TransactionsView({ state, txns, totals, monthLabelStr, reveal }) {
  const jobCompanies = useMemo(
    () => new Set((state.jobs || []).map(j => j.company)),
    [state.jobs]
  );
  return (
    <div>
      <div className="pay-summary">
        <div className="stat">
          <div className="stat-label">Transactions · {monthLabelStr}</div>
          <div className="stat-value">{txns.length}</div>
          <div className="stat-sub">this month</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total income · {monthLabelStr}</div>
          <div className="stat-value mono" style={{ color: "var(--success)" }}><Money amount={totals.income} reveal={reveal} /></div>
          <div className="stat-sub">money in</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total out · {monthLabelStr}</div>
          <div className="stat-value mono" style={{ color: "var(--warning)" }}><Money amount={totals.out} reveal={reveal} /></div>
          <div className="stat-sub">money out</div>
        </div>
        <div className="stat" style={{ background: "#0c0a09", borderColor: "#0c0a09" }}>
          <div className="stat-label" style={{ color: "rgba(255,255,255,0.6)" }}>Net · {monthLabelStr}</div>
          <div className="stat-value mono" style={{ color: "white" }}><Money amount={totals.net} reveal={reveal} /></div>
          <div className="stat-sub" style={{ color: "rgba(255,255,255,0.6)" }}>income − out</div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Date &amp; time <span style={{ color: "var(--text-soft)", fontWeight: 500 }}>(ET)</span></th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Purpose</th>
                <th className="amount-col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {txns.length === 0 && (
                <tr><td colSpan={6}><Empty title="No transactions" hint={`Nothing recorded in ${monthLabelStr}.`} /></td></tr>
              )}
              {txns.map(t => {
                const isIn = t.kind === "in";
                const fromAcc = isIn ? null : accountById(state, t.fromAccountId);
                const toAcc = isIn ? accountById(state, t.toAccountId) : null;
                return (
                  <tr key={t.id}>
                    <td className="num" style={{ fontWeight: 600 }}>{formatDateTime(t.ts)}</td>
                    <td>
                      <span className={"badge dot " + (isIn ? "success" : "warning")}>{isIn ? "Income" : "Expense"}</span>
                    </td>
                    <td>
                      {isIn && t.from && jobCompanies.has(t.from) && (
                        <span className="badge accent" style={{ marginRight: 6 }} title="Income from a running job">Job</span>
                      )}
                      <Party account={fromAcc} text={t.from} />
                    </td>
                    <td><Party account={toAcc} text={t.to} /></td>
                    <td className="muted">{t.purpose}</td>
                    <td className="amount-cell">
                      <span style={{ color: reveal ? (isIn ? "var(--success)" : "var(--text)") : undefined }}>
                        <Money amount={t.amount} reveal={reveal} prefix={isIn ? "+$" : "−$"} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {txns.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, background: "var(--surface-2)" }}>
                  <td colSpan={5} style={{ textAlign: "right" }}>Net total</td>
                  <td className="amount-cell"><Money amount={totals.net} reveal={reveal} /></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- New transaction modal ----------
function TransactionModal({ accounts, jobs, onSave, onClose }) {
  const [kind, setKind] = useState("out"); // 'in' | 'out'
  // Timestamp is captured automatically at the moment the modal opens.
  const now = useMemo(() => new Date(), []);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const nowLabel = formatDateTime(`${date}T${time}`);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [acctId, setAcctId] = useState(accounts[0]?.id || ""); // our account (from for out, to for in)
  const [party, setParty] = useState("");        // the other side (text)
  const [jobSource, setJobSource] = useState(""); // optional job id for income source

  // unique job sources (company — used as income source)
  const jobOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const j of jobs) {
      if (seen.has(j.company)) continue;
      seen.add(j.company);
      out.push(j);
    }
    return out;
  }, [jobs]);

  const amt = parseFloat(amount) || 0;
  const incomeFrom = jobSource
    ? (jobOptions.find(j => j.id === jobSource)?.company || "")
    : party.trim();
  const valid = amt > 0 && acctId &&
    (kind === "out" ? party.trim() : incomeFrom);

  const save = () => {
    if (!valid) return;
    const ts = `${date}T${time}`;
    if (kind === "in") {
      onSave({ ts, kind: "in", from: incomeFrom, toAccountId: acctId, purpose: purpose.trim(), amount: amt });
    } else {
      onSave({ ts, kind: "out", fromAccountId: acctId, to: party.trim(), purpose: purpose.trim(), amount: amt });
    }
  };

  return (
    <Modal
      title="New transaction"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid} onClick={save}>Add transaction</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field full">
          <label>Type</label>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            <button className={kind === "out" ? "active" : ""} onClick={() => setKind("out")}>Expense (out)</button>
            <button className={kind === "in" ? "active" : ""} onClick={() => setKind("in")}>Income (in)</button>
          </div>
        </div>

        <div className="form-field full">
          <label>Date &amp; time (ET)</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", fontWeight: 600 }}>
            <span className="num">{nowLabel}</span>
            <span className="badge">auto</span>
          </div>
        </div>

        {kind === "in" ? (
          <>
            <div className="form-field">
              <label>From — job source</label>
              <select value={jobSource} onChange={e => setJobSource(e.target.value)}>
                <option value="">— Custom source —</option>
                {jobOptions.map(j => <option key={j.id} value={j.id}>{j.company}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>From — custom</label>
              <input value={party} onChange={e => setParty(e.target.value)}
                     disabled={!!jobSource} placeholder={jobSource ? "Using job source" : "Payer name"} />
            </div>
            <div className="form-field">
              <label>To — account</label>
              <select value={acctId} onChange={e => setAcctId(e.target.value)}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.type} {a.name}</option>)}
              </select>
            </div>
            <div className="form-field"><span></span></div>
          </>
        ) : (
          <>
            <div className="form-field">
              <label>From — account</label>
              <select value={acctId} onChange={e => setAcctId(e.target.value)}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.type} {a.name}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>To — person / vendor</label>
              <input value={party} onChange={e => setParty(e.target.value)} placeholder="e.g. Juan, AWS…" />
            </div>
          </>
        )}

        <div className="form-field">
          <label>Amount ($)</label>
          <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
        </div>
        <div className="form-field">
          <label>Purpose</label>
          <input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. Monthly laptop fee" />
        </div>
      </div>
      {kind === "in" && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
          Income source can be a running job (client salary) or a custom payer. The “To” side is always one of your accounts.
        </div>
      )}
    </Modal>
  );
}

// ---------- New account modal ----------
function AccountModal({ accounts, onSave, onClose }) {
  // Available types = base set + any custom types already in use.
  const types = useMemo(() => {
    const base = ["Relay", "Unifi", "Coinbase"];
    const all = [...base];
    for (const a of (accounts || [])) if (a.type && !all.includes(a.type)) all.push(a.type);
    return all;
  }, [accounts]);

  const [type, setType] = useState(types[0] || "Relay");
  const [customType, setCustomType] = useState("");
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");

  const finalType = type === "Other" ? customType.trim() : type;
  const valid = finalType && name.trim();

  const save = () => {
    if (!valid) return;
    onSave({ type: finalType, name: name.trim(), balance: parseFloat(balance) || 0 });
  };

  return (
    <Modal
      title="New account"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid} onClick={save}>Add account</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label>Account type</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
            <option value="Other">Other (add new…)</option>
          </select>
        </div>
        {type === "Other" && (
          <div className="form-field">
            <label>New account type</label>
            <input value={customType} onChange={e => setCustomType(e.target.value)} placeholder="e.g. Mercury, Wise…" />
          </div>
        )}
        <div className="form-field">
          <label>Account name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dynamic" />
        </div>
        <div className="form-field">
          <label>Starting balance ($)</label>
          <input type="number" value={balance} onChange={e => setBalance(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
        Shown as “{finalType || "Type"} {name || "Name"}” in the accounts list. New types you add here appear in this dropdown next time.
      </div>
    </Modal>
  );
}

window.PaymentsPage = PaymentsPage;
