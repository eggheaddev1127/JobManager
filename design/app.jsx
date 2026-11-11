// ============ Root app ============

function App() {
  const [state, setState] = useState(() => loadState());
  const [page, setPage] = useState("interviews");

  // Persist on every change
  useEffect(() => { saveState(state); }, [state]);

  const currentUser = userById(state, state.currentUserId) || state.users[0];
  const isAdmin = currentUser && currentUser.roles.includes("admin");
  const isDev = currentUser && currentUser.roles.includes("dev");
  const hasAccess = currentUser && currentUser.access;

  // Tab visibility:
  //   - admin sees everything (incl. Calendar + Job Apply)
  //   - dev sees Interviews + Calendar + Job Apply
  const tabs = isAdmin
    ? [
        { key: "profiles", label: "Profiles" },
        { key: "jobs", label: "Running Jobs" },
        { key: "interviews", label: "Interviews" },
        { key: "calendar", label: "Calendar" },
        { key: "jobapply", label: "Job Apply" },
        { key: "payments", label: "Payments" },
        { key: "users", label: "Users" },
      ]
    : [
        { key: "interviews", label: "Interviews" },
        { key: "calendar", label: "Calendar" },
        { key: "jobapply", label: "Job Apply" },
      ];

  // Coerce page to one the current user is allowed to see
  useEffect(() => {
    if (!tabs.find(t => t.key === page)) setPage(tabs[0]?.key || "interviews");
  }, [currentUser.id]); // eslint-disable-line

  const setCurrentUser = (id) => setState(s => ({ ...s, currentUserId: id }));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">J</span>
          <span>Job Manager</span>
        </div>

        <nav className="nav">
          {tabs.map(t => (
            <button
              key={t.key}
              className={"nav-item" + (page === t.key ? " active" : "")}
              onClick={() => setPage(t.key)}
            >{t.label}</button>
          ))}
        </nav>

        <div className="user-switch">
          <label>Signed in as</label>
          <select value={state.currentUserId} onChange={e => setCurrentUser(e.target.value)}>
            {state.users.map(u => (
              <option key={u.id} value={u.id} disabled={!u.access}>
                {u.name} ({u.roles.join(" + ") || "no role"}){!u.access ? " — disabled" : ""}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost" title="Reset to seed data"
                  onClick={() => { if (confirm("Reset all data to defaults?")) setState(resetState()); }}>
            ↺
          </button>
        </div>
      </header>

      <main className="page">
        {!hasAccess && (
          <div className="access-denied">
            <h2>Access disabled</h2>
            <p><strong>{currentUser.name}</strong> does not currently have access to the system. Ask an admin to enable access on the Users page.</p>
          </div>
        )}

        {hasAccess && page === "profiles" && isAdmin && (
          <ProfilesPage state={state} setState={setState} />
        )}
        {hasAccess && page === "jobs" && isAdmin && (
          <JobsPage state={state} setState={setState} />
        )}
        {hasAccess && page === "interviews" && (
          <InterviewsPage state={state} setState={setState} currentUser={currentUser} />
        )}
        {hasAccess && page === "calendar" && (
          <CalendarPage state={state} setState={setState} currentUser={currentUser} />
        )}
        {hasAccess && page === "jobapply" && (
          <JobApplyPage state={state} setState={setState} currentUser={currentUser} />
        )}
        {hasAccess && page === "payments" && isAdmin && (
          <PaymentsPage state={state} setState={setState} currentUser={currentUser} />
        )}
        {hasAccess && page === "users" && isAdmin && (
          <UsersPage state={state} setState={setState} />
        )}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
