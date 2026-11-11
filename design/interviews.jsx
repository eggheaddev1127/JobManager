// ============ Interviews page ============

function InterviewsPage({ state, setState, currentUser }) {
  const isAdmin = currentUser.roles.includes("admin");
  const isDevOnly = !isAdmin && currentUser.roles.includes("dev");

  // ---------- Filters ----------
  const [month, setMonth] = useState(() => {
    // Default to current month if it has any interviews; otherwise newest month available.
    const cur = currentMonthKey();
    const monthsAvail = uniqueMonths(state.interviews);
    if (monthsAvail.includes(cur)) return cur;
    return monthsAvail[0] || cur;
  });
  const [liveOnly, setLiveOnly] = useState(false);
  const [followupOnly, setFollowupOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [progressFilter, setProgressFilter] = useState("All");
  const [hiddenHandlers, setHiddenHandlers] = useState([]); // handler ids hidden from the table
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const [editing, setEditing] = useState(null);

  const allMonths = useMemo(() => uniqueMonths(state.interviews), [state.interviews]);

  // ---------- Visible interviews ----------
  // Dev sees only their own interviews
  const visibleAll = useMemo(() => {
    return state.interviews.filter(it => {
      if (isDevOnly && it.handlerId !== currentUser.id) return false;
      return true;
    });
  }, [state.interviews, isDevOnly, currentUser.id]);

  // Pipeline-aware rows for liveOnly mode:
  //   - For each company, compute pipeline alive/dead across ALL interviews of that company (in visibleAll).
  //   - If alive, surface the single latest interview, attach passedCount badge.
  // Note: liveOnly ignores month filter for pipeline aliveness (pipeline state is global),
  //       but we still filter the surfaced "latest" by month so the table reflects the selected month.
  // Actually, more useful: in liveOnly mode show one row per live pipeline regardless of month,
  // because that's the "current state of all live pipelines" view the user described.
  const pipelineRows = useMemo(() => {
    if (!liveOnly) return null;
    const companies = [...new Set(visibleAll.map(it => it.company))];
    const out = [];
    for (const company of companies) {
      const pipe = pipelineForCompany(state, visibleAll, company);
      if (!pipe.live || !pipe.latestInterview) continue;
      out.push({ ...pipe.latestInterview, _passedCount: pipe.passedCount, _stepIdx: stepIndex(state, pipe.latestInterview.step), _isPipelineLatest: true });
    }
    return out;
  }, [liveOnly, visibleAll, state]);

  const rows = useMemo(() => {
    let base = pipelineRows || visibleAll;

    // Month filter (skipped in liveOnly and followupOnly modes — those are global views)
    if (!liveOnly && !followupOnly && month) {
      base = base.filter(it => monthKey(it.date) === month);
    }

    // Other filters apply always
    if (progressFilter !== "All") base = base.filter(it => it.progress === progressFilter);
    if (!isDevOnly && hiddenHandlers.length) base = base.filter(it => !hiddenHandlers.includes(it.handlerId));
    if (followupOnly) base = base.filter(it => needsFollowUp(it));
    if (search) {
      const q = search.toLowerCase();
      base = base.filter(it => {
        const profile = profileById(state, it.profileId);
        return [it.company, it.step, it.notes, profile?.name, userById(state, it.handlerId)?.name]
          .some(v => String(v || "").toLowerCase().includes(q));
      });
    }

    // Sorting
    return sortRows(base, sort, (r, k) => {
      if (k === "profileName") return profileById(state, r.profileId)?.name || "";
      if (k === "handler") return userById(state, r.handlerId)?.name || "";
      if (k === "stepOrder") return stepIndex(state, r.step);
      return r[k];
    });
  }, [pipelineRows, visibleAll, month, liveOnly, followupOnly, progressFilter, hiddenHandlers, isDevOnly, search, sort, state]);

  // ---------- Handlers list (for filter) ----------
  const handlers = state.users.filter(u => u.access && u.roles.includes("dev"));

  // ---------- Mutations ----------
  const onSave = (interview) => {
    setState(s => {
      const exists = s.interviews.find(i => i.id === interview.id);
      const interviews = exists ? s.interviews.map(i => i.id === interview.id ? interview : i) : [...s.interviews, interview];
      return { ...s, interviews };
    });
    setEditing(null);
  };

  const onDelete = (id) => {
    if (!confirm("Delete this interview?")) return;
    setState(s => ({ ...s, interviews: s.interviews.filter(i => i.id !== id) }));
  };

  // ---------- Counts ----------
  const counts = useMemo(() => {
    const monthRows = visibleAll.filter(it => monthKey(it.date) === month);
    const passed = monthRows.filter(it => it.progress === "Passed").length;
    const failed = monthRows.filter(it => it.progress === "Failed").length;
    const waiting = monthRows.filter(it => it.progress === "Waiting").length;
    return { total: monthRows.length, passed, failed, waiting };
  }, [visibleAll, month]);

  // Follow-ups are global (any month), not limited to the selected month.
  const followupCount = useMemo(
    () => visibleAll.filter(it => needsFollowUp(it)).length,
    [visibleAll]
  );

  const livePipelineCount = useMemo(() => {
    const companies = [...new Set(visibleAll.map(it => it.company))];
    return companies.reduce((n, c) => {
      const p = pipelineForCompany(state, visibleAll, c);
      return n + (p.live ? 1 : 0);
    }, 0);
  }, [visibleAll, state]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Interviews</h1>
          <p className="page-subtitle">
            {isDevOnly
              ? <>Interviews assigned to you, <strong>{currentUser.name}</strong>.</>
              : "Every interview round across every pipeline. Toggle live pipelines to focus on what's still in play."}
          </p>
        </div>
        <div className="page-actions">
          <input className="input search-input" placeholder="Search company, profile, notes…"
                 value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setEditing("new")}>+ New interview</button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">This month</div>
          <div className="stat-value">{counts.total}</div>
          <div className="stat-sub">{monthLabel(month)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Passed</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{counts.passed}</div>
          <div className="stat-sub">moved forward</div>
        </div>
        <div className="stat">
          <div className="stat-label">Waiting</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{counts.waiting}</div>
          <div className="stat-sub">awaiting feedback</div>
        </div>
        <div className="stat">
          <div className="stat-label">Failed</div>
          <div className="stat-value" style={{ color: "var(--danger)" }}>{counts.failed}</div>
          <div className="stat-sub">this month</div>
        </div>
        <div className="stat" style={{ background: "var(--accent-soft)", borderColor: "transparent" }}>
          <div className="stat-label" style={{ color: "var(--accent-text)" }}>Live pipelines</div>
          <div className="stat-value" style={{ color: "var(--accent-text)" }}>{livePipelineCount}</div>
          <div className="stat-sub" style={{ color: "var(--accent-text)" }}>still in play</div>
        </div>
        <div className="stat"
             onClick={() => setFollowupOnly(v => !v)}
             style={{ cursor: "pointer", background: followupOnly ? "#db2777" : "#fdf2f8", borderColor: "transparent" }}
             title={`Waiting ${FOLLOWUP_DAYS}+ days — click to filter`}>
          <div className="stat-label" style={{ color: followupOnly ? "rgba(255,255,255,0.7)" : "#be185d" }}>Needs follow-up</div>
          <div className="stat-value" style={{ color: followupOnly ? "#fff" : "#be185d" }}>{followupCount}</div>
          <div className="stat-sub" style={{ color: followupOnly ? "rgba(255,255,255,0.7)" : "#be185d" }}>
            waiting {FOLLOWUP_DAYS}+ days {followupOnly ? "· filtering" : ""}
          </div>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-group">
          <label>Month</label>
          <select className="select" value={month} onChange={e => setMonth(e.target.value)} disabled={liveOnly}>
            {allMonths.map(m => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
            {!allMonths.includes(month) && <option value={month}>{monthLabel(month)}</option>}
          </select>
        </div>

        <div className="filter-group">
          <label>Progress</label>
          <select className="select" value={progressFilter} onChange={e => setProgressFilter(e.target.value)}>
            <option>All</option>
            <option>Passed</option>
            <option>Waiting</option>
            <option>Failed</option>
          </select>
        </div>

        {!isDevOnly && (
          <div className="filter-group">
            <label>Handlers</label>
            <HandlerFilter state={state} handlers={handlers} hidden={hiddenHandlers} setHidden={setHiddenHandlers} />
          </div>
        )}

        <label className="toggle" style={{ marginLeft: 8 }}>
          <input type="checkbox" checked={liveOnly} onChange={e => setLiveOnly(e.target.checked)} />
          <span className="toggle-switch"></span>
          <span>Live pipelines only</span>
        </label>

        <label className="toggle">
          <input type="checkbox" checked={followupOnly} onChange={e => setFollowupOnly(e.target.checked)} />
          <span className="toggle-switch"></span>
          <span>Needs follow-up only</span>
        </label>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
          <span className="legend">
            <span className="legend-item"><span className="legend-swatch today"></span>Today</span>
            <span className="legend-item"><span className="legend-swatch tomorrow"></span>Tomorrow</span>
            <span className="legend-item"><span className="legend-swatch future"></span>Upcoming</span>
            <span className="legend-item"><span className="legend-swatch followup"></span>Follow-up</span>
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {followupOnly
              ? <>Showing {rows.length} interview{rows.length === 1 ? "" : "s"} needing follow-up</>
              : liveOnly
              ? <>Showing latest step for {rows.length} live pipeline{rows.length === 1 ? "" : "s"}</>
              : <>Showing {rows.length} interview{rows.length === 1 ? "" : "s"} in {monthLabel(month)}</>}
          </span>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <SortHeader label="Date" sortKey="date" sort={sort} setSort={setSort} />
                <SortHeader label="Slot (EST)" sortKey="slot" sort={sort} setSort={setSort} />
                <SortHeader label="Profile" sortKey="profileName" sort={sort} setSort={setSort} />
                <SortHeader label="Company" sortKey="company" sort={sort} setSort={setSort} />
                <SortHeader label="Step" sortKey="stepOrder" sort={sort} setSort={setSort} />
                <SortHeader label="Progress" sortKey="progress" sort={sort} setSort={setSort} />
                <SortHeader label="Handler" sortKey="handler" sort={sort} setSort={setSort} />
                <th>Links</th>
                <SortHeader label="Notes" sortKey="notes" sort={sort} setSort={setSort} />
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={10}><Empty
                  title={liveOnly ? "No live pipelines" : "No interviews this month"}
                  hint={liveOnly ? "All pipelines have either failed or none exist yet." : "Try a different month or add a new interview."}
                /></td></tr>
              )}
              {rows.map(it => {
                const profile = profileById(state, it.profileId);
                const bucket = dateBucket(it.date);
                const followup = needsFollowUp(it);
                const rowClass = followup ? "row-followup"
                  : bucket === "today" ? "row-today"
                  : bucket === "tomorrow" ? "row-tomorrow"
                  : bucket === "future" ? "row-future" : "";
                return (
                  <tr key={it.id} className={rowClass}>
                    <td className="num" style={{ fontWeight: 600 }}>
                      <span className="date-cell">
                        {formatDate(it.date)}
                        {bucket === "today" && <span className="when-tag today">Today</span>}
                        {bucket === "tomorrow" && <span className="when-tag tomorrow">Tomorrow</span>}
                        {bucket === "future" && <span className="when-tag future">Upcoming</span>}
                        {followup && <span className="followup-tag" title={`Waiting ${daysSince(it.date)} days`}>⚑ Follow up · {daysSince(it.date)}d</span>}
                      </span>
                    </td>
                    <td className="num">{it.slot}</td>
                    <td>{profile ? profile.name : <span className="dash">—</span>}</td>
                    <td style={{ fontWeight: 600 }}>{it.company}</td>
                    <td>
                      <div className="step-stack">
                        <StepPill step={it.step} />
                        {it._isPipelineLatest && it._passedCount > 0 && (
                          <span className="badge success" title={`${it._passedCount} step${it._passedCount === 1 ? "" : "s"} passed in this pipeline`}>
                            {it._passedCount} passed
                          </span>
                        )}
                      </div>
                    </td>
                    <td><ProgressBadge progress={it.progress} /></td>
                    <td><HandlerChip state={state} handlerId={it.handlerId} /></td>
                    <td>
                      <span className="link-icons">
                        {(it.meetingType === "phone")
                          ? <span className="link-icon phone" title={it.phone ? `Phone call · ${it.phone}` : "Phone call — no link"}>📞</span>
                          : <LinkIcon href={it.meeting} label="🎥" title="Meeting link" />}
                        <LinkIcon href={it.jd} label="JD" title="Job description" />
                        <LinkIcon href={it.recording} label="REC" title="Recording" />
                      </span>
                    </td>
                    <td className="cell-notes">{it.notes || <span className="dash">—</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn btn-ghost" onClick={() => setEditing(it)}>Edit</button>
                      <button className="btn btn-ghost btn-danger" onClick={() => onDelete(it.id)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <InterviewEditor
          state={state}
          interview={editing === "new"
            ? { id: genId("i"), date: new Date().toISOString().slice(0, 10), slot: "",
                profileId: state.profiles[0]?.id || "", company: "",
                step: state.steps[0], progress: "Waiting",
                handlerId: currentUser.id,
                meeting: "", jd: "", recording: "", notes: "" }
            : editing}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function InterviewEditor({ state, interview, onSave, onClose }) {
  const [it, setIt] = useState(interview);
  const set = (k, v) => setIt(x => ({ ...x, [k]: v }));
  const handlers = state.users.filter(u => u.access);
  return (
    <Modal
      title={interview.company ? "Edit interview" : "New interview"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(it)}>Save interview</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label>Date</label>
          <input type="date" value={it.date} onChange={e => set("date", e.target.value)} />
        </div>
        <div className="form-field">
          <label>Meeting slot (EST)</label>
          <input value={it.slot} onChange={e => set("slot", e.target.value)} placeholder="e.g. 9:00–9:30am" />
        </div>
        <div className="form-field">
          <label>Profile</label>
          <select value={it.profileId} onChange={e => set("profileId", e.target.value)}>
            {state.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Company</label>
          <input value={it.company} onChange={e => set("company", e.target.value)} />
        </div>
        <div className="form-field">
          <label>Step</label>
          <select value={it.step} onChange={e => set("step", e.target.value)}>
            {state.steps.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Progress</label>
          <select value={it.progress} onChange={e => set("progress", e.target.value)}>
            <option>Waiting</option>
            <option>Passed</option>
            <option>Failed</option>
          </select>
        </div>
        <div className="form-field">
          <label>Handler</label>
          <select value={it.handlerId} onChange={e => set("handlerId", e.target.value)}>
            {handlers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Meeting type</label>
          <select value={it.meetingType || "video"} onChange={e => set("meetingType", e.target.value)}>
            <option value="video">Video call (has link)</option>
            <option value="phone">Phone call (no link)</option>
          </select>
        </div>
        {(it.meetingType || "video") === "phone" ? (
          <div className="form-field full">
            <label>Phone number <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-soft)" }}>(optional)</span></label>
            <input value={it.phone || ""} onChange={e => set("phone", e.target.value)} placeholder="e.g. +1 (415) 555-0142" />
          </div>
        ) : (
          <div className="form-field full">
            <label>Meeting URL</label>
            <input value={it.meeting} onChange={e => set("meeting", e.target.value)} placeholder="https://…" />
          </div>
        )}
        <div className="form-field full">
          <label>JD URL</label>
          <input value={it.jd} onChange={e => set("jd", e.target.value)} />
        </div>
        <div className="form-field full">
          <label>Recording URL</label>
          <input value={it.recording} onChange={e => set("recording", e.target.value)} />
        </div>
        <div className="form-field full">
          <label>Notes</label>
          <textarea value={it.notes} onChange={e => set("notes", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

window.InterviewsPage = InterviewsPage;
