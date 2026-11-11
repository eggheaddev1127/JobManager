import { useState } from 'react';
import Modal from './Modal';
import { api, HttpError } from '../api';

export default function ResetPasswordModal({ userId, userName, onClose, onDone }: {
  userId: number;
  userName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pw, setPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!pw) { setError('Password required'); return; }
    if (pw !== confirmPw) { setError('Passwords do not match'); return; }
    setError(null);
    setBusy(true);
    try {
      await api.users.update(userId, { password: pw });
      onDone();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Reset password for ${userName}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button>
      </>}
    >
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="form-field">
          <label>New password</label>
          <input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="form-field">
          <label>Confirm new password</label>
          <input type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
        </div>
        {error && <div className="form-error">{error}</div>}
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {userName} will need to use this password the next time they sign in.
        </div>
      </div>
    </Modal>
  );
}
