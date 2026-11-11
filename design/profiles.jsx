// ============ Profiles page ============

function ProfilesPage({ state, setState }) {
  const [sort, setSort] = useState({ key: "no", dir: "asc" });
  const [editing, setEditing] = useState(null); // profile object or "new"
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const filtered = state.profiles.filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return [p.name, p.gmail, p.linkedin, p.address, p.gv, p.github, p.race, p.gv2]
        .some(v => String(v || "").toLowerCase().includes(q));
    });
    return sortRows(filtered, sort, (r, k) => r[k]);
  }, [state.profiles, sort, search]);

  const onSave = (profile) => {
    setState(s => {
      const exists = s.profiles.find(p => p.id === profile.id);
      const profiles = exists
        ? s.profiles.map(p => p.id === profile.id ? profile : p)
        : [...s.profiles, profile];
      return { ...s, profiles };
    });
    setEditing(null);
  };

  const onDelete = (id) => {
    if (!confirm("Delete this profile?")) return;
    setState(s => ({ ...s, profiles: s.profiles.filter(p => p.id !== id) }));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Profiles</h1>
          <p className="page-subtitle">Candidate identities used across job applications and interviews.</p>
        </div>
        <div className="page-actions">
          <input className="input search-input" placeholder="Search profiles…"
                 value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setEditing("new")}>+ New profile</button>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <SortHeader label="No" sortKey="no" sort={sort} setSort={setSort} />
                <SortHeader label="Name" sortKey="name" sort={sort} setSort={setSort} />
                <SortHeader label="Gmail" sortKey="gmail" sort={sort} setSort={setSort} />
                <SortHeader label="LinkedIn URL" sortKey="linkedin" sort={sort} setSort={setSort} />
                <SortHeader label="Full Address" sortKey="address" sort={sort} setSort={setSort} />
                <SortHeader label="GV" sortKey="gv" sort={sort} setSort={setSort} />
                <SortHeader label="Github" sortKey="github" sort={sort} setSort={setSort} />
                <SortHeader label="Race" sortKey="race" sort={sort} setSort={setSort} />
                <SortHeader label="GV PIN" sortKey="gv2" sort={sort} setSort={setSort} />
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={10}><Empty title="No profiles" hint="Add your first profile to get started." /></td></tr>
              )}
              {rows.map(p => (
                <tr key={p.id}>
                  <td className="cell-id">#{p.no}</td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td><a href={"mailto:" + p.gmail}>{p.gmail}</a></td>
                  <td><a href={p.linkedin} target="_blank" rel="noopener noreferrer" className="cell-link">{p.linkedin}</a></td>
                  <td className="cell-address">{p.address}</td>
                  <td className="num">{p.gv}</td>
                  <td><a href={"https://" + p.github.replace(/^https?:\/\//, "")} target="_blank" rel="noopener noreferrer" className="cell-link">{p.github}</a></td>
                  <td><span className="badge">{p.race}</span></td>
                  <td className="num">{p.gv2}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-ghost" onClick={() => setEditing(p)}>Edit</button>
                    <button className="btn btn-ghost btn-danger" onClick={() => onDelete(p.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ProfileEditor
          profile={editing === "new"
            ? { id: genId("p"), no: (state.profiles.at(-1)?.no || 0) + 1, name: "", gmail: "", linkedin: "", address: "", gv: "", github: "", race: "", gv2: "" }
            : editing}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ProfileEditor({ profile, onSave, onClose }) {
  const [p, setP] = useState(profile);
  const set = (k, v) => setP(x => ({ ...x, [k]: v }));
  const isNew = !profile.name;
  return (
    <Modal
      title={isNew ? "New profile" : "Edit profile"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(p)}>Save profile</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label>No</label>
          <input type="number" value={p.no} onChange={e => set("no", parseInt(e.target.value) || 0)} />
        </div>
        <div className="form-field">
          <label>Name</label>
          <input value={p.name} onChange={e => set("name", e.target.value)} />
        </div>
        <div className="form-field">
          <label>Gmail</label>
          <input value={p.gmail} onChange={e => set("gmail", e.target.value)} />
        </div>
        <div className="form-field">
          <label>LinkedIn URL</label>
          <input value={p.linkedin} onChange={e => set("linkedin", e.target.value)} />
        </div>
        <div className="form-field full">
          <label>Full Address</label>
          <input value={p.address} onChange={e => set("address", e.target.value)} />
        </div>
        <div className="form-field">
          <label>GV (Google Voice)</label>
          <input value={p.gv} onChange={e => set("gv", e.target.value)} />
        </div>
        <div className="form-field">
          <label>GV PIN</label>
          <input value={p.gv2} onChange={e => set("gv2", e.target.value)} />
        </div>
        <div className="form-field">
          <label>Github</label>
          <input value={p.github} onChange={e => set("github", e.target.value)} />
        </div>
        <div className="form-field">
          <label>Race</label>
          <input value={p.race} onChange={e => set("race", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

window.ProfilesPage = ProfilesPage;
