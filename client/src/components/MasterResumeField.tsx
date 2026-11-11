import { useEffect, useState } from 'react';
import { api, HttpError } from '../api';
import type { MasterResumeMeta } from '../types';
import { useDialogs } from './Dialog';

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = '.pdf,.doc,.docx,.rtf,.txt,.tex,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/plain,application/x-tex,text/x-tex';

function mimeOf(file: File): string {
  if (file.type) return file.type;
  switch (file.name.toLowerCase().split('.').pop()) {
    case 'pdf': return 'application/pdf';
    case 'doc': return 'application/msword';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'rtf': return 'application/rtf';
    case 'txt': return 'text/plain';
    case 'tex': case 'latex': return 'application/x-tex';
    default: return 'application/octet-stream';
  }
}
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

// Master-resume upload for a profile. The base CV Claude tailors to each job.
// Shown inside the profile editor (needs a saved profile id).
export default function MasterResumeField({ profileId }: { profileId: number }) {
  const { alert, confirm } = useDialogs();
  const [meta, setMeta] = useState<MasterResumeMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.resumes.masters()
      .then((all) => setMeta(all.find((m) => m.profile_id === profileId) ?? null))
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoaded(true));
  }, [profileId]);

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) { await alert({ title: 'Too large', message: 'Master resume must be under 8MB.' }); return; }
    setBusy(true);
    try {
      const data = await toBase64(file);
      const m = await api.resumes.uploadMaster(profileId, { filename: file.name, mime: mimeOf(file), data });
      setMeta(m);
      if (!m.has_text) {
        await alert({ title: 'Uploaded, but no text found', message: 'The file was saved but no readable text could be extracted (e.g. a scanned/image PDF). Resume tailoring needs text — try a text-based PDF or DOCX.' });
      }
    } catch (e) {
      await alert({ title: 'Upload failed', message: e instanceof HttpError ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Remove master resume?', message: 'Tailored resumes can\'t be generated for this profile without it.', confirmLabel: 'Remove' }))) return;
    setBusy(true);
    try { await api.resumes.removeMaster(profileId); setMeta(null); }
    catch (e) { await alert({ title: 'Could not remove', message: e instanceof HttpError ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="form-field full">
      <label>Master resume <span className="muted">· tailored per job by Claude</span></label>
      {loaded && meta && (
        <div className="resume-current">
          <a className="cell-link" href={api.resumes.masterUrl(profileId)}>📄 {meta.filename}</a>
          {meta.has_text
            ? <span className="badge success" style={{ marginLeft: 6 }}>text ✓</span>
            : <span className="badge danger" style={{ marginLeft: 6 }} title="No readable text — tailoring won't work">no text</span>}
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={remove} style={{ marginLeft: 'auto' }}>Remove</button>
        </div>
      )}
      <input type="file" accept={ACCEPT} disabled={busy}
             onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
        {meta ? 'Choose a file to replace the master resume. ' : 'Upload the candidate\'s base resume/CV. '}
        PDF, DOC, DOCX, RTF, TXT, or <strong>TEX</strong> (LaTeX) — max 8MB.
        A <strong>.tex</strong> with <code>%%PLACEHOLDER%%</code> markers is tailored in-template and compiled to a PDF that matches your exact formatting; other formats produce a clean generic PDF.
      </div>
    </div>
  );
}
