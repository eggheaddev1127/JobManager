import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, HttpError } from '../api';
import type { GeneratedResume, GeneratedResumeDetail } from '../types';
import { useDialogs } from './Dialog';
import Modal from './Modal';

// Resume generation wired directly into the daily job-link list. A small control
// bar picks the profile and generates; each link row shows its own status +
// Review/Failed action; clicking it expands an inline review/regenerate block.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Human labels for the live generation phases shown in the review modal.
const PHASE_LABEL: Record<string, string> = {
  saving: 'Saving…',
  tailoring: 'Tailoring with Claude…',
  compiling: 'Compiling PDF…',
};

// Poll one item until it leaves the 'pending'/'generating' state (background
// generation done) or a safety cap is reached. Returns the final detail. Calls
// onTick after each poll so the UI can reflect live status while it runs.
async function pollUntilDone(id: number, onTick?: (d: GeneratedResumeDetail) => void, maxMs = 180_000): Promise<GeneratedResumeDetail> {
  const start = Date.now();
  let last = await api.resumes.item(id);
  onTick?.(last);
  while ((last.status === 'generating' || last.status === 'pending') && Date.now() - start < maxMs) {
    await sleep(1500);
    last = await api.resumes.item(id);
    onTick?.(last);
  }
  return last;
}

// ---- Shared state hook -------------------------------------------------------
export type ResumeGen = {
  profileId: number | null;
  setProfileId: (id: number) => void;
  byLinkId: Map<number, GeneratedResume>;
  items: GeneratedResume[];
  anyBusy: boolean;      // JD-fetching or building in progress
  generating: boolean;
  doneCount: number;
  errorCount: number;
  needsJdCount: number;  // links still missing a JD (blocks Generate-all)
  fetchingCount: number; // links whose JD is being checked
  readyCount: number;    // links with a JD, awaiting build
  total: number;
  prepare: () => Promise<void>;
  generate: () => Promise<void>;
  reload: () => Promise<void>;
  downloadZip: () => void;
};

export function useResumeGen(date: string, initialProfileId: number | null): ResumeGen {
  const { alert } = useDialogs();
  const [profileId, setProfileIdState] = useState<number | null>(initialProfileId);
  const [items, setItems] = useState<GeneratedResume[]>([]);
  const [generating, setGenerating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { if (profileId == null && initialProfileId != null) setProfileIdState(initialProfileId); }, [initialProfileId, profileId]);

  // The profile a load/poll is currently authoritative for. Any response that
  // comes back for a DIFFERENT (date, profile) than what's selected NOW is stale
  // (e.g. an in-flight poll for the previous profile after you switched) and must
  // be discarded — otherwise it overwrites the correct list with the old one.
  const currentKeyRef = useRef<string>('');
  useEffect(() => { currentKeyRef.current = `${date}::${profileId ?? ''}`; }, [date, profileId]);

  const load = useCallback(async (pid: number) => {
    const key = `${date}::${pid}`;
    try {
      const r = await api.resumes.day(date, pid);
      // Only apply if the selection hasn't changed since this request started.
      if (currentKeyRef.current === key) setItems(r.items);
      return r.items;
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (currentKeyRef.current === key) setItems([]);
      return [];
    }
  }, [date]);

  const reload = useCallback(async () => { if (profileId != null) await load(profileId); }, [profileId, load]);

  // On profile/date change: clear the old list immediately (so you never see the
  // previous profile's resumes), then load the new one.
  useEffect(() => {
    setItems([]);
    if (profileId != null) void load(profileId);
  }, [profileId, date, load]);

  // "Busy" = anything actively working: JD fetch or a build.
  const anyBusy = useMemo(() => items.some((i) => i.status === 'pending' || i.status === 'generating' || i.status === 'fetching'), [items]);

  useEffect(() => {
    if (!generating && !anyBusy) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } return; }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      if (profileId == null) return;
      const next = await load(profileId);
      if (!next.some((i) => i.status === 'pending' || i.status === 'generating' || i.status === 'fetching')) {
        setGenerating(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    }, 2000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [generating, anyBusy, profileId, load]);

  const setProfileId = useCallback((id: number) => setProfileIdState(id), []);

  // Phase 1 — check every link's JD (no building). The poller (anyBusy sees the
  // 'fetching' rows) refreshes the list until the check settles.
  const prepare = useCallback(async () => {
    if (profileId == null) return;
    try {
      await api.resumes.prepare(date, profileId);
      await load(profileId);
    } catch (e) {
      await alert({ title: 'Could not check job descriptions', message: e instanceof HttpError ? e.message : String(e) });
    }
  }, [profileId, date, load, alert]);

  const generate = useCallback(async () => {
    if (profileId == null) return;
    setGenerating(true);
    try {
      const r = await api.resumes.generate(date, profileId);
      await load(profileId);
      if (!r.count) setGenerating(false);
    } catch (e) {
      setGenerating(false);
      await load(profileId); // refresh so needs_jd rows show after a gate reject
      // A 409 means links still need a JD — show the server's clear message.
      const msg = e instanceof HttpError ? e.message : String(e);
      await alert({ title: 'Add job descriptions first', message: msg });
    }
  }, [profileId, date, load, alert]);

  const downloadZip = useCallback(() => {
    if (profileId == null) return;
    window.location.href = api.resumes.zipUrl(date, profileId);
  }, [profileId, date]);

  const byLinkId = useMemo(() => {
    const m = new Map<number, GeneratedResume>();
    for (const it of items) m.set(it.link_id, it);
    return m;
  }, [items]);

  return {
    profileId, setProfileId, byLinkId, items, anyBusy, generating,
    doneCount: items.filter((i) => i.status === 'done').length,
    errorCount: items.filter((i) => i.status === 'error').length,
    needsJdCount: items.filter((i) => i.status === 'needs_jd').length,
    fetchingCount: items.filter((i) => i.status === 'fetching').length,
    readyCount: items.filter((i) => i.status === 'ready').length,
    total: items.length,
    prepare, generate, reload, downloadZip,
  };
}

// ---- Control bar (profile picker + generate + zip + settings) ----------------
export function ResumeControls({ gen, profiles, hasLinks, onOpenSettings }: {
  gen: ResumeGen;
  profiles: { id: number; name: string }[];
  hasLinks: boolean;
  onOpenSettings: () => void;
}) {
  const busy = gen.generating || gen.anyBusy;
  const fetching = gen.fetchingCount > 0;
  const profileName = profiles.find((p) => p.id === gen.profileId)?.name;
  // The generate flow is gated by JDs:
  //  - nothing prepared yet (total 0) → "Check job descriptions" (prepare)
  //  - some links still need a JD → stay on "Check job descriptions" so the user
  //    can re-run the fetch (Generate-all stays gated until every link has a JD)
  //  - all links have a JD → "Generate all"
  const blockedByJd = gen.total > 0 && gen.needsJdCount > 0;
  const canGenerate = gen.total > 0 && gen.needsJdCount === 0;

  const primary = () => {
    if (fetching) return { label: 'Checking JDs…', action: () => {}, disabled: true };
    // Nothing prepared, or some links still need a JD → the action is (re-)check,
    // never "generate". Re-checking re-fetches the links still missing a JD.
    if (gen.total === 0 || blockedByJd) return { label: '✨ Check job descriptions', action: () => void gen.prepare(), disabled: false };
    return { label: gen.doneCount > 0 ? '↻ Generate all' : '✨ Generate all', action: () => void gen.generate(), disabled: false };
  };
  const p = primary();

  return (
    <div className="rg-bar">
      <span className="rg-bar-label">Resumes</span>
      <select className="select rg-profile" value={gen.profileId ?? ''} onChange={(e) => gen.setProfileId(Number(e.target.value))}>
        {profiles.length === 0 && <option value="">No profiles</option>}
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className={'btn btn-primary' + (blockedByJd ? ' rg-blocked' : '')}
              disabled={busy || p.disabled || gen.profileId == null || !hasLinks} onClick={p.action}
              title={!hasLinks ? 'Add job links first'
                : gen.total === 0 ? 'Check each link’s job description first'
                : blockedByJd ? 'Re-check to fetch the missing job descriptions, or add them below — then generate'
                : `Tailor a resume for every link for ${profileName ?? 'this profile'}`}>
        {busy && !fetching ? 'Generating…' : p.label}
      </button>
      {gen.total > 0 && (
        <>
          <span className="rg-bar-stat">
            {gen.doneCount}/{gen.total} done
            {gen.readyCount > 0 && <> · {gen.readyCount} ready</>}
            {gen.errorCount > 0 && <> · <span className="rg-bar-err">{gen.errorCount} failed</span></>}
            {gen.needsJdCount > 0 && <> · <span className="rg-bar-warn">⚠ {gen.needsJdCount} need JD</span></>}
          </span>
          {canGenerate && gen.doneCount > 0 && (
            <button className="btn" disabled={gen.doneCount === 0} onClick={gen.downloadZip} title="Download all as a ZIP">
              Download ZIP ({gen.doneCount})
            </button>
          )}
        </>
      )}
      <button className="btn" onClick={onOpenSettings} title="Claude API key & global tailoring prompt">⚙ Settings</button>
    </div>
  );
}

// ---- Per-link action (Review / Failed / status) ------------------------------
export function ResumeLinkAction({ item, open, disabled, onToggle }: {
  item: GeneratedResume | undefined;
  open: boolean;
  disabled: boolean; // no profile selected yet
  onToggle: () => void;
}) {
  if (disabled) return null;
  if (!item) return <span className="rg-link-idle" title="Not generated yet">—</span>;
  switch (item.status) {
    case 'fetching':
      return (
        <span className="rg-link-busy" title="Checking this link’s job description…">
          <span className="rg-spinner" />Checking JD
        </span>
      );
    case 'ready':
      // JD present, waiting for the gated Generate-all. Openable to review/edit JD.
      return (
        <button className={'btn btn-sm rg-link-btn rg-link-ready' + (open ? ' btn-primary' : '')} onClick={(e) => { e.stopPropagation(); onToggle(); }}
                title="Job description ready — will build on Generate. Click to view/edit.">
          {open ? 'Close' : '✓ JD ready'}
        </button>
      );
    case 'pending':
    case 'generating':
      // Busy states still open the review modal so a stuck/orphaned row (e.g. a
      // server restart mid-run) is never a dead end — you can Regenerate there.
      return (
        <button className={'btn btn-sm rg-link-btn' + (open ? ' btn-primary' : '')} onClick={(e) => { e.stopPropagation(); onToggle(); }}
                title="Generation in progress — click to open and, if it's stuck, regenerate">
          <span className="rg-spinner" />{item.status === 'pending' ? 'Queued' : 'Generating'}
        </button>
      );
    case 'done':
      return (
        <button className={'btn btn-sm rg-link-btn' + (open ? ' btn-primary' : '')} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          {open ? 'Close' : '📄 Review'}
        </button>
      );
    case 'needs_jd':
      return (
        <button className={'btn btn-sm rg-link-btn rg-link-warn' + (open ? ' btn-primary' : '')} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          {open ? 'Close' : '⚠ Add JD'}
        </button>
      );
    case 'error':
    default:
      return (
        <button className={'btn btn-sm rg-link-btn rg-link-fail' + (open ? ' btn-primary' : '')} onClick={(e) => { e.stopPropagation(); onToggle(); }}
                title={item.error ?? 'Generation failed'}>
          {open ? 'Close' : '⚠ Failed — retry'}
        </button>
      );
  }
}

// ---- Review / regenerate modal (JD + custom prompt left, PDF preview right) --
export function ResumeReviewModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { alert } = useDialogs();
  const [detail, setDetail] = useState<GeneratedResumeDetail | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [jdText, setJdText] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdfNonce, setPdfNonce] = useState(0);
  // Live phase shown while a (re)generation is running, so it isn't static.
  const [phase, setPhase] = useState<'' | 'saving' | 'tailoring' | 'compiling'>('');

  const load = useCallback(async () => {
    const d = await api.resumes.item(id);
    setDetail(d);
    setCustomPrompt(d.custom_prompt ?? '');
    setJdText(d.jd_text ?? '');
    setCompany(d.company_name ?? '');
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // Plain save of JD + company (never triggers generation unless it's a first
  // build of a link that had no resume yet — handled server-side).
  const saveJd = async () => {
    const d = await api.resumes.setJd(id, { jd_text: jdText, company_name: company });
    setDetail(d); onChanged();
    return d;
  };
  const regenerate = async () => {
    setBusy(true);
    setPhase('saving');
    try {
      // Persist any JD/company edits first so the generation uses them.
      if (jdText.trim() !== (detail?.jd_text ?? '').trim() || company.trim() !== (detail?.company_name ?? '').trim()) {
        await saveJd();
      }
      // Regeneration runs in the background (a Claude call + LaTeX compile can
      // take well over the request timeout). Kick it off, then poll the item
      // until it leaves the 'generating' state, updating the live phase as we go.
      setPhase('tailoring');
      const startedAt = Date.now();
      await api.resumes.regenerate(id, customPrompt);
      const finalDetail = await pollUntilDone(id, (d) => {
        setDetail(d); // keep status/error fresh
        // Tailoring dominates; the compile is a quick final step. After ~8s of
        // work assume we've moved from the Claude call to the LaTeX compile.
        setPhase(Date.now() - startedAt > 8000 ? 'compiling' : 'tailoring');
      });
      setDetail(finalDetail); setPdfNonce((n) => n + 1); onChanged();
      if (finalDetail.status === 'error') {
        await alert({ title: 'Generation failed', message: finalDetail.error ?? 'Unknown error' });
      }
    } catch (e) {
      await alert({ title: 'Generation failed', message: e instanceof HttpError ? e.message : String(e) });
    } finally { setBusy(false); setPhase(''); }
  };
  const justSaveJd = async () => {
    setBusy(true);
    try { await saveJd(); }
    catch (e) { await alert({ title: 'Could not save JD', message: e instanceof HttpError ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const title = detail ? `${detail.company_name || 'Resume'} — review` : 'Review resume';

  return (
    <Modal title={title} onClose={onClose} wide footer={<button className="btn" onClick={onClose}>Done</button>}>
      {!detail ? <div className="rg-loading">Loading…</div> : (
        <div className="rg-modal">
          {/* Left: job description + custom prompt + regenerate */}
          <div className="rg-modal-left">
            <div className="form-field full" style={{ marginBottom: 10 }}>
              <label>Company name <span className="muted">(ZIP folder)</span></label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Aprexis" />
            </div>
            <div className="form-field full rg-jd-field">
              <label>
                Job description
                <span className="muted"> · {detail.jd_source === 'manual' ? 'manual' : detail.jd_source === 'failed' ? 'not fetched — paste below' : detail.jd_source === 'fetched' ? 'auto-fetched' : 'none'}</span>
              </label>
              <textarea className="rg-jd-text" value={jdText} onChange={(e) => setJdText(e.target.value)}
                        placeholder="Paste the job description here if it couldn't be fetched automatically." />
            </div>

            <div className="rg-custom">
              <label>Custom prompt for this resume <span className="muted">(optional — added on top of your global prompt)</span></label>
              <textarea rows={4} value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder="e.g. Emphasize backend/Go experience; keep it to one page; lead with the fintech role." />
            </div>

            {detail.status === 'error' && detail.error && !busy && (
              <div className="rg-modal-err">⚠ {detail.error}</div>
            )}

            {busy && phase && (
              <div className="rg-progress">
                <span className="rg-spinner" />
                <span>{PHASE_LABEL[phase]}</span>
              </div>
            )}

            <div className="rg-modal-actions">
              <button className="btn" disabled={busy} onClick={justSaveJd}
                      title="Save the company name and JD only — does not regenerate the resume">
                💾 Save (no regenerate)
              </button>
              <button className="btn btn-primary" disabled={busy || !jdText.trim()} onClick={regenerate}
                      title={!jdText.trim() ? 'Add a job description first' : 'Save edits and rebuild the resume'}>
                {busy ? <><span className="rg-spinner" /> {PHASE_LABEL[phase || 'tailoring']}</> : detail.has_resume ? '↻ Regenerate resume' : 'Generate resume'}
              </button>
            </div>
          </div>

          {/* Right: resume PDF preview */}
          <div className="rg-modal-right">
            <div className="rg-modal-right-head">
              <span>Resume preview</span>
              {detail.has_resume && !busy && <a className="cell-link" href={api.resumes.pdfUrl(id) + '?v=' + pdfNonce} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a>}
            </div>
            {busy ? (
              <div className="rg-modal-pdf rg-review-empty rg-generating">
                <span className="rg-spinner rg-spinner-lg" />
                <div className="rg-generating-label">{PHASE_LABEL[phase || 'tailoring']}</div>
                <div className="rg-generating-sub">This can take up to a minute for LaTeX resumes.</div>
              </div>
            ) : detail.has_resume ? (
              <iframe key={pdfNonce} className="rg-modal-pdf" title="Resume preview" src={api.resumes.pdfUrl(id) + '?v=' + pdfNonce} />
            ) : (
              <div className="rg-modal-pdf rg-review-empty">
                {detail.status === 'needs_jd' ? 'Add the job description on the left, then Generate.'
                  : detail.status === 'error' ? <>Generation failed. Fix the issue (e.g. API key in ⚙ Settings) and Regenerate.</>
                  : 'No resume yet — Generate on the left.'}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
