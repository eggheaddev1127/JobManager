import { useState } from 'react';
import Modal from './Modal';
import { api, HttpError } from '../api';

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (!current || !next) { setError('Both fields are required'); return; }
    if (next !== confirm) { setError('New passwords do not match'); return; }
    setError(null);
    setBusy(true);
    try {
      await api.auth.changePassword(current, next);
      setDone(true);
      setTimeout(onClose, 900);
    } catch (e) {
      setError(e instanceof HttpError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Change password"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || done}>
          {done ? 'Saved ✓' : busy ? 'Saving…' : 'Change password'}
        </button>
      </>}
    >
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="form-field">
          <label>Current password</label>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
          />
        </div>
        <div className="form-field">
          <label>New password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Confirm new password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  );
}
