import { useEffect, useMemo, useState } from 'react';
import { api, HttpError } from '../api';
import type { User } from '../types';
import { isSuperAdmin, useAuth } from '../auth';
import SortableTh from '../components/SortableTh';
import Modal from '../components/Modal';
import { useDialogs } from '../components/Dialog';
import Empty from '../components/Empty';
import { HandlerAvatar } from '../components/HandlerChip';
import ImportExportButtons, { type ImportResult } from '../components/ImportExportButtons';
import ResetPasswordModal from '../components/ResetPasswordModal';
import { sortRows, useSort } from '../util/sort';
import { getCached, setCached } from '../util/dataCache';

const ALL_ROLES = ['superadmin', 'admin', 'dev'] as const;
type Role = (typeof ALL_ROLES)[number];

type SortField = 'name' | 'email' | 'roles' | 'access';

export default function UsersPage() {
  const { user: me, refresh } = useAuth();
  const { confirm, alert } = useDialogs();
  const [users, setUsers] = useState<User[]>(() => getCached<User[]>('users') ?? []);
  const [loading, setLoading] = useState(() => !getCached('users'));
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [roleChange, setRoleChange] = useState<{ user: User; role: Role; willAdd: boolean } | null>(null);
  const [resettingPwUser, setResettingPwUser] = useState<User | null>(null);
  const { sort, onSort } = useSort<SortField>({ field: 'name', dir: 'asc' });

  const load = async () => {
    if (!getCached('users')) setLoading(true);
    try { const u = await api.users.list(); setUsers(u); setCached('users', u); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = useMemo(
    () => sortRows(users, sort, (u, f) => {
      if (f === 'roles') return u.roles.join(',');
      if (f === 'access') return u.active ? 1 : 0;
      return (u as unknown as Record<string, unknown>)[f];
    }),
    [users, sort],
  );

  const toggleAccess = async (u: User, next: boolean) => {
    try { await api.users.update(u.id, { active: next }); await load(); if (u.id === me?.id) await refresh(); }
    catch (e) { await alert({ title: 'Could not update access', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  const requestRoleChange = (u: User, role: Role) => {
    setRoleChange({ user: u, role, willAdd: !u.roles.includes(role) });
  };

  const confirmRoleChange = async () => {
    if (!roleChange) return;
    const { user: u, role, willAdd } = roleChange;
    const nextRoles = willAdd ? [...u.roles, role] : u.roles.filter((r) => r !== role);
    try {
      await api.users.update(u.id, { roles: nextRoles });
      await load();
      if (u.id === me?.id) await refresh();
      setRoleChange(null);
    } catch (e) {
      await alert({ title: 'Could not change role', message: e instanceof HttpError ? e.message : String(e) });
    }
  };

  const onDelete = async (id: number) => {
    if (id === me?.id) { await alert({ title: 'Not allowed', message: 'You cannot delete yourself.' }); return; }
    if (!(await confirm({ title: 'Delete user?', message: 'This permanently removes the user.', confirmLabel: 'Delete' }))) return;
    try { await api.users.remove(id); await load(); }
    catch (e) { await alert({ title: 'Could not delete', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  const handleSaved = () => { setEditing(null); load(); };

  const importUsers = async (incoming: unknown[]): Promise<ImportResult> => {
    let imported = 0, skipped = 0;
    const errors: string[] = [];
    for (const row of incoming) {
      if (!row || typeof row !== 'object') { skipped++; continue; }
      const r = row as Record<string, unknown>;
      if (!r.name || !r.email) { skipped++; continue; }
      if (!r.password) {
        errors.push(`${String(r.email)}: missing "password" field — required for new users`);
        skipped++;
        continue;
      }
      try {
        await api.users.create({
          name: String(r.name),
          email: String(r.email),
          password: String(r.password),
          active: r.active === false ? false : true,
          roles: Array.isArray(r.roles) && r.roles.length ? (r.roles as string[]) : ['dev'],
        });
        imported++;
      } catch (e) {
        errors.push(`${String(r.email)}: ${e instanceof HttpError ? e.message : String(e)}`);
      }
    }
    return { imported, skipped, errors };
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">Team members who can access the system. Admins see all tabs; Devs only see interviews assigned to them.</p>
        </div>
        <div className="page-actions">
          {isSuperAdmin(me) && (
            <ImportExportButtons
              resource="users"
              data={() => users.map(({ ...u }) => u)}
              onImport={importUsers}
              onAfterImport={load}
            />
          )}
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New user</button>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <colgroup>
              <col style={{ width: '12%' }} />                  {/* Name */}
              <col style={{ width: 'calc(48.33% - 20px)' }} /> {/* Email: gives 20px to Access */}
              <col style={{ width: '20%' }} />                  {/* Roles */}
              <col style={{ width: 'calc(6.67% + 20px)' }} />  {/* Access: +20px */}
              <col style={{ width: '13%' }} />                  {/* Actions */}
            </colgroup>
            <thead>
              <tr>
                <SortableTh field="name" sort={sort} onSort={onSort}>Name</SortableTh>
                <SortableTh field="email" sort={sort} onSort={onSort}>Email</SortableTh>
                <SortableTh field="roles" sort={sort} onSort={onSort}>Roles</SortableTh>
                <SortableTh field="access" sort={sort} onSort={onSort}>Access</SortableTh>
                <th style={{ textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5}><Empty title="Loading…" /></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={5}><Empty title="No users yet" /></td></tr>}
              {!loading && rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="handler">
                      <HandlerAvatar name={u.name} users={users} />
                      <span style={{ fontWeight: 600 }}>{u.name}</span>
                      {u.id === me?.id && <span className="badge accent" style={{ marginLeft: 4 }}>you</span>}
                    </span>
                  </td>
                  <td><a href={`mailto:${u.email}`}>{u.email}</a></td>
                  <td>
                    <div className="chip-group">
                      {ALL_ROLES.map((r) => {
                        const selected = u.roles.includes(r);
                        return (
                          <span
                            key={r}
                            className={'chip' + (selected ? ' selected' : '')}
                            onClick={() => requestRoleChange(u, r)}
                          >{r}</span>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <label className="toggle">
                      <input type="checkbox" checked={u.active} onChange={(e) => toggleAccess(u, e.target.checked)} disabled={u.id === me?.id} />
                      <span className="toggle-switch"></span>
                      <span style={{ color: u.active ? 'var(--success)' : 'var(--text-muted)' }}>
                        {u.active ? 'Enabled' : 'Disabled'}
                      </span>
                    </label>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="row-actions">
                      <button className="icon-btn" onClick={() => setResettingPwUser(u)} title="Reset password" aria-label="Reset password">🔑</button>
                      <button className="icon-btn" onClick={() => setEditing(u)} title="Edit user" aria-label="Edit">✎</button>
                      <button className="icon-btn danger" onClick={() => onDelete(u.id)} disabled={u.id === me?.id} title={u.id === me?.id ? 'You cannot delete yourself' : 'Delete user'} aria-label="Delete">🗑</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <UserEditor
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {resettingPwUser && (
        <ResetPasswordModal
          userId={resettingPwUser.id}
          userName={resettingPwUser.name}
          onClose={() => setResettingPwUser(null)}
          onDone={() => setResettingPwUser(null)}
        />
      )}

      {roleChange && (
        <Modal
          title={roleChange.willAdd ? 'Grant role' : 'Remove role'}
          onClose={() => setRoleChange(null)}
          footer={<>
            <button className="btn" onClick={() => setRoleChange(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={confirmRoleChange}>
              {roleChange.willAdd ? `Grant ${roleChange.role}` : `Remove ${roleChange.role}`}
            </button>
          </>}
        >
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            {roleChange.willAdd ? (
              <>Grant the <span className="badge accent">{roleChange.role}</span> role to <strong>{roleChange.user.name}</strong>?</>
            ) : (
              <>Remove the <span className="badge accent">{roleChange.role}</span> role from <strong>{roleChange.user.name}</strong>?</>
            )}
            {roleChange.role === 'admin' && roleChange.willAdd && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
                Admins can see and edit every tab, including users, jobs, and all interviews regardless of handler.
              </div>
            )}
            {roleChange.role === 'admin' && !roleChange.willAdd && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
                Removing admin will restrict {roleChange.user.name} to the Interviews tab, filtered to interviews assigned to them.
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

type Draft = {
  name: string;
  email: string;
  password: string;
  active: boolean;
  roles: Role[];
};

function UserEditor({ existing, onClose, onSaved }: { existing: User | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => ({
    name: existing?.name ?? '',
    email: existing?.email ?? '',
    password: '',
    active: existing?.active ?? true,
    roles: (existing?.roles as Role[]) ?? ['dev'],
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleRole = (r: Role) =>
    setDraft((d) => ({ ...d, roles: d.roles.includes(r) ? d.roles.filter((x) => x !== r) : [...d.roles, r] }));

  const save = async () => {
    if (!draft.name.trim() || !draft.email.trim()) { setError('Name and email are required'); return; }
    if (draft.roles.length === 0) { setError('Pick at least one role'); return; }
    if (!existing && !draft.password) { setError('Password is required for new users'); return; }
    setError(null);
    setBusy(true);
    try {
      if (existing) {
        const payload: Partial<Draft> = {
          name: draft.name, email: draft.email, active: draft.active, roles: draft.roles,
        };
        if (draft.password) payload.password = draft.password;
        await api.users.update(existing.id, payload as Parameters<typeof api.users.update>[1]);
      } else {
        await api.users.create({
          name: draft.name, email: draft.email, password: draft.password,
          active: draft.active, roles: draft.roles,
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Edit user' : 'New user'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save user'}</button>
      </>}
    >
      <div className="form-grid">
        <div className="form-field">
          <label>Name *</label>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="form-field">
          <label>Email *</label>
          <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </div>
        <div className="form-field full">
          <label>Password {existing ? '(leave blank to keep current)' : '*'}</label>
          <input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="new-password" />
        </div>
        <div className="form-field full">
          <label>Roles (multi-select)</label>
          <div className="chip-group">
            {ALL_ROLES.map((r) => (
              <span key={r}
                className={'chip' + (draft.roles.includes(r) ? ' selected' : '')}
                onClick={() => toggleRole(r)}>{r}</span>
            ))}
          </div>
        </div>
        <div className="form-field full">
          <label>Access</label>
          <label className="toggle">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            <span className="toggle-switch"></span>
            <span>{draft.active ? 'Has access to system' : 'No access'}</span>
          </label>
        </div>
        {error && <div className="form-field full"><div className="form-error">{error}</div></div>}
      </div>
    </Modal>
  );
}
