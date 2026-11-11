// ============ Running Jobs page ============

function JobsPage({ state, setState }) {
  const [sort, setSort] = useState({ key: "startDate", dir: "desc" });
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const rows = useMemo(() => {
    const filtered = state.jobs.filter(j => {
      const p = profileById(state, j.profileId);
      const matchesSearch = !search ||
        [j.company, j.title, j.source, p?.name].some(v => String(v || "").toLowerCase().includes(search.toLowerCase()));
      const matchesStatus = statusFilter === "All" || j.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    return sortRows(filtered, sort, (r, k) => {
      if (k === "profileName") return profileById(state, r.profileId)?.name || "";
      if (k === "netDev") return r.salaryMo - r.payoutCaller - r.payoutDev;
      return r[k];
    });
  }, [state, sort, search, statusFilter]);

  // Monthly income summary — only Active jobs
  const summary = useMemo(() => {
    const active = state.jobs.filter(j => j.status === "Active");
    const totalSalary = active.reduce((s, j) => s + j.salaryMo, 0);
    const totalCaller = active.reduce((s, j) => s + j.payoutCaller, 0);
    const totalDev = active.reduce((s, j) => s + j.payoutDev, 0);
    const net = totalSalary - totalCaller - totalDev;
    return { totalSalary, totalCaller, totalDev, net, count: active.length };
  }, [state.jobs]);

  const onSave = (job) => {
    setState(s => {
      const exists = s.jobs.find(j => j.id === job.id);
      const jobs = exists ? s.jobs.map(j => j.id === job.id ? job : j) : [...s.jobs, job];
      return { ...s, jobs };
    });
    setEditing(null);
  };

  const onDelete = (id) => {
    if (!confirm("Delete this job?")) return;
    setState(s => ({ ...s, jobs: s.jobs.filter(j => j.id !== id) }));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Running Jobs</h1>
          <p className="page-subtitle">Active job pipelines, their economics, and monthly run-rate.</p>
        </div>
        <div className="page-actions">
          <input className="input search-input" placeholder="Search jobs…"
                 value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setEditing("new")}>+ New job</button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">Active jobs</div>
          <div className="stat-value">{summary.count}</div>
          <div className="stat-sub">of {state.jobs.length} total</div>
        </div>
        <div className="stat">
          <div className="stat-label">Monthly gross</div>
          <div className="stat-value mono">{formatMoney(summary.totalSalary)}</div>
          <div className="stat-sub">sum of salaries</div>
        </div>
        <div className="stat">
          <div className="stat-label">Caller payouts</div>
          <div className="stat-value mono" style={{ color: "var(--warning)" }}>−{formatMoney(summary.totalCaller)}</div>
          <div className="stat-sub">monthly</div>
        </div>
        <div className="stat">
          <div className="stat-label">Dev payouts</div>
          <div className="stat-value mono" style={{ color: "var(--warning)" }}>−{formatMoney(summary.totalDev)}</div>
          <div className="stat-sub">monthly</div>
        </div>
        <div className="stat" style={{ background: "#0c0a09", color: "white", borderColor: "#0c0a09" }}>
          <div className="stat-label" style={{ color: "rgba(255,255,255,0.6)" }}>Net monthly income</div>
          <div className="stat-value mono">{formatMoney(summary.net)}</div>
          <div className="stat-sub" style={{ color: "rgba(255,255,255,0.6)" }}>gross − payouts</div>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-group">
          <label>Status</label>
          <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option>All</option>
            <option>Active</option>
            <option>Paused</option>
            <option>Closed</option>
          </select>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
          Showing {rows.length} of {state.jobs.length} jobs
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <SortHeader label="Company" sortKey="company" sort={sort} setSort={setSort} />
                <SortHeader label="Job Title" sortKey="title" sort={sort} setSort={setSort} />
                <SortHeader label="Profile" sortKey="profileName" sort={sort} setSort={setSort} />
                <SortHeader label="Source" sortKey="source" sort={sort} setSort={setSort} />
                <SortHeader label="Salary / mo" sortKey="salaryMo" sort={sort} setSort={setSort} align="right" />
                <SortHeader label="Caller Payout" sortKey="payoutCaller" sort={sort} setSort={setSort} align="right" />
                <SortHeader label="Dev Payout" sortKey="payoutDev" sort={sort} setSort={setSort} align="right" />
                <SortHeader label="Net / mo" sortKey="netDev" sort={sort} setSort={setSort} align="right" />
                <SortHeader label="Started" sortKey="startDate" sort={sort} setSort={setSort} />
                <SortHeader label="Status" sortKey="status" sort={sort} setSort={setSort} />
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11}><Empty title="No jobs match" hint="Try a different status or clear the search." /></td></tr>
              )}
              {rows.map(j => {
                const p = profileById(state, j.profileId);
                const net = j.salaryMo - j.payoutCaller - j.payoutDev;
                return (
                  <tr key={j.id}>
                    <td style={{ fontWeight: 600 }}>{j.company}</td>
                    <td>{j.title}</td>
                    <td>{p ? p.name : <span className="dash">—</span>}</td>
                    <td><span className="badge">{j.source}</span></td>
                    <td className="num" style={{ textAlign: "right" }}>{formatMoney(j.salaryMo)}</td>
                    <td className="num" style={{ textAlign: "right", color: "var(--text-muted)" }}>{formatMoney(j.payoutCaller)}</td>
                    <td className="num" style={{ textAlign: "right", color: "var(--text-muted)" }}>{formatMoney(j.payoutDev)}</td>
                    <td className="num" style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(net)}</td>
                    <td className="num">{formatDate(j.startDate)}</td>
                    <td>
                      <span className={"badge dot " + (
                        j.status === "Active" ? "success" :
                        j.status === "Paused" ? "warning" :
                        "danger"
                      )}>{j.status}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn btn-ghost" onClick={() => setEditing(j)}>Edit</button>
                      <button className="btn btn-ghost btn-danger" onClick={() => onDelete(j.id)}>Delete</button>
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
          state={state}
          job={editing === "new"
            ? { id: genId("j"), profileId: state.profiles[0]?.id || "", company: "", title: "",
                source: "LinkedIn", salaryMo: 0, payoutCaller: 0, payoutDev: 0,
                status: "Active", startDate: new Date().toISOString().slice(0, 10) }
            : editing}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function JobEditor({ state, job, onSave, onClose }) {
  const [j, setJ] = useState(job);
  const set = (k, v) => setJ(x => ({ ...x, [k]: v }));
  return (
    <Modal
      title={job.company ? "Edit job" : "New job"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(j)}>Save job</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label>Company</label>
          <input value={j.company} onChange={e => set("company", e.target.value)} />
        </div>
        <div className="form-field">
          <label>Job Title</label>
          <input value={j.title} onChange={e => set("title", e.target.value)} />
        </div>
        <div className="form-field">
          <label>Profile</label>
          <select value={j.profileId} onChange={e => set("profileId", e.target.value)}>
            {state.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Source</label>
          <select value={j.source} onChange={e => set("source", e.target.value)}>
            <option>LinkedIn</option>
            <option>Job Apply</option>
            <option>Agency</option>
            <option>Referral</option>
            <option>Indeed</option>
            <option>Other</option>
          </select>
        </div>
        <div className="form-field">
          <label>Salary / month ($)</label>
          <input type="number" value={j.salaryMo} onChange={e => set("salaryMo", parseInt(e.target.value) || 0)} />
        </div>
        <div className="form-field">
          <label>Caller payout ($)</label>
          <input type="number" value={j.payoutCaller} onChange={e => set("payoutCaller", parseInt(e.target.value) || 0)} />
        </div>
        <div className="form-field">
          <label>Dev payout ($)</label>
          <input type="number" value={j.payoutDev} onChange={e => set("payoutDev", parseInt(e.target.value) || 0)} />
        </div>
        <div className="form-field">
          <label>Start date</label>
          <input type="date" value={j.startDate} onChange={e => set("startDate", e.target.value)} />
        </div>
        <div className="form-field">
          <label>Status</label>
          <select value={j.status} onChange={e => set("status", e.target.value)}>
            <option>Active</option>
            <option>Paused</option>
            <option>Closed</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}

window.JobsPage = JobsPage;
