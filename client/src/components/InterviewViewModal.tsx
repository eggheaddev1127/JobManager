import { useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Interview, User } from '../types';
import Modal from './Modal';
import HandlerChip from './HandlerChip';
import CopyButton from './CopyButton';
import { ProgressBadge, StepPill } from './StatusBadges';
import { formatDate, formatSlot, normalizeProgress, parseStepDetails, STEPS_WITH_SUB_TYPES, stepIndex } from '../util/format';
import { recurrenceLabel } from '../util/recurrence';

// Read-only interview detail. Shared by the Interviews table and the Calendar so
// both show the exact same fields. `onEdit` and `onDelete` are optional — when
// omitted the corresponding button is hidden.
export default function InterviewViewModal({ interview, users, allInterviews, onClose, onEdit, onDelete, onChanged }: {
  interview: Interview;
  users: User[];
  allInterviews: Interview[];
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onChanged?: () => void; // called after a state change (e.g. toggling "landed offer")
}) {
  const subs = parseStepDetails(interview.step_details);
  const linkedAR = interview.agency_recruiter_id != null
    ? allInterviews.find((iv) => iv.id === interview.agency_recruiter_id)
    : null;
  // Pipeline history: every other interview in the same (profile, company) pipeline.
  // For a Client Screen with a linked Agency Recruiter, ALSO walk that AR's
  // pipeline — those rows ARE the "previous meetings" the candidate had at the
  // agency before the client introduced them.
  const collected: Interview[] = allInterviews
    .filter((iv) => iv.pipeline_key === interview.pipeline_key && iv.id !== interview.id);
  if (interview.step === 'Client Screen' && interview.agency_recruiter_id != null) {
    const ar = allInterviews.find((iv) => iv.id === interview.agency_recruiter_id);
    if (ar?.pipeline_key) {
      for (const iv of allInterviews) {
        if (iv.pipeline_key !== ar.pipeline_key) continue;
        if (iv.id === interview.id) continue;
        if (collected.some((r) => r.id === iv.id)) continue;
        collected.push(iv);
      }
    }
  }
  const historyRows = collected.sort((a, b) => {
    const sa = stepIndex(a.step);
    const sb = stepIndex(b.step);
    if (sa !== sb) return sa - sb;
    return (a.date ?? '').localeCompare(b.date ?? '');
  });
  const titleStep = interview.step ?? '—';

  // Pipeline JD (from Job Apply, matched by profile + company), fetched on demand.
  const [jdOpen, setJdOpen] = useState(false);
  const [jd, setJd] = useState<{ jd_text: string; company_name: string | null } | null>(null);
  const [jdState, setJdState] = useState<'idle' | 'loading' | 'error'>('idle');
  const openJd = async () => {
    setJdOpen(true);
    if (jd || jdState === 'loading') return;
    setJdState('loading');
    try { setJd(await api.interviews.jd(interview.id)); setJdState('idle'); }
    catch { setJdState('error'); }
  };

  // "Landed offer" toggle. A pipeline with a Job step is offered automatically
  // (can't untoggle here); otherwise the checkbox flips the pipeline_offers flag.
  const offerViaJobStep = interview.pipeline_status === 'complete';
  const [offered, setOffered] = useState(interview.pipeline_offered);
  const [offerBusy, setOfferBusy] = useState(false);
  const toggleOffer = async (val: boolean) => {
    if (offerBusy || offerViaJobStep) return;
    setOffered(val);
    setOfferBusy(true);
    try { await api.interviews.setOffer(interview.id, val); onChanged?.(); }
    catch { setOffered(!val); }
    finally { setOfferBusy(false); }
  };

  return (
    <>
    <Modal
      title={`${interview.company_name ?? '—'} · ${titleStep}`}
      onClose={onClose}
      footer={<>
        {onDelete && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={onDelete}>Delete</button>}
        <button className="btn" onClick={onClose}>Close</button>
        {onEdit && <button className="btn btn-primary" onClick={onEdit}>Edit</button>}
      </>}
    >
      <div>
        <ViewRow label="Date" value={formatDate(interview.date)} copy={interview.date} />
        {interview.recurrence && <ViewRow label="Repeat" value={recurrenceLabel(interview.recurrence)} copy={null} />}
        <ViewRow label="Slot (EST)" value={formatSlot(interview.meeting_slot)} copy={interview.meeting_slot} />
        <ViewRow label="Profile" value={interview.profile_name} copy={interview.profile_name} />
        <ViewRow label="Company" value={interview.company_name} copy={interview.company_name} />
        <ViewRow label="Step" value={interview.step} copy={interview.step} />
        {STEPS_WITH_SUB_TYPES.includes(interview.step ?? '') && subs.length > 0 && (
          <ViewRow label={`${interview.step} details`} value={subs.join(', ')} copy={subs.join(', ')} />
        )}
        {interview.step === 'Agency Recruiter' && interview.agency_name && (
          <ViewRow label="Agency" value={interview.agency_name} copy={interview.agency_name} />
        )}
        {interview.step === 'Client Screen' && linkedAR && (
          <ViewRow
            label="Agency Recruiter"
            value={
              `${linkedAR.company_name ?? '—'}` +
              `${linkedAR.agency_name ? ` (${linkedAR.agency_name})` : ''}` +
              ` · ${linkedAR.date ?? 'no date'} · ${normalizeProgress(linkedAR.progress)}`
            }
            copy={linkedAR.agency_name || linkedAR.company_name}
          />
        )}
        <ViewRow label="Progress" value={normalizeProgress(interview.progress)} copy={interview.progress} />
        {interview.last_followed_up_at && (() => {
          const fu = interview.last_followed_up_at;
          const baselineMs = new Date(fu + 'T00:00:00').getTime();
          const days = Math.floor((Date.now() - baselineMs) / (1000 * 60 * 60 * 24));
          const rel = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
          return <ViewRow label="Last followed up" value={`${formatDate(fu)} (${rel})`} copy={fu} />;
        })()}
        <ViewRow
          label="Handler"
          value={interview.handler ? <HandlerChip handlerName={interview.handler} users={users} /> : undefined}
          copy={interview.handler}
        />
        {interview.meeting_type === 'phone' ? (
          <ViewRow label="Meeting" value="📞 Phone call" copy={null} />
        ) : (
          <ViewRow label="Meeting URL" value={interview.meeting_url} copy={interview.meeting_url} link />
        )}
        {/* One row for the job description: a link to the live posting (this
            interview's jd_url, or the one shared across its pipeline) and/or the
            saved JD text we fetched for this pipeline (has_jd). */}
        {(() => {
          const jdLink = (interview.jd_url && interview.jd_url.trim()) || interview.pipeline_jd_url || '';
          return (
            <ViewRow
              label="Job description"
              value={jdLink || interview.has_jd ? (
                <span className="jd-row-actions">
                  {jdLink && (
                    /^https?:\/\//i.test(jdLink)
                      ? <a href={jdLink} target="_blank" rel="noopener noreferrer" className="cell-link">{jdLink}</a>
                      : <span>{jdLink}</span>
                  )}
                  {interview.has_jd && <button className="btn btn-sm" onClick={openJd} title="View the saved job description for this pipeline">📃 View JD</button>}
                </span>
              ) : undefined}
              copy={jdLink || null}
            />
          );
        })()}
        <ViewRow
          label="Resume"
          value={interview.resume_filename
            ? <a className="cell-link" href={api.interviews.resumeUrl(interview.id)}>📄 {interview.resume_filename} ↓</a>
            : interview.ja_resume_id
              ? <a className="cell-link" href={api.interviews.jaResumeUrl(interview.id)} target="_blank" rel="noopener noreferrer">📄 Tailored resume (from Job Apply) ↓</a>
              : undefined}
          copy={null}
        />
        <ViewRow
          label="Landed offer"
          value={
            <label className="offer-check" title={offerViaJobStep ? 'Offered automatically — this pipeline has a Job step' : 'Mark this pipeline as an offer (removes it from Live pipelines and shows it in Offers)'}>
              <input type="checkbox" checked={offered} disabled={offerBusy || offerViaJobStep}
                     onChange={(e) => toggleOffer(e.target.checked)} />
              <span>{offered
                ? (offerViaJobStep ? 'Yes — has a Job step' : 'Yes — in Offers, hidden from Live pipelines')
                : 'Mark this pipeline as offered'}</span>
            </label>
          }
          copy={null}
        />
        <ViewRow label="Recording URL" value={interview.recording_url} copy={interview.recording_url} link />
        <ViewRow label="Notes" value={interview.notes} copy={interview.notes} pre />

        {historyRows.length > 0 && (
          <div className="view-history">
            <div className="view-history-title">Previous meetings ({historyRows.length})</div>
            <div className="view-history-list">
              {historyRows.map((iv) => {
                const sameCompany = iv.pipeline_key === interview.pipeline_key;
                return (
                  <div key={iv.id} className="view-history-item">
                    <span className="hist-date">{formatDate(iv.date)}</span>
                    <StepPill step={iv.step} />
                    <ProgressBadge progress={iv.progress} />
                    {!sameCompany && iv.company_name && <span className="hist-meta">· {iv.company_name}</span>}
                    {iv.handler && <span className="hist-meta">· {iv.handler}</span>}
                    {iv.meeting_slot && <span className="hist-meta">· {formatSlot(iv.meeting_slot)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
    {jdOpen && (
      <Modal wide title={jd?.company_name ? `Job description · ${jd.company_name}` : 'Job description'} onClose={() => setJdOpen(false)}
             footer={<button className="btn" onClick={() => setJdOpen(false)}>Close</button>}>
        {jdState === 'loading' && <p className="dim">Loading…</p>}
        {jdState === 'error' && <p className="dim">No saved job description found for this pipeline.</p>}
        {jd && <pre className="jd-view-text">{jd.jd_text}</pre>}
      </Modal>
    )}
    </>
  );
}

function ViewRow({ label, value, copy, link, pre }: {
  label: string;
  value: ReactNode | null | undefined;
  copy?: string | null;
  link?: boolean;
  pre?: boolean;
}) {
  const isEmpty = value == null || value === '' || (typeof value === 'string' && value.trim() === '');
  return (
    <div className="view-row">
      <div className="view-label">{label}</div>
      <div className={'view-value' + (pre ? ' pre' : '') + (isEmpty ? ' dim' : '')}>
        {isEmpty
          ? '—'
          : link && typeof value === 'string' && value.startsWith('http')
            ? <a href={value} target="_blank" rel="noopener noreferrer" className="cell-link">{value}</a>
            : value}
      </div>
      {!isEmpty && copy && <CopyButton value={copy} label={label} />}
    </div>
  );
}
