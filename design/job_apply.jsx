// ============ Job Apply page ============
// Daily list of job links (with duplicate detection) + per-profile sign-off.
// Weekly view rolls up applications-per-profile.
// Seed links are a SEPARATE reference database (admin-managed) — they never
// appear in the daily list; they're only used to flag a day's links as
// already-applied. Duplicate check for a day = same-day links + other days'
// daily links + the seed database.

function JobApplyPage({ state, setState, currentUser }) {
  const isAdmin = currentUser.roles.includes("admin");
  const [view, setView] = useState("daily"); // 'daily' | 'weekly' | 'database'
  const [anchor, setAnchor] = useState(() => todayISO());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [dbPromptOpen, setDbPromptOpen] = useState(false);
  const [toast, setToast] = useState("");
  const today = todayISO();

  const flash = (msg) => { setToast(msg); window.clearTimeout(flash._t); flash._t = window.setTimeout(() => setToast(""), 2200); };

  const getDay = (d) => state.jobApply?.[d] || { links: [], confirmed: {} };
  const seedLinks = state.seedLinks || [];

  // keep view valid for role
  useEffect(() => { if (view === "database" && !isAdmin) setView("daily"); }, [isAdmin, view]);

  const mutateDay = (d, fn) => {
    setState(s => {
      const ja = { ...(s.jobApply || {}) };
      const prev = ja[d] || {};
      const day = { links: [...(prev.links || [])], confirmed: { ...(prev.confirmed || {}) }, done: !!prev.done };
      fn(day);
      ja[d] = day;
      return { ...s, jobApply: ja };
    });
  };

  const addLink = (d, url) => { if (url.trim()) mutateDay(d, day => day.links.push(url.trim())); };
  const addLinksBulk = (d, urls) => mutateDay(d, day => urls.forEach(u => day.links.push(u)));
  const deleteLink = (d, idx) => mutateDay(d, day => day.links.splice(idx, 1));
  const deleteLinks = (d, idxs) => mutateDay(d, day => { day.links = day.links.filter((_, i) => !idxs.includes(i)); });
  const toggleConfirm = (d, pid) => mutateDay(d, day => { day.confirmed[pid] = !day.confirmed[pid]; });
  const setDayDone = (d, val) => mutateDay(d, day => { day.done = val; });

  // seed database ops (admin) — admin-added links are dated with the day they
  // are added (the app's current day), mirroring daily links.
  const addSeed = (url) => { if (url.trim()) setState(s => ({ ...s, seedLinks: [...(s.seedLinks || []), { url: url.trim(), date: today }] })); };
  const addSeedBulk = (urls) => setState(s => ({ ...s, seedLinks: [...(s.seedLinks || []), ...urls.map(u => ({ url: u, date: today }))] }));
  const deleteSeed = (url) => setState(s => ({ ...s, seedLinks: (s.seedLinks || []).filter(e => (typeof e === "string" ? e : e.url) !== url) }));

  // promote daily links → seed database (skip ones already there), dated `date`.
  const promoteToDb = (urls, date) => {
    setState(s => {
      const have = dbSet(s.seedLinks);
      const add = [];
      let skipped = 0;
      for (const u of urls) {
        const n = normLink(u);
        if (have.has(n)) { skipped++; continue; }
        have.add(n);
        add.push({ url: u, date });
      }
      if (!add.length) { flash(`All ${urls.length} link${urls.length === 1 ? "" : "s"} already in the database`); return s; }
      flash(`Added ${add.length} new link${add.length === 1 ? "" : "s"} to the database${skipped ? ` · ${skipped} already there` : ""}`);
      return { ...s, seedLinks: [...(s.seedLinks || []), ...add] };
    });
  };

  const goTomorrow = () => setAnchor(a => shiftDays(a, 1));

  // Guarded navigation: if the day has links not yet in the DB, ask first.
  const requestGoTomorrow = () => {
    if (missingFromDb(curDay.links, seedLinks).length > 0) setDbPromptOpen(true);
    else goTomorrow();
  };

  const confirmFinish = (addToDb) => {
    if (addToDb) promoteToDb(curDay.links, anchor);
    setDayDone(anchor, true);
    setFinishOpen(false);
    flash("Day locked — moving to tomorrow");
    goTomorrow();
  };

  const go = (dir) => {
    if (view === "weekly") setAnchor(a => shiftDays(a, dir * 7));
    else setAnchor(a => shiftDays(a, dir));
  };
  const label = view === "weekly" ? weekRangeLabel(anchor) : dayLabel(anchor);

  // Existing-set for the daily bulk modal = DB (dated before this day) + current day's links.
  const dailyExisting = useMemo(() => {
    const set = dbSet(seedLinks, anchor);
    for (const l of getDay(anchor).links) set.add(normLink(l));
    return set;
  }, [seedLinks, anchor, state.jobApply]);

  const curDay = getDay(anchor);
  const locked = !!curDay.done;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Job Apply</h1>
          <p className="page-subtitle">
            Add the day's job links, clear duplicates, then sign off each profile. Links are checked against past days and the seed database.
          </p>
        </div>
        <div className="page-actions">
          <div className="seg">
            {[["daily", "Daily"], ["weekly", "Weekly"], ...(isAdmin ? [["database", "Database"]] : [])].map(([v, lbl]) => (
              <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      {view !== "database" && (
        <div className="cal-toolbar">
          <div className="cal-nav">
            <button className="btn btn-icon" onClick={() => go(-1)} title="Previous">‹</button>
            <button className="btn btn-icon" onClick={() => go(1)} title="Next">›</button>
          </div>
          <span className="cal-month-label">{label}</span>
          <button className="btn" onClick={() => setAnchor(today)}>Today</button>
          {view === "daily" && !locked && (
            <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setBulkOpen(true)}>
              ＋ Bulk add links
            </button>
          )}
        </div>
      )}

      {view === "daily" && (
        <JobApplyDaily state={state} anchor={anchor} day={curDay} seedLinks={seedLinks}
                       isAdmin={isAdmin} locked={locked}
                       onAdd={addLink} onDelete={deleteLink} onDeleteMany={deleteLinks}
                       onToggle={toggleConfirm} onPromote={promoteToDb}
                       onRequestFinish={() => setFinishOpen(true)}
                       onReopen={() => setDayDone(anchor, false)}
                       onGoTomorrow={requestGoTomorrow} onCopy={flash} />
      )}
      {view === "weekly" && (
        <JobApplyWeekly state={state} anchor={anchor} today={today} getDay={getDay} />
      )}
      {view === "database" && isAdmin && (
        <JobApplyDatabase state={state} seedLinks={seedLinks}
                          onAddOne={addSeed} onBulk={addSeedBulk} onDelete={deleteSeed} />
      )}

      {bulkOpen && (
        <BulkAddModal
          title={`Bulk add links — ${formatDate(anchor)}`}
          subtitle="Paste the day's job links, one per line. Duplicates (within the paste, earlier days, or the seed database) are flagged and must be removed."
          existing={dailyExisting}
          onAdd={(urls) => { addLinksBulk(anchor, urls); setBulkOpen(false); }}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {finishOpen && (
        <FinishDayModal date={anchor} day={curDay} profileCount={state.profiles.length}
                        missing={missingFromDb(curDay.links, seedLinks)}
                        onConfirm={confirmFinish} onClose={() => setFinishOpen(false)} />
      )}

      {dbPromptOpen && (
        <DbPromptModal date={anchor} missing={missingFromDb(curDay.links, seedLinks)}
                       onAddContinue={() => { promoteToDb(curDay.links, anchor); setDbPromptOpen(false); goTomorrow(); }}
                       onSkip={() => { setDbPromptOpen(false); goTomorrow(); }}
                       onClose={() => setDbPromptOpen(false)} />
      )}

      {toast && <div className="ja-toast">{toast}</div>}
    </div>
  );
}

// ---------- Daily view ----------
function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text); return true; }
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta); return true;
  } catch (e) { return false; }
}

function JobApplyDaily({ state, anchor, day, seedLinks, isAdmin, locked,
                         onAdd, onDelete, onDeleteMany, onToggle, onPromote,
                         onRequestFinish, onReopen, onGoTomorrow, onCopy }) {
  const [newLink, setNewLink] = useState("");
  const [sel, setSel] = useState(() => new Set());
  const lastClickRef = useRef(null);
  const shiftRef = useRef(false);

  // Capture the shift-key state natively (capture phase fires before React's
  // bubble-phase onClick), so range-select is reliable regardless of how the
  // synthetic event is reconstructed.
  useEffect(() => {
    const cap = (e) => { shiftRef.current = e.shiftKey; };
    document.addEventListener("click", cap, true);
    return () => document.removeEventListener("click", cap, true);
  }, []);

  // reset selection when the day changes
  useEffect(() => { setSel(new Set()); lastClickRef.current = null; }, [anchor, day.links.length]);

  const prior = useMemo(() => dbSet(seedLinks, anchor), [seedLinks, anchor]);
  const statuses = useMemo(() => analyzeLinks(day.links, prior), [day.links, prior]);
  const dupCount = statuses.filter(s => s !== "ok").length;

  const profiles = state.profiles;
  const confirmedCount = profiles.filter(p => day.confirmed[p.id]).length;
  const total = profiles.length;
  const allDone = total > 0 && confirmedCount === total && dupCount === 0;
  const canConfirm = !locked && dupCount === 0 && day.links.length > 0;

  const flagLabel = (s) => s === "prior" ? "Already applied" : "Duplicate";

  // selection helpers
  const selCount = sel.size;
  const allSelected = day.links.length > 0 && selCount === day.links.length;
  const toggleSel = (i) => setSel(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(day.links.map((_, i) => i)));
  // Click handler with shift-range support (works from the whole row).
  const onRowSelect = (shift, i) => {
    const last = lastClickRef.current; // snapshot BEFORE the async updater (and before we overwrite the ref)
    setSel(prev => {
      const n = new Set(prev);
      if (shift && last !== null) {
        const a = Math.min(last, i), b = Math.max(last, i);
        const target = !prev.has(i); // match the clicked item's new state across the range
        for (let k = a; k <= b; k++) { target ? n.add(k) : n.delete(k); }
      } else {
        n.has(i) ? n.delete(i) : n.add(i);
      }
      return n;
    });
    lastClickRef.current = i;
  };
  const selectedUrls = () => [...sel].sort((a, b) => a - b).map(i => day.links[i]);

  const copySel = () => {
    const urls = selectedUrls();
    if (!urls.length) return;
    copyText(urls.join("\n"));
    onCopy && onCopy(`Copied ${urls.length} link${urls.length === 1 ? "" : "s"} to clipboard`);
  };
  const deleteSel = () => { onDeleteMany(anchor, [...sel]); setSel(new Set()); };

  return (
    <div>
      {dupCount > 0 && !locked && (
        <div className="ja-banner warn">
          ⚠️ {dupCount} duplicate {dupCount === 1 ? "link" : "links"} detected — delete {dupCount === 1 ? "it" : "them"} before signing off profiles.
        </div>
      )}
      {allDone && !locked && (
        <div className="ja-banner done">
          <span>🎉 All {total} profiles signed off — {day.links.length} {day.links.length === 1 ? "link" : "links"} applied.</span>
          <button className="btn btn-primary ja-done-actions" onClick={onRequestFinish}>Confirm &amp; finish day →</button>
        </div>
      )}
      {locked && (
        <div className="ja-banner done">
          <span>✓ Day complete — {day.links.length} {day.links.length === 1 ? "link" : "links"} applied across all {total} profiles. This day is locked.</span>
          <span className="ja-done-actions">
            <button className="btn" onClick={onReopen}>Reopen day</button>
            <button className="btn btn-primary" onClick={onGoTomorrow}>Go to tomorrow →</button>
          </span>
        </div>
      )}

      <div className="ja-grid">
        {/* Links */}
        <div className={"ja-card" + (locked ? " ja-locked" : "")}>
          <div className="ja-card-head">
            <span className="ja-card-title">Job links · {day.links.length}</span>
            {!locked && dupCount > 0 && <span className="badge danger">{dupCount} to remove</span>}
            {locked && <span className="badge success">Locked</span>}
          </div>
          <div className="ja-card-body">
            {!locked && (
              <div className="ja-add">
                <input className="input" placeholder="Paste a job link and press Enter…"
                       value={newLink}
                       onChange={e => setNewLink(e.target.value)}
                       onKeyDown={e => { if (e.key === "Enter" && newLink.trim()) { onAdd(anchor, newLink); setNewLink(""); } }} />
                <button className="btn" disabled={!newLink.trim()}
                        onClick={() => { onAdd(anchor, newLink); setNewLink(""); }}>Add</button>
              </div>
            )}

            {day.links.length === 0
              ? <Empty title="No links yet" hint={locked ? "No links were added this day." : "Add a link above or use “Bulk add links”."} />
              : (
                <>
                  <div className="ja-sel-bar">
                    <label className="ja-sel-all">
                      <input type="checkbox" className="ja-check" checked={allSelected} onChange={toggleAll} />
                      Select all
                    </label>
                    {selCount > 0
                      ? <span className="ja-sel-count">{selCount} selected</span>
                      : <span className="ja-sel-count">Click a row to select · Shift-click for a range</span>}
                    <span className="ja-sel-actions">
                      {selCount > 0 && <button className="btn" onClick={copySel}>⧉ Copy</button>}
                      {selCount > 0 && !locked && <button className="btn btn-danger" onClick={deleteSel}>✕ Delete</button>}
                    </span>
                  </div>

                  <div className="ja-links">
                    {day.links.map((url, i) => {
                      const s = statuses[i];
                      const flagged = s !== "ok";
                      const checked = sel.has(i);
                      return (
                        <div key={i}
                             className={"ja-link selectable" + (flagged ? " flag-" + s : "") + (checked ? " selected" : "")}
                             onClick={(e) => { if (e.target.closest("a") || e.target.closest(".ja-del")) return; onRowSelect(shiftRef.current, i); }}>
                          <input type="checkbox" className="ja-check" checked={checked} readOnly />
                          <span className="ja-link-num">{i + 1}</span>
                          <a className="ja-link-url" href={url.startsWith("http") ? url : "https://" + url}
                             target="_blank" rel="noopener noreferrer" title={url}>{url}</a>
                          {flagged && <span className="ja-flag">{flagLabel(s)}</span>}
                          {!locked && (
                            <button className="ja-del" title="Delete link" onClick={() => onDelete(anchor, i)}>✕</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {day.links.length > 1 && (
                    <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 8 }}>
                      Tip: click a row to select, then <strong>Shift</strong>-click another to select the whole range.
                    </div>
                  )}
                </>
              )}
          </div>
        </div>

        {/* Profile sign-off */}
        <div className="ja-card">
          <div className="ja-card-head">
            <span className="ja-card-title">Profile sign-off</span>
            <span className="badge accent">{confirmedCount}/{total}</span>
          </div>
          <div className="ja-card-body">
            <div className="ja-progress-track">
              <div className="ja-progress-fill" style={{ width: (total ? (confirmedCount / total * 100) : 0) + "%" }}></div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
              {confirmedCount} of {total} profiles applied{day.links.length ? ` · ${day.links.length} links each` : ""}
            </div>
            {!locked && !canConfirm && (
              <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 8 }}>
                {day.links.length === 0 ? "Add job links before signing off." : "Resolve duplicate links to enable sign-off."}
              </div>
            )}
            {profiles.map(p => {
              const done = !!day.confirmed[p.id];
              return (
                <div className="ja-profile" key={p.id}>
                  <span className="avatar" data-color={(p.no - 1) % 7}>{initials(p.name)}</span>
                  <span className="ja-profile-name">{p.name}</span>
                  <button className={"ja-confirm-btn" + (done ? " done" : "")}
                          disabled={locked || (!done && !canConfirm)}
                          onClick={() => onToggle(anchor, p.id)}>
                    {done ? "✓ Applied" : "Mark applied"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Weekly view ----------
function JobApplyWeekly({ state, anchor, today, getDay }) {
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const profiles = state.profiles;

  const apps = (iso, pid) => {
    const d = getDay(iso);
    return d.confirmed[pid] ? d.links.length : 0;
  };
  const profileTotal = (pid) => days.reduce((sum, d) => sum + apps(d.iso, pid), 0);
  const dayTotal = (iso) => profiles.reduce((sum, p) => sum + apps(iso, p.id), 0);
  const grand = profiles.reduce((sum, p) => sum + profileTotal(p.id), 0);

  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table className="ja-week">
          <thead>
            <tr>
              <th className="profile-col">Profile</th>
              {days.map(d => (
                <th key={d.iso} className={d.iso === today ? "is-today" : ""}>
                  {d.dow}<br /><span style={{ fontWeight: 400, color: "var(--text-soft)" }}>{d.day}</span>
                </th>
              ))}
              <th className="total-col">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="profile-col" style={{ color: "var(--text-muted)", fontWeight: 600 }}>Links posted</td>
              {days.map(d => {
                const n = getDay(d.iso).links.length;
                return <td key={d.iso} className={d.iso === today ? "is-today" : ""}>
                  <span className={"ja-cell-count" + (n === 0 ? " ja-cell-zero" : "")}>{n}</span>
                </td>;
              })}
              <td className="total-col">{days.reduce((s, d) => s + getDay(d.iso).links.length, 0)}</td>
            </tr>
            {profiles.map(p => (
              <tr key={p.id}>
                <td className="profile-col">
                  <span className="handler">
                    <span className="avatar" data-color={(p.no - 1) % 7}>{initials(p.name)}</span>
                    {p.name}
                  </span>
                </td>
                {days.map(d => {
                  const n = apps(d.iso, p.id);
                  const done = getDay(d.iso).confirmed[p.id];
                  return (
                    <td key={d.iso} className={d.iso === today ? "is-today" : ""}>
                      <span className={"ja-cell-count" + (n === 0 ? " ja-cell-zero" : "")}>{n}</span>
                      {done && <span className="ja-cell-done" title="Signed off"></span>}
                    </td>
                  );
                })}
                <td className="total-col">{profileTotal(p.id)}</td>
              </tr>
            ))}
            <tr className="totals-row">
              <td className="profile-col">Daily total</td>
              {days.map(d => <td key={d.iso} className={d.iso === today ? "is-today" : ""}>{dayTotal(d.iso)}</td>)}
              <td className="total-col">{grand}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Seed database view (admin) ----------
function JobApplyDatabase({ state, seedLinks, onAddOne, onBulk, onDelete }) {
  const [q, setQ] = useState("");
  const [newLink, setNewLink] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  // normalize entries to { url, date }
  const entries = useMemo(
    () => seedLinks.map(e => typeof e === "string" ? { url: e, date: "" } : e),
    [seedLinks]
  );

  const existing = useMemo(() => dbSet(seedLinks), [seedLinks]);
  const newNorm = normLink(newLink);
  const newIsDup = newLink.trim() && existing.has(newNorm);

  const filtered = useMemo(() => {
    const base = [...entries].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (!q.trim()) return base;
    const n = q.toLowerCase();
    return base.filter(e => e.url.toLowerCase().includes(n));
  }, [entries, q]);

  const tryAdd = () => {
    if (!newLink.trim() || newIsDup) return;
    onAddOne(newLink);
    setNewLink("");
  };

  return (
    <div className="ja-card">
      <div className="ja-card-head">
        <span className="ja-card-title">Seed database · {entries.length} links</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="input" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 200 }} />
          <button className="btn btn-primary" onClick={() => setBulkOpen(true)}>＋ Bulk add</button>
        </div>
      </div>
      <div className="ja-card-body">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>
          Reference links with the date each was added. These are <strong>never shown</strong> in the daily list — a day's link is only flagged if a matching entry was added <strong>before</strong> that day.
        </div>

        <div className="ja-add">
          <input className="input" placeholder="Add a single link to the database…"
                 value={newLink}
                 onChange={e => setNewLink(e.target.value)}
                 onKeyDown={e => { if (e.key === "Enter") tryAdd(); }} />
          <button className="btn" disabled={!newLink.trim() || newIsDup} onClick={tryAdd}>Add</button>
        </div>
        {newIsDup && (
          <div style={{ fontSize: 12, color: "var(--danger)", margin: "-6px 0 12px", fontWeight: 600 }}>
            This link is already in the database.
          </div>
        )}

        {entries.length === 0
          ? <Empty title="Empty database" hint="Add links above or use “Bulk add”." />
          : filtered.length === 0
            ? <Empty title="No matches" hint="Try a different search." />
            : (
              <div className="ja-links">
                {filtered.map((e, i) => (
                  <div key={e.url + i} className="ja-link">
                    <span className="ja-db-date">{e.date ? formatDate(e.date) : "—"}</span>
                    <a className="ja-link-url" href={e.url.startsWith("http") ? e.url : "https://" + e.url}
                       target="_blank" rel="noopener noreferrer" title={e.url}>{e.url}</a>
                    <button className="ja-del" title="Remove from database" onClick={() => onDelete(e.url)}>✕</button>
                  </div>
                ))}
              </div>
            )}
      </div>

      {bulkOpen && (
        <BulkAddModal
          title="Bulk add to seed database"
          subtitle="Paste reference links, one per line. Duplicates (within the paste or already in the database) are flagged and must be removed. Added with today's date."
          existing={existing}
          onAdd={(urls) => { onBulk(urls); setBulkOpen(false); }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}

// ---------- Reusable bulk-add modal ----------
function BulkAddModal({ title, subtitle, existing, onAdd, onClose }) {
  const [text, setText] = useState("");
  const lines = useMemo(() => text.split("\n").map(l => l.trim()).filter(Boolean), [text]);
  const statuses = useMemo(() => analyzeLinks(lines, existing), [lines, existing]);
  const flagged = statuses.filter(s => s !== "ok").length;
  const cleanCount = lines.length - flagged;

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={lines.length === 0 || flagged > 0}
                  onClick={() => onAdd(lines)}>
            {flagged > 0 ? `Remove ${flagged} duplicate${flagged === 1 ? "" : "s"} first` : `Add ${lines.length} link${lines.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      {subtitle && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>{subtitle}</div>}
      <div className="form-field full" style={{ marginBottom: 14 }}>
        <label>Job links — one per line</label>
        <textarea rows={6} value={text} onChange={e => setText(e.target.value)}
                  placeholder={"https://linkedin.com/jobs/view/…\nhttps://boards.greenhouse.io/…"}
                  style={{ fontFamily: "var(--mono)", fontSize: 12 }} />
      </div>
      {lines.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
            {cleanCount} new · {flagged > 0
              ? <span style={{ color: "var(--danger)", fontWeight: 600 }}>{flagged} duplicate (remove a line to fix)</span>
              : "no duplicates"}
          </div>
          <div className="ja-links">
            {lines.map((url, i) => {
              const s = statuses[i];
              const flag = s !== "ok";
              return (
                <div key={i} className={"ja-link" + (flag ? " flag-" + s : "")}>
                  <span className="ja-link-num">{i + 1}</span>
                  <span className="ja-link-url" title={url}>{url}</span>
                  {flag && <span className="ja-flag">{s === "prior" ? "Already applied" : "Duplicate"}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Finish-day confirmation ----------
function FinishDayModal({ date, day, profileCount, missing, onConfirm, onClose }) {
  const hasMissing = missing && missing.length > 0;
  const [addToDb, setAddToDb] = useState(true);
  return (
    <Modal
      title="Finish the day?"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Not yet</button>
          <button className="btn btn-primary" onClick={() => onConfirm(hasMissing && addToDb)}>Finish &amp; go to tomorrow →</button>
        </>
      }
    >
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>
        {formatDate(date)}
      </div>
      <div className="ja-finish-summary">
        <div className="ja-finish-stat">
          <span>Job links applied</span>
          <span className="num">{day.links.length}</span>
        </div>
        <div className="ja-finish-stat">
          <span>Profiles signed off</span>
          <span className="num">{profileCount}/{profileCount}</span>
        </div>
      </div>
      {hasMissing && (
        <label className="ja-db-optin" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={addToDb} onChange={e => setAddToDb(e.target.checked)} />
          <span>
            Add <strong>{missing.length}</strong> new link{missing.length === 1 ? "" : "s"} to the seed database
            <span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 12 }}>
              So future days flag them as already applied.
            </span>
          </span>
        </label>
      )}
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        Confirming <strong>locks this day</strong> — you won't be able to add or edit its links afterwards.
        You'll be taken to <strong>tomorrow</strong> to continue applying. You can always reopen a locked day if you need to.
      </div>
    </Modal>
  );
}

// ---------- Go-to-tomorrow DB guard ----------
function DbPromptModal({ date, missing, onAddContinue, onSkip, onClose }) {
  const n = missing.length;
  return (
    <Modal
      title="Add today's links to the database?"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onSkip}>Continue without adding</button>
          <button className="btn btn-primary" onClick={onAddContinue}>Add to database &amp; continue →</button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        <strong>{n}</strong> link{n === 1 ? "" : "s"} from {formatDate(date)} {n === 1 ? "isn't" : "aren't"} in the seed database yet.
        Adding {n === 1 ? "it" : "them"} keeps future days from re-applying to the same posting.
      </div>
      <div className="ja-links" style={{ marginTop: 12, maxHeight: 200 }}>
        {missing.slice(0, 8).map((url, i) => (
          <div key={i} className="ja-link">
            <span className="ja-link-num">{i + 1}</span>
            <span className="ja-link-url" title={url}>{url}</span>
          </div>
        ))}
        {n > 8 && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 2px" }}>+{n - 8} more…</div>}
      </div>
    </Modal>
  );
}

window.JobApplyPage = JobApplyPage;
