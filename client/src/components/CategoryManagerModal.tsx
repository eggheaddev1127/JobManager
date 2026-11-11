import { useState } from 'react';
import { api, HttpError } from '../api';
import type { Category } from '../types';
import Modal from './Modal';
import Empty from './Empty';
import { useDialogs } from './Dialog';

// Manage job categories (add / rename / delete). Categories route Job-Apply links
// to matching profiles. Lives on the Profiles page (categories are a profile
// concept). Calls onChanged after any mutation so callers can reload.
export default function CategoryManagerModal({ categories, onChanged, onClose }: {
  categories: Category[];
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { confirm, alert } = useDialogs();
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const fail = (e: unknown) => alert({ title: 'Something went wrong', message: e instanceof HttpError ? e.message : String(e) });

  const add = async () => {
    if (!name.trim()) return;
    try { await api.jobApply.categories.add(name.trim()); setName(''); await onChanged(); } catch (e) { await fail(e); }
  };
  const rename = async (id: number) => {
    if (!editName.trim()) { setEditingId(null); return; }
    try { await api.jobApply.categories.rename(id, editName.trim()); setEditingId(null); await onChanged(); } catch (e) { await fail(e); }
  };
  const remove = async (c: Category) => {
    if (!(await confirm({ title: 'Delete category?', message: `Remove "${c.name}"? It will be unassigned from all links and profiles.`, confirmLabel: 'Delete' }))) return;
    try { await api.jobApply.categories.remove(c.id); await onChanged(); } catch (e) { await fail(e); }
  };

  return (
    <Modal title="Job categories" onClose={onClose} footer={<button className="btn" onClick={onClose}>Done</button>}>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
        Categories (e.g. <strong>AI/ML</strong>, <strong>Full Stack</strong>) route Job-Apply links to matching profiles.
        A link with no category goes to everyone. Assign a category to each profile in its editor.
      </div>
      <div className="ja-add" style={{ marginBottom: 14 }}>
        <input className="input" placeholder="New category name…" value={name}
               onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className="btn btn-primary" disabled={!name.trim()} onClick={add}>Add</button>
      </div>
      {categories.length === 0
        ? <Empty title="No categories yet" hint="Add your first category above." />
        : (
          <div className="ja-links">
            {categories.map((c) => (
              <div key={c.id} className="ja-link" style={{ gap: 8 }}>
                {editingId === c.id ? (
                  <>
                    <input className="input" style={{ flex: 1 }} value={editName} autoFocus
                           onChange={(e) => setEditName(e.target.value)}
                           onKeyDown={(e) => { if (e.key === 'Enter') rename(c.id); if (e.key === 'Escape') setEditingId(null); }} />
                    <button className="btn btn-sm btn-primary" onClick={() => rename(c.id)}>Save</button>
                    <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, fontWeight: 600 }}>{c.name}</span>
                    <button className="btn btn-sm" onClick={() => { setEditingId(c.id); setEditName(c.name); }}>Rename</button>
                    <button className="ja-del" title="Delete category" onClick={() => remove(c)}>✕</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
    </Modal>
  );
}
