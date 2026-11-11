import { normalizeProgress } from '../util/format';

export function ProgressBadge({ progress }: { progress: string | null | undefined }) {
  const norm = normalizeProgress(progress);
  // Solid/filled for Passed/Waiting/Failed so the badge stands out against the
  // soft progress-tinted row (their soft colors were otherwise identical).
  if (norm === 'Passed') return <span className="badge prog passed">{norm}</span>;
  if (norm === 'Failed') return <span className="badge prog failed">{norm}</span>;
  if (norm === 'Waiting') return <span className="badge prog waiting">{norm}</span>;
  return <span className="badge dot">{norm}</span>; // Not started — neutral
}

export function StepPill({ step }: { step: string | null | undefined }) {
  if (!step) return <span className="dash">—</span>;
  return <span className="step-pill">{step}</span>;
}

export function JobStatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status ?? '').toLowerCase();
  const label = s === 'active' ? 'Active'
    : s === 'paused' ? 'Paused'
    : s === 'ended' || s === 'closed' ? 'Closed'
    : (status ?? '—');
  const cls = s === 'active' ? 'success'
    : s === 'paused' ? 'warning'
    : s === 'ended' || s === 'closed' ? 'danger'
    : '';
  return <span className={'badge dot ' + cls}>{label}</span>;
}
