// ============ Shared UI helpers ============
const { useState, useEffect, useMemo, useRef } = React;

// ---------- Modal ----------
function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Sortable header ----------
function SortHeader({ label, sortKey, sort, setSort, align }) {
  const active = sort.key === sortKey;
  const onClick = () => {
    if (active) setSort({ key: sortKey, dir: sort.dir === "asc" ? "desc" : "asc" });
    else setSort({ key: sortKey, dir: "asc" });
  };
  return (
    <th className={"sortable" + (active ? " sorted" : "")}
        style={align ? { textAlign: align } : undefined}
        onClick={onClick}>
      {label}
      <span className="sort-indicator">
        {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );
}

// Generic sorter
function sortRows(rows, sort, accessor) {
  if (!sort || !sort.key) return rows;
  const arr = [...rows];
  arr.sort((a, b) => {
    const av = accessor(a, sort.key);
    const bv = accessor(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
  });
  if (sort.dir === "desc") arr.reverse();
  return arr;
}

// ---------- Link icons ----------
function LinkIcon({ href, label, title }) {
  if (!href) return <span className="dash">—</span>;
  return (
    <a className="link-icon" href={href} target="_blank" rel="noopener noreferrer" title={title || href}>
      {label}
    </a>
  );
}

// ---------- Handler chip ----------
function HandlerChip({ state, handlerId }) {
  const user = userById(state, handlerId);
  if (!user) return <span className="dash">—</span>;
  return (
    <span className="handler">
      <span className="avatar" data-color={colorForHandler(state, handlerId)}>{initials(user.name)}</span>
      <span>{user.name}</span>
    </span>
  );
}

// ---------- Progress badge ----------
function ProgressBadge({ progress }) {
  const map = {
    Passed:  { cls: "success", icon: "✓" },
    Failed:  { cls: "danger",  icon: "✕" },
    Waiting: { cls: "warning", icon: "⌛" },
  };
  const m = map[progress] || { cls: "", icon: "•" };
  return <span className={"badge dot " + m.cls}>{progress}</span>;
}

// ---------- Step pill ----------
function StepPill({ step }) {
  return <span className="step-pill">{step}</span>;
}

// ---------- Empty state ----------
function Empty({ title, hint }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      <div>{hint}</div>
    </div>
  );
}

// ---------- Multi-select handler filter (admin) ----------
// `hidden` is an array of handler ids that are HIDDEN (default [] = all shown).
function HandlerFilter({ state, handlers, hidden, setHidden }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const shownCount = handlers.filter(h => !hidden.includes(h.id)).length;
  const allShown = handlers.every(h => !hidden.includes(h.id));
  const toggle = (id) => setHidden(h => h.includes(id) ? h.filter(x => x !== id) : [...h, id]);
  const showAll = () => setHidden([]);
  const hideAll = () => setHidden(handlers.map(h => h.id));

  return (
    <div className="hf" ref={ref}>
      <button className={"select hf-trigger" + (allShown ? "" : " active")} onClick={() => setOpen(o => !o)}>
        {allShown ? "All devs" : `${shownCount} of ${handlers.length} devs`}
        <span className="hf-caret">▾</span>
      </button>
      {open && (
        <div className="hf-pop">
          <div className="hf-actions">
            <button className="btn btn-ghost" onClick={showAll}>Show all</button>
            <button className="btn btn-ghost" onClick={hideAll}>Hide all</button>
          </div>
          {handlers.map(h => {
            const shown = !hidden.includes(h.id);
            return (
              <label key={h.id} className="hf-row">
                <input type="checkbox" checked={shown} onChange={() => toggle(h.id)} />
                <span className="avatar" data-color={colorForHandler(state, h.id)}>{initials(h.name)}</span>
                <span className="hf-name">{h.name}</span>
                {h.roles && h.roles.includes("admin") && <span className="badge accent" style={{ fontSize: 9 }}>admin</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

Object.assign(window, {
  Modal, SortHeader, sortRows, LinkIcon, HandlerChip, ProgressBadge, StepPill, Empty, HandlerFilter,
});
