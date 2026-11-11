// ============ Users page ============

const ALL_ROLES = ["admin", "dev"];

function UsersPage({ state, setState }) {
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [editing, setEditing] = useState(null);

  const rows = useMemo(() => sortRows(state.users, sort, (r, k) => {
    if (k === "roles") return r.roles.join(",");
    return r[k];
  }), [state.users, sort]);

  const setAccess = (id, access) => {
    setState(s => ({ ...s, users: s.users.map(u => u.id === id ? { ...u, access } : u) }));
  };
  const setRoles = (id, roles) => {
    setState(s => ({ ...s, users: s.users.map(u => u.id === id ? { ...u, roles } : u) }));
  };

  const onSave = (user) => {
    setState(s => {
      const exists = s.users.find(u => u.id === user.id);
      const users = exists ? s.users.map(u => u.id === user.id ? user : u) : [...s.users, user];
      return { ...s, users };
    });
    setEditing(null);
  };

  const onDelete = (id) => {
    if (id === state.currentUserId) { alert("You cannot delete the currently signed-in user."); return; }
    if (!confirm("Delete this user?")) return;
    setState(s => ({ ...s, users: s.users.filter(u => u.id !== id) }));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">Team members who can access the system. Admins see all tabs; Devs only see interviews assigned to them.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setEditing("new")}>+ New user</button>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <SortHeader label="Name" sortKey="name" sort={sort} setSort={setSort} />
                <SortHeader label="Email" sortKey="email" sort={sort} setSort={setSort} />
                <SortHeader label="Roles" sortKey="roles" sort={sort} setSort={setSort} />
                <SortHeader label="Access" sortKey="access" sort={sort} setSort={setSort} />
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id}>
                  <td>
                    <span className="handler">
                      <span className="avatar" data-color={colorForHandler(state, u.id)}>{initials(u.name)}</span>
                      <span style={{ fontWeight: 600 }}>{u.name}</span>
                      {u.id === state.currentUserId && <span className="badge accent" style={{ marginLeft: 4 }}>you</span>}
                    </span>
                  </td>
                  <td><a href={"mailto:" + u.email}>{u.email}</a></td>
                  <td>
                    <div className="chip-group">
                      {ALL_ROLES.map(r => {
                        const selected = u.roles.includes(r);
                        return (
                          <span
                            key={r}
                            className={"chip" + (selected ? " selected" : "")}
                            onClick={() => {
                              const next = selected ? u.roles.filter(x => x !== r) : [...u.roles, r];
                              setRoles(u.id, next);
                            }}
                          >{r}</span>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <label className="toggle">
                      <input type="checkbox" checked={u.access} onChange={e => setAccess(u.id, e.target.checked)} />
                      <span className="toggle-switch"></span>
                      <span style={{ color: u.access ? "var(--success)" : "var(--text-muted)" }}>
                        {u.access ? "Enabled" : "Disabled"}
                      </span>
                    </label>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-ghost" onClick={() => setEditing(u)}>Edit</button>
                    <button className="btn btn-ghost btn-danger" onClick={() => onDelete(u.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <UserEditor
          user={editing === "new"
            ? { id: genId("u"), name: "", email: "", access: true, roles: ["dev"] }
            : editing}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function UserEditor({ user, onSave, onClose }) {
  const [u, setU] = useState(user);
  const set = (k, v) => setU(x => ({ ...x, [k]: v }));
  const toggleRole = (r) => set("roles", u.roles.includes(r) ? u.roles.filter(x => x !== r) : [...u.roles, r]);
  return (
    <Modal
      title={user.name ? "Edit user" : "New user"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(u)}>Save user</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label>Name</label>
          <input value={u.name} onChange={e => set("name", e.target.value)} />
        </div>
        <div className="form-field">
          <label>Email</label>
          <input value={u.email} onChange={e => set("email", e.target.value)} />
        </div>
        <div className="form-field full">
          <label>Roles (multi-select)</label>
          <div className="chip-group">
            {ALL_ROLES.map(r => (
              <span key={r}
                    className={"chip" + (u.roles.includes(r) ? " selected" : "")}
                    onClick={() => toggleRole(r)}>{r}</span>
            ))}
          </div>
        </div>
        <div className="form-field full">
          <label>Access</label>
          <label className="toggle">
            <input type="checkbox" checked={u.access} onChange={e => set("access", e.target.checked)} />
            <span className="toggle-switch"></span>
            <span>{u.access ? "Has access to system" : "No access"}</span>
          </label>
        </div>
      </div>
    </Modal>
  );
}

window.UsersPage = UsersPage;
