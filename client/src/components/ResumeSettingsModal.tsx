import { useEffect, useState } from 'react';
import { api, HttpError } from '../api';
import type { ResumeSettings } from '../types';
import Modal from './Modal';
import { useDialogs } from './Dialog';

// Configure the Claude API key (write-only) and the global resume-tailoring
// prompt applied to every generation. Admin-only (mounted from Job Apply).
export default function ResumeSettingsModal({ onClose }: { onClose: () => void }) {
  const { alert } = useDialogs();
  const [settings, setSettings] = useState<ResumeSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.resumes.getSettings().then((s) => { setSettings(s); setPrompt(s.prompt); }).catch(() => { /* non-fatal */ });
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const payload: { api_key?: string; prompt?: string } = { prompt };
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      const s = await api.resumes.saveSettings(payload);
      setSettings(s); setApiKey(''); setPrompt(s.prompt);
      await alert({ title: 'Saved', message: 'Resume settings updated.' });
    } catch (e) {
      await alert({ title: 'Could not save', message: e instanceof HttpError ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Resume settings" onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
    </>}>
      <div className="form-field full">
        <label>Claude API key</label>
        <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
               placeholder={settings?.has_api_key ? `Key on file (${settings.api_key_hint}) — leave blank to keep` : 'sk-ant-…'} />
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
          {settings?.has_api_key
            ? 'A key is configured. Enter a new one to replace it; leave blank to keep the current key.'
            : 'Used to call the Claude API for resume tailoring. Stored server-side and never shown again.'}
          {' '}Get one at <a className="cell-link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.
        </div>
      </div>

      <div className="form-field full" style={{ marginTop: 14 }}>
        <label>Global tailoring prompt <span className="muted">(applied to every resume generation)</span></label>
        <textarea rows={14} value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  style={{ fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.5 }} />
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
          This is the system prompt Claude follows for every resume. The candidate's master resume and each job's
          description are supplied automatically. {settings?.is_default_prompt && <em>Currently using the built-in default.</em>}
        </div>
      </div>
    </Modal>
  );
}
