import { useEffect, useMemo, useState } from 'react';
import { api, HttpError } from '../api';
import type { Profile, Category } from '../types';
import SortableTh from '../components/SortableTh';
import Modal from '../components/Modal';
import { useDialogs } from '../components/Dialog';
import Empty from '../components/Empty';
import CopyButton from '../components/CopyButton';
import MasterResumeField from '../components/MasterResumeField';
import CategoryChips from '../components/CategoryChips';
import CategoryManagerModal from '../components/CategoryManagerModal';
import ImportExportButtons, { type ImportResult } from '../components/ImportExportButtons';
import { isAdmin, isSuperAdmin, useAuth } from '../auth';
import TruncatedText from '../components/TruncatedText';
import TruncatedLink from '../components/TruncatedLink';
import { sortRows, useSort } from '../util/sort';
import { getCached, setCached } from '../util/dataCache';

type SortField = 'no' | 'name' | 'gmail' | 'linkedin_url' | 'full_address' | 'gv' | 'github' | 'race' | 'gv2';

export default function ProfilesPage() {
  const { user: me } = useAuth();
  const { confirm, alert } = useDialogs();
  const [profiles, setProfiles] = useState<Profile[]>(() => getCached<Profile[]>('profiles') ?? []);
  const [loading, setLoading] = useState(() => !getCached('profiles'));
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  // Job categories manager (add/rename/delete). Categories route Job-Apply links
  // to profiles; managed here since they're a profile concept.
  const [categories, setCategories] = useState<Category[]>([]);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const reloadCategories = () => api.jobApply.categories.list().then(setCategories).catch(() => { /* non-fatal */ });
  useEffect(() => { reloadCategories(); }, []);
  const { sort, onSort } = useSort<SortField>({ field: 'no', dir: 'asc' });
  const admin = isAdmin(me);
  // Drag-to-swap state: id of the row being dragged (by its No cell) and the
  // row currently hovered as a drop target.
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const load = async () => {
    if (!getCached('profiles')) setLoading(true);
    try { const pr = await api.profiles.list(); setProfiles(pr); setCached('profiles', pr); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    const filtered = profiles.filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return [p.name, p.gmail, p.linkedin_url, p.full_address, p.gv, p.github, p.race, p.gv2]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
    return sortRows(filtered, sort, (p, f) => (p as unknown as Record<string, unknown>)[f]);
  }, [profiles, sort, search]);

  const onDelete = async (id: number) => {
    if (!(await confirm({ title: 'Delete profile?', message: 'This permanently removes the profile.', confirmLabel: 'Delete' }))) return;
    try { await api.profiles.remove(id); await load(); }
    catch (e) { await alert({ title: 'Could not delete', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  // Toggle whether a profile is included in the Job Apply workflow.
  const onToggleApply = async (id: number, next: boolean) => {
    try { await api.profiles.update(id, { apply_enabled: next ? 1 : 0 }); await load(); }
    catch (e) { await alert({ title: 'Could not update', message: e instanceof HttpError ? e.message : String(e) }); }
  };

  // Swap two profiles' positions by exchanging their `no` values. The No column
  // stays a fixed 1..N sequence (each number keeps its place); only which
  // profile sits at each number changes. Optimistic, with revert on failure.
  const swapByNo = async (sourceId: number, targetId: number) => {
    if (sourceId === targetId) return;
    const a = profiles.find((p) => p.id === sourceId);
    const b = profiles.find((p) => p.id === targetId);
    if (!a || !b) return;
    const next = profiles.map((p) =>
      p.id === sourceId ? { ...p, no: b.no } : p.id === targetId ? { ...p, no: a.no } : p,
    );
    setProfiles(next); setCached('profiles', next);
    try {
      await Promise.all([
        api.profiles.update(sourceId, { no: b.no }),
        api.profiles.update(targetId, { no: a.no }),
      ]);
    } catch (e) {
      await load();
      await alert({ title: 'Could not reorder', message: e instanceof HttpError ? e.message : String(e) });
    }
  };

  const handleSaved = () => { setEditing(null); load(); };

  const importProfiles = async (incoming: unknown[]): Promise<ImportResult> => {
    let imported = 0, skipped = 0;
    const errors: string[] = [];
    for (const row of incoming) {
      if (!row || typeof row !== 'object') { skipped++; continue; }
      const r = row as Record<string, unknown>;
      if (!r.name) { skipped++; continue; }
      try {
        const { id: _id, created_at: _ca, updated_at: _ua, ...payload } = r;
        void _id; void _ca; void _ua;
        await api.profiles.create(payload as Partial<Profile>);
        imported++;
      } catch (e) {
        errors.push(`${String(r.name)}: ${e instanceof HttpError ? e.message : String(e)}`);
      }
    }
    return { imported, skipped, errors };
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Profiles</h1>
          <p className="page-subtitle">Candidate identities used across job applications and interviews.</p>
        </div>
        <div className="page-actions">
          <input
            className="input search-input"
            placeholder="Search profiles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {admin && <button className="btn" onClick={() => setCatManagerOpen(true)} title="Manage job categories (AI/ML, Full Stack…)">🏷 Categories</button>}
          {isSuperAdmin(me) && (
            <ImportExportButtons
              resource="profiles"
              data={() => profiles}
              onImport={importProfiles}
              onAfterImport={load}
            />
          )}
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New profile</button>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <colgroup>
              <col style={{ width: 50 }} />   {/* No */}
              <col style={{ width: 145 }} />  {/* Name: 160 → 145 */}
              <col style={{ width: 200 }} />  {/* Gmail: 220 → 200 */}
              <col style={{ width: 200 }} />  {/* LinkedIn URL (fixed so it can't collapse) */}
              <col />                          {/* Full Address: flexible — absorbs the table's slack so all columns fit without horizontal scroll */}
              <col style={{ width: 180 }} />  {/* GV: 160 → 180 (the +20 comes from the flexible LinkedIn column) */}
              <col style={{ width: 140 }} />  {/* Github: now fixed-width */}
              <col style={{ width: 90 }} />   {/* Race */}
              <col style={{ width: 140 }} />  {/* GV PIN: 120 → 140 */}
              <col style={{ width: 96 }} />   {/* Job Apply */}
              <col style={{ width: 80 }} />   {/* Actions */}
            </colgroup>
            <thead>
              <tr>
                <SortableTh field="no" sort={sort} onSort={onSort}>No</SortableTh>
                <SortableTh field="name" sort={sort} onSort={onSort}>Name</SortableTh>
                <SortableTh field="gmail" sort={sort} onSort={onSort}>Gmail</SortableTh>
                <SortableTh field="linkedin_url" sort={sort} onSort={onSort}>LinkedIn URL</SortableTh>
                <SortableTh field="full_address" sort={sort} onSort={onSort}>Full Address</SortableTh>
                <SortableTh field="gv" sort={sort} onSort={onSort}>GV</SortableTh>
                <SortableTh field="github" sort={sort} onSort={onSort}>Github</SortableTh>
                <SortableTh field="race" sort={sort} onSort={onSort}>Race</SortableTh>
                <SortableTh field="gv2" sort={sort} onSort={onSort}>GV PIN</SortableTh>
                <th>Job Apply</th>
                <th style={{ textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={11}><Empty title="Loading…" /></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={11}><Empty title="No profiles" hint="Add your first profile to get started." /></td></tr>}
              {!loading && rows.map((p) => (
                <tr
                  key={p.id}
                  className={overId === p.id ? 'drag-over-row' : dragId === p.id ? 'dragging-row' : ''}
                  onDragOver={admin && dragId != null ? (e) => { if (dragId !== p.id) { e.preventDefault(); setOverId(p.id); } } : undefined}
                  onDragLeave={admin ? () => setOverId((o) => (o === p.id ? null : o)) : undefined}
                  onDrop={admin && dragId != null ? (e) => { e.preventDefault(); swapByNo(dragId, p.id); setDragId(null); setOverId(null); } : undefined}
                >
                  <td
                    className="cell-id"
                    draggable={admin}
                    onDragStart={admin ? (e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(p.id)); } : undefined}
                    onDragEnd={admin ? () => { setDragId(null); setOverId(null); } : undefined}
                    title={admin ? 'Drag onto another row to swap their positions' : undefined}
                  >
                    #{p.no ?? '—'}
                  </td>
                  <td>
                    <span className="copy-cell">
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <CopyButton value={p.name} label="name" />
                    </span>
                  </td>
                  <td>
                    {p.gmail ? (
                      <span className="copy-cell">
                        <a href={`mailto:${p.gmail}`}>{p.gmail}</a>
                        <CopyButton value={p.gmail} label="email" />
                      </span>
                    ) : <span className="dash">—</span>}
                  </td>
                  <td>
                    {p.linkedin_url ? (
                      <span className="copy-cell">
                        <TruncatedLink href={p.linkedin_url} limit={28} title="LinkedIn URL" />
                        <CopyButton value={p.linkedin_url} label="LinkedIn URL" />
                      </span>
                    ) : <span className="dash">—</span>}
                  </td>
                  <td>
                    {p.full_address ? (
                      <span className="copy-cell">
                        <TruncatedText value={p.full_address} limit={28} title="Full address" />
                        <CopyButton value={p.full_address} label="address" />
                      </span>
                    ) : <span className="dash">—</span>}
                  </td>
                  <td>
                    {p.gv ? (
                      <span className="copy-cell">
                        <span className="num">{p.gv}</span>
                        <CopyButton value={p.gv} label="GV" />
                      </span>
                    ) : <span className="dash">—</span>}
                  </td>
                  <td>
                    {p.github ? (
                      <span className="copy-cell">
                        <TruncatedLink href={p.github} limit={22} title="GitHub URL" />
                        <CopyButton value={p.github} label="GitHub" />
                      </span>
                    ) : <span className="dash">—</span>}
                  </td>
                  <td>{p.race ? <span className="badge">{p.race}</span> : <span className="dash">—</span>}</td>
                  <td>
                    {p.gv2 ? (
                      <span className="copy-cell">
                        <span className="num">{p.gv2}</span>
                        <CopyButton value={p.gv2} label="GV PIN" />
                      </span>
                    ) : <span className="dash">—</span>}
                  </td>
                  <td>
                    <label className="toggle" title="Include this profile in the Job Apply workflow">
                      <input type="checkbox" checked={p.apply_enabled !== 0} onChange={(e) => onToggleApply(p.id, e.target.checked)} />
                      <span className="toggle-switch"></span>
                    </label>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="row-actions">
                      <button className="icon-btn" onClick={() => setEditing(p)} title="Edit profile" aria-label="Edit">✎</button>
                      <button className="icon-btn danger" onClick={() => onDelete(p.id)} title="Delete profile" aria-label="Delete">🗑</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ProfileEditor
          existing={editing === 'new' ? null : editing}
          nextNo={(profiles.reduce((m, p) => Math.max(m, p.no ?? 0), 0)) + 1}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {catManagerOpen && (
        <CategoryManagerModal categories={categories} onChanged={reloadCategories} onClose={() => setCatManagerOpen(false)} />
      )}
    </div>
  );
}

type Draft = {
  no: number | null;
  name: string;
  gmail: string;
  linkedin_url: string;
  full_address: string;
  gv: string;
  github: string;
  race: string;
  gv2: string;
};

function ProfileEditor({ existing, nextNo, onClose, onSaved }: { existing: Profile | null; nextNo: number; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => ({
    no: existing?.no ?? nextNo,
    name: existing?.name ?? '',
    gmail: existing?.gmail ?? '',
    linkedin_url: existing?.linkedin_url ?? '',
    full_address: existing?.full_address ?? '',
    gv: existing?.gv ?? '',
    github: existing?.github ?? '',
    race: existing?.race ?? '',
    gv2: existing?.gv2 ?? '',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Job categories (AI/ML, Full Stack, …) this profile belongs to.
  const [categories, setCategories] = useState<Category[]>([]);
  const [catIds, setCatIds] = useState<number[]>([]);
  useEffect(() => {
    api.jobApply.categories.list().then(setCategories).catch(() => { /* non-fatal */ });
    if (existing) {
      api.jobApply.profileCategories.all()
        .then((m) => setCatIds(m[existing.id] ?? []))
        .catch(() => { /* non-fatal */ });
    }
  }, [existing]);
  // Single category per profile: selecting one replaces any prior; clicking the
  // active one clears it.
  const toggleCat = (id: number) => setCatIds((cur) => cur.includes(id) ? [] : [id]);

  const save = async () => {
    if (!draft.name.trim()) { setError('Name is required'); return; }
    setError(null);
    setBusy(true);
    try {
      let profileId: number;
      if (existing) { await api.profiles.update(existing.id, draft); profileId = existing.id; }
      else { profileId = (await api.profiles.create(draft)).id; }
      // Persist category assignment (works for new + existing profiles).
      await api.jobApply.profileCategories.set(profileId, catIds).catch(() => { /* non-fatal */ });
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Modal
      title={existing ? 'Edit profile' : 'New profile'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </>}
    >
      <div className="form-grid">
        <div className="form-field">
          <label>No</label>
          <input type="number" value={draft.no ?? ''} onChange={(e) => set('no', e.target.value === '' ? null : Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label>Name *</label>
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Gmail</label>
          <input value={draft.gmail} onChange={(e) => set('gmail', e.target.value)} />
        </div>
        <div className="form-field">
          <label>LinkedIn URL</label>
          <input value={draft.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} />
        </div>
        <div className="form-field full">
          <label>Full Address</label>
          <input value={draft.full_address} onChange={(e) => set('full_address', e.target.value)} />
        </div>
        <div className="form-field">
          <label>GV (Google Voice)</label>
          <input value={draft.gv} onChange={(e) => set('gv', e.target.value)} />
        </div>
        <div className="form-field">
          <label>GV PIN</label>
          <input value={draft.gv2} onChange={(e) => set('gv2', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Github</label>
          <input value={draft.github} onChange={(e) => set('github', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Race</label>
          <input value={draft.race} onChange={(e) => set('race', e.target.value)} />
        </div>
        <div className="form-field full">
          <label>Job category <span className="muted">· which job-apply links this profile gets</span></label>
          <CategoryChips categories={categories} selected={catIds} onToggle={toggleCat} single
                         empty="No categories yet — add them on the Job Apply page (Categories)." />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Pick one category (e.g. Full Stack or AI/ML). This profile receives links in that category, plus any uncategorized links.
          </div>
        </div>
        {existing
          ? <MasterResumeField profileId={existing.id} />
          : (
            <div className="form-field full">
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Save this profile first to upload a master resume for tailored generation.
              </div>
            </div>
          )}
        {error && <div className="form-field full"><div className="form-error">{error}</div></div>}
      </div>
    </Modal>
  );
}
