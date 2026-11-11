// ============ Calendar page ============
// Day / Week / Month views of interviews. Scoped to the current user the same
// way the Interviews page is: a dev sees only interviews they handle.

function CalendarPage({ state, setState, currentUser }) {
  const isAdmin = currentUser.roles.includes("admin");
  const isDevOnly = !isAdmin && currentUser.roles.includes("dev");

  const [view, setView] = useState("month"); // 'day' | 'week' | 'month'
  const [anchor, setAnchor] = useState(() => todayISO()); // ISO date
  const [dayModal, setDayModal] = useState(null);
  const [unavailModal, setUnavailModal] = useState(null); // editing/creating a block
  const [handlerHidden, setHandlerHidden] = useState([]); // admin: hidden handler ids
  const [marking, setMarking] = useState(false); // dev: drag-to-block mode

  const visible = useMemo(() => state.interviews.filter(it => {
    if (isDevOnly && it.handlerId !== currentUser.id) return false;
    if (!isDevOnly && handlerHidden.includes(it.handlerId)) return false;
    return true;
  }), [state.interviews, isDevOnly, currentUser.id, handlerHidden]);

  const byDate = useMemo(() => {
    const m = {};
    for (const it of visible) (m[it.date] = m[it.date] || []).push(it);
    for (const k in m) m[k].sort((a, b) => parseSlotMinutes(a.slot) - parseSlotMinutes(b.slot));
    return m;
  }, [visible]);

  // ---- Unavailability ----
  // A dev sees & edits only their own. An admin sees the selected handler's
  // (or everyone's, labelled by name) but cannot edit them.
  const canEditUnavail = isDevOnly;
  const showNames = !isDevOnly; // admin sees whose block it is

  // Marking mode must never survive a switch to a non-dev (or any user change):
  // CalendarPage stays mounted across the demo user-switcher, so reset it.
  useEffect(() => {
    if (!canEditUnavail && marking) setMarking(false);
  }, [canEditUnavail, currentUser.id]); // eslint-disable-line
  const unavailUserIds = useMemo(() => {
    if (isDevOnly) return [currentUser.id];
    return state.users.filter(u => !handlerHidden.includes(u.id)).map(u => u.id);
  }, [isDevOnly, currentUser.id, handlerHidden, state.users]);

  const unavailByDate = useMemo(() => {
    const m = {};
    for (const u of (state.unavail || [])) {
      if (!unavailUserIds.includes(u.userId)) continue;
      (m[u.date] = m[u.date] || []).push(u);
    }
    return m;
  }, [state.unavail, unavailUserIds]);

  const onAddUnavail = (iso, startMin) => {
    setUnavailModal({
      id: genId("ua"), userId: currentUser.id, date: iso,
      start: startMin, end: Math.min(startMin + 60, 24 * 60), note: "", _isNew: true,
    });
  };
  // Drag-to-create: persist immediately so the dev sees the block right away.
  const onCreateUnavail = (iso, start, end) => {
    if (!canEditUnavail) return; // hard guard: only devs can create
    const block = { id: genId("ua"), userId: currentUser.id, date: iso, start, end, note: "" };
    setState(s => ({ ...s, unavail: [...(s.unavail || []), block] }));
  };
  const saveUnavail = (u) => {
    setState(s => {
      const list = s.unavail || [];
      const exists = list.find(x => x.id === u.id);
      const cleaned = { id: u.id, userId: u.userId, date: u.date, start: u.start, end: u.end, note: u.note };
      return { ...s, unavail: exists ? list.map(x => x.id === u.id ? cleaned : x) : [...list, cleaned] };
    });
    setUnavailModal(null);
  };
  const removeUnavail = (id) => {
    setState(s => ({ ...s, unavail: (s.unavail || []).filter(x => x.id !== id) }));
  };

  const today = todayISO();
  const handlers = state.users.filter(u => u.access && u.roles.includes("dev"));
  // Color a calendar event by outcome, splitting "Waiting" into "Scheduled"
  // (not started — today or future) vs "Awaiting feedback" (past, still waiting).
  const eventClass = (it) => {
    if (it.progress === "Passed") return "passed";
    if (it.progress === "Failed") return "failed";
    return dateBucket(it.date) === "past" ? "waiting" : "scheduled";
  };

  // --- Navigation, scoped to current view ---
  const go = (dir) => {
    if (view === "month") setAnchor(a => {
      const mk = shiftMonth(monthKey(a), dir);
      return mk + "-01";
    });
    else if (view === "week") setAnchor(a => shiftDays(a, dir * 7));
    else setAnchor(a => shiftDays(a, dir));
  };

  const label = view === "month" ? monthLabel(monthKey(anchor))
    : view === "week" ? weekRangeLabel(anchor)
    : dayLabel(anchor);

  // Count for the visible range
  const rangeCount = useMemo(() => {
    if (view === "month") return visible.filter(it => monthKey(it.date) === monthKey(anchor)).length;
    if (view === "week") {
      const set = new Set(weekDays(anchor).map(d => d.iso));
      return visible.filter(it => set.has(it.date)).length;
    }
    return (byDate[anchor] || []).length;
  }, [view, visible, anchor, byDate]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-subtitle">
            {isDevOnly
              ? <>Your scheduled interviews, <strong>{currentUser.name}</strong>.</>
              : "All scheduled interviews across the team."}
          </p>
        </div>
        <div className="page-actions">
          <div className="seg">
            {["day", "week", "month"].map(v => (
              <button key={v} className={view === v ? "active" : ""}
                      onClick={() => setView(v)}>
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
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {rangeCount} interview{rangeCount === 1 ? "" : "s"}
        </span>

        {canEditUnavail && (
          <button className={"btn" + (marking ? " btn-primary" : "")}
                  style={{ marginLeft: 4 }}
                  onClick={() => {
                    const next = !marking;
                    setMarking(next);
                    if (next && view === "month") setView("week");
                  }}>
            {marking ? "✓ Done marking" : "＋ Mark unavailability"}
          </button>
        )}

        {!isDevOnly && (
          <div className="filter-group" style={{ marginLeft: 8 }}>
            <label>Handlers</label>
            <HandlerFilter state={state} handlers={handlers} hidden={handlerHidden} setHidden={setHandlerHidden} />
          </div>
        )}

        <span className="cal-legend">
          <span className="cal-legend-item"><span className="cal-dot scheduled"></span>Scheduled</span>
          <span className="cal-legend-item"><span className="cal-dot waiting"></span>Awaiting</span>
          <span className="cal-legend-item"><span className="cal-dot passed"></span>Passed</span>
          <span className="cal-legend-item"><span className="cal-dot failed"></span>Failed</span>
          {view !== "month" && <span className="cal-legend-item"><span className="legend-swatch unavail"></span>Unavailable</span>}
        </span>
      </div>

      {view !== "month" && (
        <div style={{ margin: "0 0 12px", fontSize: 12.5 }}>
          {canEditUnavail
            ? (marking
                ? <span className="tg-hint" style={{ color: "var(--accent-text)", fontWeight: 600 }}>✏️ Marking on — drag down a column to block out time. Click a block to edit or remove it. Press “Done marking” when finished.</span>
                : <span className="tg-hint">🔒 Click “Mark unavailability”, then drag on the calendar to block your time. Admins can see it.</span>)
            : showNames
              ? <span className="tg-hint">🔒 Hatched blocks are dev-marked unavailable time (labelled by person).</span>
              : null}
        </div>
      )}

      {view === "month" && (
        <MonthView state={state} anchor={anchor} byDate={byDate} today={today}
                   eventClass={eventClass} onOpenDay={(iso, items) => setDayModal({ iso, items })} />
      )}
      {view === "week" && (
        <WeekView state={state} anchor={anchor} byDate={byDate} today={today}
                  unavailByDate={unavailByDate} canEdit={canEditUnavail} showNames={showNames}
                  currentUserId={currentUser.id} marking={marking && canEditUnavail} onCreateUnavail={onCreateUnavail}
                  onEditUnavail={setUnavailModal} onRemoveUnavail={removeUnavail}
                  eventClass={eventClass} onOpenDay={(iso, items) => setDayModal({ iso, items })} />
      )}
      {view === "day" && (
        <DayView state={state} anchor={anchor} byDate={byDate} today={today}
                 unavailByDate={unavailByDate} canEdit={canEditUnavail} showNames={showNames}
                 currentUserId={currentUser.id} marking={marking && canEditUnavail} onCreateUnavail={onCreateUnavail}
                 onEditUnavail={setUnavailModal} onRemoveUnavail={removeUnavail}
                 eventClass={eventClass} onOpenItem={(iso, items) => setDayModal({ iso, items })} />
      )}

      {dayModal && (
        <DayModal state={state} iso={dayModal.iso} items={dayModal.items} onClose={() => setDayModal(null)} />
      )}
      {unavailModal && (
        <UnavailModal block={unavailModal} onSave={saveUnavail}
                      onClose={() => setUnavailModal(null)} onDelete={removeUnavail} />
      )}
    </div>
  );
}

// ---------- Month view ----------
function MonthView({ state, anchor, byDate, today, eventClass, onOpenDay }) {
  const weeks = useMemo(() => buildMonthGrid(monthKey(anchor)), [anchor]);
  return (
    <div className="cal">
      <div className="cal-weekdays">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} className="cal-weekday">{d}</div>
        ))}
      </div>
      <div className="cal-grid">
        {weeks.flat().map(cell => {
          const items = byDate[cell.iso] || [];
          const isToday = cell.iso === today;
          const shown = items.slice(0, 3);
          const extra = items.length - shown.length;
          return (
            <div key={cell.iso} className={"cal-cell" + (cell.inMonth ? "" : " out") + (isToday ? " is-today" : "")}>
              <div className="cal-daynum">
                <span></span>
                <span className="cal-daynum-badge">{cell.day}</span>
              </div>
              {shown.map(it => <EventPill key={it.id} state={state} it={it} cls={eventClass(it)}
                                          onClick={() => onOpenDay(cell.iso, items)} />)}
              {extra > 0 && (
                <button className="cal-event-more" onClick={() => onOpenDay(cell.iso, items)}>+{extra} more</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Time-grid helpers ----------
const TG_HOUR_H = 48;       // px per hour
const TG_SCROLL_TO = 7;     // initial scroll position (7am) on mount

function fmtHour(h) {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh} ${h < 12 ? "AM" : "PM"}`;
}

// ---------- Shared time grid (used by Day + Week) — full 24h, scrollable ----------
function TimeGrid({ state, days, byDate, today, eventClass, onOpenItem,
                    unavailByDate, canEdit, showNames, currentUserId,
                    marking, onCreateUnavail, onEditUnavail, onRemoveUnavail }) {
  const scrollRef = useRef(null);
  const startHour = 0, endHour = 24;
  const hours = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);
  const pxPerMin = TG_HOUR_H / 60;
  const gridHeight = 24 * TG_HOUR_H;

  // Scroll to ~7am on mount so the day doesn't open at midnight.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = TG_SCROLL_TO * TG_HOUR_H;
  }, [days.length]);

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = nowMin * pxPerMin;

  // ----- Drag-to-create (marking mode) -----
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const snap = (m) => Math.max(0, Math.min(24 * 60, Math.round(m / 15) * 15));
  const yToMin = (clientY, colTop) => snap((clientY - colTop) / pxPerMin);

  const onColMouseDown = (e, iso) => {
    if (!marking || !canEdit) return; // both must hold to create
    if (e.target.closest(".tg-unavail") || e.target.closest(".tg-event")) return;
    e.preventDefault();
    const colTop = e.currentTarget.getBoundingClientRect().top;
    const a = yToMin(e.clientY, colTop);
    dragRef.current = { iso, colTop, a, b: a };
    setDrag({ iso, a, b: a });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      const d = dragRef.current; if (!d) return;
      d.b = yToMin(e.clientY, d.colTop);
      setDrag({ iso: d.iso, a: d.a, b: d.b });
    };
    const up = () => {
      const d = dragRef.current;
      if (d) {
        let start = Math.min(d.a, d.b), end = Math.max(d.a, d.b);
        if (end - start < 15) end = Math.min(start + 30, 24 * 60); // treat a click as a 30-min block
        if (end > start) onCreateUnavail(d.iso, start, end);
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [!!drag]); // eslint-disable-line

  return (
    <div className="tg">
      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-head">
          <div className="tg-gutter-head">EST</div>
          {days.map(d => (
            <div key={d.iso} className={"tg-dayhead" + (d.iso === today ? " is-today" : "")}>
              <span className="tg-dow">{d.dow}</span>
              <span className="tg-num">{d.day}</span>
            </div>
          ))}
        </div>
        <div className="tg-body">
          <div className="tg-gutter" style={{ height: gridHeight }}>
            {hours.map(h => (
              <div key={h} className="tg-hour" style={{ height: TG_HOUR_H }}>
                {h !== 0 && <span className="tg-hour-label">{fmtHour(h)}</span>}
              </div>
            ))}
          </div>
          <div className="tg-cols">
            {days.map(d => {
              const packed = packDayEvents(byDate[d.iso] || []);
              const blocks = unavailByDate ? (unavailByDate[d.iso] || []) : [];
              const isToday = d.iso === today;
              const showPreview = drag && drag.iso === d.iso;
              return (
                <div key={d.iso}
                     className={"tg-col" + (isToday ? " is-today" : "") + (marking ? " marking" : "")}
                     style={{ height: gridHeight }}
                     onMouseDown={(e) => onColMouseDown(e, d.iso)}>
                  {hours.map(h => <div key={h} className="tg-line" style={{ height: TG_HOUR_H }}></div>)}

                  {blocks.map(b => {
                    const top = b.start * pxPerMin;
                    const height = Math.max((b.end - b.start) * pxPerMin - 2, 16);
                    const tall = height >= 30;
                    const owner = userById(state, b.userId);
                    const mine = b.userId === currentUserId;
                    return (
                      <div key={b.id} className="tg-unavail" style={{ top, height }}
                           title={`Unavailable${owner ? " · " + owner.name : ""} · ${minToLabel(b.start)}–${minToLabel(b.end)}${b.note ? " · " + b.note : ""}`}
                           onMouseDown={(e) => e.stopPropagation()}
                           onClick={(e) => { e.stopPropagation(); if (marking && mine) onEditUnavail({ ...b }); }}>
                        <span className="tg-unavail-title">
                          {showNames && owner ? owner.name : "Unavailable"}
                        </span>
                        {tall && <span className="tg-unavail-sub">{minToLabel(b.start)}–{minToLabel(b.end)}</span>}
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
                    const s = Math.min(drag.a, drag.b), en = Math.max(drag.a, drag.b);
                    const top = s * pxPerMin;
                    const height = Math.max((en - s) * pxPerMin, 4);
                    return <div className="tg-drag-preview" style={{ top, height }}>
                      {en - s >= 30 ? `${minToLabel(s)}–${minToLabel(en)}` : ""}
                    </div>;
                  })()}

                  {isToday && <div className="tg-now" style={{ top: nowTop }}></div>}

                  {packed.map(e => {
                    const top = e.start * pxPerMin;
                    const height = Math.max((e.end - e.start) * pxPerMin - 2, 18);
                    const widthPct = 100 / e.lanes;
                    const leftPct = e.lane * widthPct;
                    const profile = profileById(state, e.it.profileId);
                    const tall = height >= 32;
                    return (
                      <button key={e.it.id}
                              className={"tg-event " + eventClass(e.it)}
                              style={{ top, height, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, zIndex: e.lane + 1 }}
                              title={`${e.it.slot} · ${e.it.company}`}
                              onMouseDown={(ev) => ev.stopPropagation()}
                              onClick={(ev) => { ev.stopPropagation(); onOpenItem(d.iso, byDate[d.iso] || []); }}>
                        <span className="tg-ev-title">{e.it.meetingType === "phone" ? "📞 " : ""}{e.it.company}</span>
                        {tall && <span className="tg-ev-sub">{e.it.slot}</span>}
                        {tall && e.lanes === 1 && <span className="tg-ev-sub">{profile ? profile.name : "—"}</span>}
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

// ---------- Week view ----------
function WeekView({ state, anchor, byDate, today, eventClass, onOpenDay, ...rest }) {
  const days = useMemo(() => weekDays(anchor), [anchor]);
  return <TimeGrid state={state} days={days} byDate={byDate} today={today}
                   eventClass={eventClass} onOpenItem={onOpenDay} {...rest} />;
}

// ---------- Day view ----------
function DayView({ state, anchor, byDate, eventClass, onOpenItem, today, ...rest }) {
  const d = new Date(anchor + "T00:00:00");
  const days = [{ iso: anchor, day: d.getDate(), dow: d.toLocaleDateString("en-US", { weekday: "long" }), inMonth: true }];
  return <TimeGrid state={state} days={days} byDate={byDate} today={today}
                   eventClass={eventClass} onOpenItem={onOpenItem} {...rest} />;
}

// ---------- Shared event pill (month + week) ----------
function EventPill({ state, it, cls, onClick }) {
  const profile = profileById(state, it.profileId);
  return (
    <button className={"cal-event " + cls} onClick={onClick}>
      <span className="cal-event-top">{it.meetingType === "phone" ? "📞 " : ""}{it.company}</span>
      <span className="cal-event-slot">{it.slot} · {profile ? profile.name : "—"}</span>
    </button>
  );
}

function DayModal({ state, iso, items, onClose }) {
  return (
    <Modal title={formatDate(iso)} onClose={onClose}>
      {items.length === 0 && <Empty title="No interviews" hint="Nothing scheduled this day." />}
      {items.map(it => {
        const profile = profileById(state, it.profileId);
        return (
          <div className="detail-card" key={it.id}>
            <div className="detail-card-head">
              <div className="detail-title">{it.company}</div>
              <ProgressBadge progress={it.progress} />
            </div>
            <div className="detail-list">
              <div className="detail-row"><span className="detail-k">Time</span>
                <span className="detail-v num">{it.slot} <span className="muted">EST</span></span></div>
              <div className="detail-row"><span className="detail-k">Profile</span>
                <span className="detail-v">{profile ? profile.name : "—"}</span></div>
              <div className="detail-row"><span className="detail-k">Step</span>
                <span className="detail-v"><StepPill step={it.step} /></span></div>
              <div className="detail-row"><span className="detail-k">Handler</span>
                <span className="detail-v"><HandlerChip state={state} handlerId={it.handlerId} /></span></div>
              <div className="detail-row"><span className="detail-k">Meeting</span>
                <span className="detail-v">
                  {it.meetingType === "phone"
                    ? <span>📞 Phone call{it.phone ? ` · ${it.phone}` : ""}</span>
                    : it.meeting
                      ? <a href={it.meeting} target="_blank" rel="noopener noreferrer">Join video call ↗</a>
                      : <span className="dash">—</span>}
                </span></div>
              {(it.jd || it.recording) && (
                <div className="detail-row"><span className="detail-k">Links</span>
                  <span className="detail-v" style={{ display: "inline-flex", gap: 8 }}>
                    {it.jd && <a href={it.jd} target="_blank" rel="noopener noreferrer">JD ↗</a>}
                    {it.recording && <a href={it.recording} target="_blank" rel="noopener noreferrer">Recording ↗</a>}
                  </span></div>
              )}
              {it.notes && (
                <div className="detail-row"><span className="detail-k">Notes</span>
                  <span className="detail-v muted">{it.notes}</span></div>
              )}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

// ---------- Unavailability editor ----------
function UnavailModal({ block, onSave, onClose, onDelete }) {
  const [b, setB] = useState(block);
  const set = (k, v) => setB(x => ({ ...x, [k]: v }));
  const valid = b.end > b.start;
  return (
    <Modal
      title={block._isNew ? "Mark unavailable" : "Edit unavailable time"}
      onClose={onClose}
      footer={
        <>
          {!block._isNew && (
            <button className="btn btn-danger" style={{ marginRight: "auto" }}
                    onClick={() => { onDelete(b.id); onClose(); }}>Delete</button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => valid && onSave(b)}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field full">
          <label>Date</label>
          <input type="date" value={b.date} onChange={e => set("date", e.target.value)} />
        </div>
        <div className="form-field">
          <label>From</label>
          <input type="time" step="900" value={minToTimeInput(b.start)}
                 onChange={e => set("start", timeInputToMin(e.target.value))} />
        </div>
        <div className="form-field">
          <label>To</label>
          <input type="time" step="900" value={minToTimeInput(b.end)}
                 onChange={e => set("end", timeInputToMin(e.target.value))} />
        </div>
        <div className="form-field full">
          <label>Note <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-soft)" }}>(optional)</span></label>
          <input value={b.note} onChange={e => set("note", e.target.value)} placeholder="e.g. Lunch, appointment…" />
        </div>
        {!valid && (
          <div className="form-field full" style={{ color: "var(--danger)", fontSize: 12 }}>
            End time must be after start time.
          </div>
        )}
      </div>
    </Modal>
  );
}

window.CalendarPage = CalendarPage;