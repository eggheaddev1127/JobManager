import { useEffect, useState } from 'react';
import { api, HttpError } from '../api';
import type { Interview, Profile, Recurrence, User } from '../types';
import Modal from './Modal';
import SlotInput from './SlotInput';
import { joinStepDetails, normalizeProgress, parseStepDetails, STEPS, STEPS_WITH_SUB_TYPES, TECH_SUB_TYPES } from '../util/format';
import { RECURRENCE_OPTIONS } from '../util/recurrence';

const MAX_RESUME_BYTES = 8 * 1024 * 1024; // keep in sync with the server
const RESUME_ACCEPT = '.pdf,.doc,.docx,.rtf,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/plain';

// Browsers sometimes leave File.type empty (notably for .doc/.docx); fall back
// to the extension so the upload's mime passes the server's allow-list.
function resumeMime(file: File): string {
  if (file.type) return file.type;
  switch (file.name.toLowerCase().split('.').pop()) {
    case 'pdf': return 'application/pdf';
    case 'doc': return 'application/msword';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'rtf': return 'application/rtf';
    case 'txt': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

// Mirror of the server's resume grouping (computeResumeGroups): pipelines are
// the same resume group when a Client Screen links (agency_recruiter_id) to an
// Agency Recruiter interview. Returns pipeline_key -> canonical group key.
type GroupLike = { id: number; profile_name: string | null; company_name: string | null; agency_recruiter_id: number | null };
function computePipelineCanon(rows: GroupLike[]): Map<string, string> {
  const parent = new Map<string, string>();
  // Case-insensitive to match the server's pipeline_key (so grouping/lookups line up).
  const keyOf = (r: GroupLike) => `${(r.profile_name ?? '').trim().toLowerCase()}::${(r.company_name ?? '').trim().toLowerCase()}`;
  const add = (k: string) => { if (!parent.has(k)) parent.set(k, k); };
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== x) { const next = parent.get(x)!; parent.set(x, root); x = next; }
    return root;
  };
  const union = (a: string, b: string) => {
    add(a); add(b);
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb);
  };
  const byId = new Map<number, GroupLike>();
  for (const r of rows) { byId.set(r.id, r); add(keyOf(r)); }
  for (const r of rows) {
    if (r.agency_recruiter_id != null) {
      const ar = byId.get(Number(r.agency_recruiter_id));
      if (ar) union(keyOf(r), keyOf(ar));
    }
  }
  const canon = new Map<string, string>();
  for (const k of parent.keys()) canon.set(k, find(k));
  return canon;
}

// Read a File into a base64 string (no data: prefix) for JSON upload.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('failed to read file'));
    reader.readAsDataURL(file);
  });
}

type Draft = {
  date: string;
  meeting_slot: string;
  profile_name: string;
  company_name: string;
  step: string;
  step_details: string;
  agency_recruiter_id: number | null;
  agency_name: string;
  progress: 'Waiting' | 'Passed' | 'Failed' | 'Not started';
  handler: string;
  meeting_type: 'video' | 'phone';
  meeting_url: string;
  jd_url: string;
  recording_url: string;
  notes: string;
  recurrence: '' | Recurrence;
};

// Create/edit an interview. When `devOnly` is true the user may only change the
// notes and recording URL; every other field is locked. Shared by the
// Interviews table and the Calendar.
export default function InterviewEditor({ existing, prefill, profiles, users, currentUser, devOnly, allInterviews, onClose, onSaved }: {
  existing: Interview | null;
  // Pre-fill values for a NEW interview (e.g. date + slot from a calendar drag).
  // Ignored when editing an existing interview.
  prefill?: { date?: string; meeting_slot?: string };
  profiles: Profile[];
  users: User[];
  currentUser: User;
  devOnly: boolean;
  allInterviews: Interview[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<Draft>(() => ({
    date: existing?.date ?? prefill?.date ?? today,
    meeting_slot: existing?.meeting_slot ?? prefill?.meeting_slot ?? '',
    profile_name: existing?.profile_name ?? (profiles[0]?.name ?? ''),
    company_name: existing?.company_name ?? '',
    step: existing?.step ?? STEPS[0],
    step_details: existing?.step_details ?? '',
    agency_recruiter_id: existing?.agency_recruiter_id ?? null,
    agency_name: existing?.agency_name ?? '',
    progress: (normalizeProgress(existing?.progress) as Draft['progress']) ?? 'Waiting',
    // Handlers are devs. Default a NEW interview to the current user only if
    // they're a dev; otherwise (e.g. a non-dev admin) default to the first dev,
    // so the saved handler always matches the dropdown selection.
    handler: existing?.handler ?? (
      users.some((u) => u.active && u.roles.includes('dev') && u.name === currentUser.name)
        ? currentUser.name
        : (users.find((u) => u.active && u.roles.includes('dev'))?.name ?? currentUser.name)
    ),
    meeting_type: (existing?.meeting_type === 'phone' ? 'phone' : 'video') as Draft['meeting_type'],
    meeting_url: existing?.meeting_url ?? '',
    jd_url: existing?.jd_url ?? '',
    recording_url: existing?.recording_url ?? '',
    notes: existing?.notes ?? '',
    recurrence: existing?.recurrence ?? '',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Resume management (admin only). `resumeFile` is a newly chosen upload;
  // `removeResume` flags deletion of the existing one on save.
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [removeResume, setRemoveResume] = useState(false);
  // Existing company names for the autocomplete dropdown (avoids typos / case
  // mismatches that would split a pipeline).
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    api.interviews.companies().then((r) => { if (alive) setCompanyOptions(r.companies); }).catch(() => { /* non-fatal */ });
    return () => { alive = false; };
  }, []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const onPickResume = (file: File | null) => {
    if (!file) { setResumeFile(null); return; }
    if (file.size > MAX_RESUME_BYTES) { setError('Resume is too large (max 8MB)'); return; }
    setError(null);
    setResumeFile(file);
    setRemoveResume(false);
  };

  const save = async () => {
    if (!draft.company_name.trim()) { setError('Company is required'); return; }
    // Validate the meeting slot's start < end. Devs can't change the slot,
    // so only enforce when the admin is the one saving.
    if (!devOnly && draft.meeting_slot) {
      const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(draft.meeting_slot);
      if (m) {
        const startMin = (+m[1]) * 60 + (+m[2]);
        const endMin = (+m[3]) * 60 + (+m[4]);
        if (startMin >= endMin) {
          setError('Start time must be before end time');
          return;
        }
      }
    }
    setError(null);
    setBusy(true);
    try {
      // Send '' recurrence as null (one-off); the server also normalizes this.
      const payload = { ...draft, recurrence: draft.recurrence || null };
      let savedId: number;
      if (existing) { await api.interviews.update(existing.id, payload); savedId = existing.id; }
      else { savedId = (await api.interviews.create(payload)).id; }
      // Resume side-effects — admins only. Upload replaces any existing resume.
      if (canEditAll) {
        if (resumeFile) {
          const data = await fileToBase64(resumeFile);
          await api.interviews.uploadResume(savedId, { filename: resumeFile.name, mime: resumeMime(resumeFile), data });
        } else if (removeResume && pipelineResumeRow) {
          await api.interviews.removeResume(savedId);
        }
      }
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Only dev-role users can handle interviews; admin-only users (e.g. Philip) don't appear.
  const activeUsers = users.filter((u) => u.active && u.roles.includes('dev'));

  const canEditAll = !devOnly;

  // Resume is shared per GROUP — the draft's (profile, company) pipeline plus
  // any pipeline joined to it through this interview's Agency Recruiter link.
  const draftPipeKey = `${draft.profile_name.trim().toLowerCase()}::${draft.company_name.trim().toLowerCase()}`;
  const syntheticId = existing?.id ?? -1;
  const canonMap = computePipelineCanon([
    ...allInterviews.filter((iv) => iv.id !== syntheticId),
    { id: syntheticId, profile_name: draft.profile_name, company_name: draft.company_name, agency_recruiter_id: draft.agency_recruiter_id },
  ]);
  const draftCanon = canonMap.get(draftPipeKey) ?? draftPipeKey;
  const sameCanon = (iv: Interview) => (canonMap.get(iv.pipeline_key) ?? iv.pipeline_key) === draftCanon;
  const pipelineResumeRow = allInterviews.find((iv) => iv.resume_filename && sameCanon(iv)) ?? null;

  // Heads-up: what already exists for the draft's (profile, company) pipeline —
  // JD (link + content) and resume — pulled from earlier interviews AND Job Apply,
  // so it works even for the FIRST interview. Fetched (debounced) as fields change.
  type Preview = { jd_url: string | null; jd_text: string | null; resume_filename: string | null; resume_interview_id: number | null; ja_resume_id: number | null };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [jdViewOpen, setJdViewOpen] = useState(false);
  const prof = draft.profile_name.trim();
  const comp = draft.company_name.trim();
  useEffect(() => {
    if (!prof || !comp) { setPreview(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.interviews.pipelinePreview(prof, comp).then((r) => { if (alive) setPreview(r); }).catch(() => { if (alive) setPreview(null); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [prof, comp]);
  const hasMatch = !!(preview && (preview.jd_url || preview.jd_text || preview.resume_filename || preview.ja_resume_id));

  return (
    <>
    <Modal
      title={existing ? (canEditAll ? 'Edit interview' : 'Edit notes') : 'New interview'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : (canEditAll ? 'Save interview' : 'Save notes')}</button>
      </>}
    >
      <div className="form-grid">
        <div className="form-field">
          <label>Date</label>
          <input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} disabled={!canEditAll} />
        </div>
        <div className="form-field">
          <label>Repeat</label>
          <select value={draft.recurrence} onChange={(e) => set('recurrence', e.target.value as Draft['recurrence'])} disabled={!canEditAll}>
            {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {draft.recurrence && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Repeats on the Calendar from the date above. Editing or deleting affects the whole series.
            </div>
          )}
        </div>
        <div className="form-field">
          <label>Handler</label>
          <select value={draft.handler} onChange={(e) => set('handler', e.target.value)} disabled={devOnly}>
            {/* Show the current handler even if it isn't a dev, so the select can
                never silently display the wrong selection. */}
            {draft.handler && !activeUsers.some((u) => u.name === draft.handler) && (
              <option value={draft.handler}>{draft.handler}</option>
            )}
            {activeUsers.length === 0 && !draft.handler
              ? <option value={currentUser.name}>{currentUser.name}</option>
              : activeUsers.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)
            }
          </select>
        </div>
        <div className="form-field full">
          <label>Meeting slot (EST)</label>
          <SlotInput
            value={draft.meeting_slot}
            onChange={(v) => set('meeting_slot', v)}
            disabled={!canEditAll}
          />
        </div>
        <div className="form-field">
          <label>Profile</label>
          <select value={draft.profile_name} onChange={(e) => set('profile_name', e.target.value)} disabled={!canEditAll}>
            <option value="">— select profile —</option>
            {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Company *</label>
          <input value={draft.company_name} onChange={(e) => set('company_name', e.target.value)} disabled={!canEditAll}
                 list="interview-company-list" autoComplete="off"
                 placeholder="Type or pick an existing company…" />
          <datalist id="interview-company-list">
            {companyOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="form-field">
          <label>Step</label>
          <select
            value={draft.step}
            onChange={(e) => {
              const nextStep = e.target.value;
              // Clear contextual fields when leaving the step that uses them.
              const clearDetails = !STEPS_WITH_SUB_TYPES.includes(nextStep);
              const clearAR = nextStep !== 'Client Screen';
              const clearAgency = nextStep !== 'Agency Recruiter';
              setDraft({
                ...draft,
                step: nextStep,
                step_details: clearDetails ? '' : draft.step_details,
                agency_recruiter_id: clearAR ? null : draft.agency_recruiter_id,
                agency_name: clearAgency ? '' : draft.agency_name,
              });
            }}
            disabled={!canEditAll}
          >
            {STEPS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Progress</label>
          <select value={draft.progress} onChange={(e) => set('progress', e.target.value as Draft['progress'])} disabled={!canEditAll}>
            <option>Waiting</option>
            <option>Passed</option>
            <option>Failed</option>
            <option>Not started</option>
          </select>
        </div>
        {STEPS_WITH_SUB_TYPES.includes(draft.step) && (
          <div className="form-field full">
            <label>{draft.step} details</label>
            <div className="chip-group">
              {TECH_SUB_TYPES.map((t) => {
                const selected = parseStepDetails(draft.step_details).includes(t);
                return (
                  <span
                    key={t}
                    className={'chip' + (selected ? ' selected' : '') + (!canEditAll ? ' disabled' : '')}
                    onClick={() => {
                      if (!canEditAll) return;
                      const cur = parseStepDetails(draft.step_details);
                      const next = selected ? cur.filter((x) => x !== t) : [...cur, t];
                      set('step_details', joinStepDetails(next));
                    }}
                  >
                    {t}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {draft.step === 'Agency Recruiter' && (
          <div className="form-field full">
            <label>Agency name</label>
            <input
              value={draft.agency_name}
              onChange={(e) => set('agency_name', e.target.value)}
              placeholder="e.g. Goodwin Recruiting, Kforce, Robert Half"
              disabled={!canEditAll}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              The agency this recruiter works for. Surfaces in the Client Screen picker so you can identify the right contact.
            </div>
          </div>
        )}
        {draft.step === 'Client Screen' && (() => {
          // De-duplicate by (profile, company) — keep the LATEST by date.
          const allAR = allInterviews.filter((iv) => iv.step === 'Agency Recruiter');
          const latestByKey = new Map<string, Interview>();
          for (const iv of allAR) {
            const key = `${iv.profile_name ?? ''}::${iv.company_name ?? ''}`;
            const existingIv = latestByKey.get(key);
            if (!existingIv || (iv.date ?? '') > (existingIv.date ?? '')) {
              latestByKey.set(key, iv);
            }
          }
          // Always include the currently-selected AR row so the dropdown shows what's linked.
          if (draft.agency_recruiter_id != null) {
            const selected = allAR.find((iv) => iv.id === draft.agency_recruiter_id);
            if (selected) {
              const k = `${selected.profile_name ?? ''}::${selected.company_name ?? ''}`;
              if (latestByKey.get(k)?.id !== selected.id) {
                latestByKey.set(`__selected__${selected.id}`, selected);
              }
            }
          }
          const arOptions = Array.from(latestByKey.values()).sort((a, b) => {
            const aSame = a.profile_name === draft.profile_name ? 0 : 1;
            const bSame = b.profile_name === draft.profile_name ? 0 : 1;
            if (aSame !== bSame) return aSame - bSame;
            return (b.date ?? '').localeCompare(a.date ?? '');
          });
          const sameProfileCount = arOptions.filter((iv) => iv.profile_name === draft.profile_name).length;
          return (
            <div className="form-field full">
              <label>Agency Recruiter contact (optional)</label>
              <select
                value={draft.agency_recruiter_id ?? ''}
                onChange={(e) => set('agency_recruiter_id', e.target.value === '' ? null : Number(e.target.value))}
                disabled={!canEditAll}
              >
                <option value="">— none / direct client contact —</option>
                {arOptions.map((iv) => {
                  const sameProfile = iv.profile_name === draft.profile_name;
                  const agencyLabel = iv.agency_name ? ` (${iv.agency_name})` : '';
                  return (
                    <option key={iv.id} value={iv.id}>
                      {sameProfile ? '★ ' : ''}
                      {iv.profile_name} · {iv.company_name}{agencyLabel} · {iv.date ?? 'no date'} · {normalizeProgress(iv.progress)}
                    </option>
                  );
                })}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Pick the Agency Recruiter row that introduced this candidate to the client.
                A passed link marks this pipeline as live. Same-profile picks are ★ and listed first.
                Duplicate (profile, company) entries are collapsed to the most recent.
                {sameProfileCount === 0 && draft.profile_name && (
                  <> No Agency Recruiter row exists yet for <strong>{draft.profile_name}</strong>.</>
                )}
              </div>
            </div>
          );
        })()}
        <div className="form-field full">
          <label>Meeting type</label>
          <div className="chip-group">
            <span
              className={'chip' + (draft.meeting_type === 'video' ? ' selected' : '') + (!canEditAll ? ' disabled' : '')}
              onClick={() => {
                if (!canEditAll) return;
                set('meeting_type', 'video');
              }}
            >
              🎥 Video call
            </span>
            <span
              className={'chip' + (draft.meeting_type === 'phone' ? ' selected' : '') + (!canEditAll ? ' disabled' : '')}
              onClick={() => {
                if (!canEditAll) return;
                // Switching to phone clears the meeting URL — phone calls don't have one.
                setDraft({ ...draft, meeting_type: 'phone', meeting_url: '' });
              }}
            >
              📞 Phone call
            </span>
          </div>
        </div>
        {draft.meeting_type !== 'phone' && (
          <div className="form-field full">
            <label>Meeting URL</label>
            <input value={draft.meeting_url} onChange={(e) => set('meeting_url', e.target.value)} disabled={!canEditAll} />
          </div>
        )}
        <div className="form-field full">
          <label>JD (URL or notes)</label>
          <textarea
            value={draft.jd_url}
            onChange={(e) => set('jd_url', e.target.value)}
            disabled={!canEditAll}
            rows={3}
            placeholder="Paste a job-description URL — or freeform notes if there's no link."
          />
        </div>
        {hasMatch && preview && (
          <div className="form-field full">
            <label>Already on file <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· for {prof} · {comp}</span></label>
            <div className="pipe-match">
              {(preview.jd_url || preview.jd_text) && (
                <div className="pipe-match-row">
                  <span className="pipe-match-tag">JD</span>
                  {preview.jd_url
                    ? (/^https?:\/\//i.test(preview.jd_url)
                        ? <a className="cell-link" href={preview.jd_url} target="_blank" rel="noopener noreferrer">{preview.jd_url}</a>
                        : <span className="pipe-match-note">{preview.jd_url}</span>)
                    : <span className="pipe-match-note">Saved job description available</span>}
                  {preview.jd_text && <button type="button" className="btn btn-sm" onClick={() => setJdViewOpen(true)} title="View the saved job description for this pipeline">📃 View JD</button>}
                </div>
              )}
              {(preview.resume_filename || preview.ja_resume_id) && (
                <div className="pipe-match-row">
                  <span className="pipe-match-tag">Resume</span>
                  {preview.resume_filename && preview.resume_interview_id
                    ? <a className="cell-link" href={api.interviews.resumeUrl(preview.resume_interview_id)}>📄 {preview.resume_filename}</a>
                    : preview.ja_resume_id
                      // Editing an existing interview → handler-scoped route (works
                      // for devs). New-interview creation is admin-only, so the
                      // admin /api/resumes route is fine as the fallback.
                      ? <a className="cell-link" href={existing?.id ? api.interviews.jaResumeUrl(existing.id) : api.resumes.pdfUrl(preview.ja_resume_id)} target="_blank" rel="noopener noreferrer">📄 Tailored resume (from Job Apply)</a>
                      : null}
                </div>
              )}
            </div>
          </div>
        )}
        {canEditAll && (
          <div className="form-field full">
            <label>Resume <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· shared across this pipeline</span></label>
            {pipelineResumeRow && !removeResume && !resumeFile && (
              <div className="resume-current">
                <a className="cell-link" href={api.interviews.resumeUrl(pipelineResumeRow.id)}>
                  📄 {pipelineResumeRow.resume_filename}
                </a>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setRemoveResume(true)}>Remove</button>
              </div>
            )}
            {removeResume && (
              <div className="resume-current" style={{ color: 'var(--danger)' }}>
                Resume will be removed from this pipeline when you save.
                <button type="button" className="btn btn-sm" onClick={() => setRemoveResume(false)}>Undo</button>
              </div>
            )}
            {resumeFile && (
              <div className="resume-current">
                <span>📄 {resumeFile.name} <span style={{ color: 'var(--text-muted)' }}>({Math.ceil(resumeFile.size / 1024)} KB)</span></span>
                <button type="button" className="btn btn-sm" onClick={() => setResumeFile(null)}>Clear</button>
              </div>
            )}
            <input
              type="file"
              accept={RESUME_ACCEPT}
              onChange={(e) => { onPickResume(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {pipelineResumeRow || resumeFile
                ? 'Choose a file to replace the resume for every interview with this profile + company. '
                : 'Attach a resume — it will be shared by every interview with this profile + company. '}
              PDF, DOC, DOCX, RTF, or TXT — max 8MB.
              {!draft.profile_name.trim() && <> <strong>Pick a profile first.</strong></>}
            </div>
          </div>
        )}
        <div className="form-field full">
          <label>Recording URL</label>
          {/* Devs are allowed to update the recording URL alongside the notes. */}
          <input value={draft.recording_url} onChange={(e) => set('recording_url', e.target.value)} />
        </div>
        <div className="form-field full">
          <label>Notes</label>
          <textarea
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={canEditAll ? 4 : 8}
            autoFocus={!canEditAll}
          />
        </div>
        {!canEditAll && (
          <div className="form-field full">
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              You can update the notes and recording URL. Ask an admin to change other interview details.
            </div>
          </div>
        )}
        {error && <div className="form-field full"><div className="form-error">{error}</div></div>}
      </div>
    </Modal>
    {jdViewOpen && (
      <Modal wide title={`Job description · ${comp}`} onClose={() => setJdViewOpen(false)}
             footer={<button className="btn" onClick={() => setJdViewOpen(false)}>Close</button>}>
        {preview?.jd_text
          ? <pre className="jd-view-text">{preview.jd_text}</pre>
          : <p className="dim">No saved job description found for this pipeline.</p>}
      </Modal>
    )}
    </>
  );
}
