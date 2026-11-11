import { Router } from 'express';
import { db } from '../db.js';
import { isAdmin, type AuthedRequest } from '../auth.js';
import { cycleDivisor, projectOccurrences, viewWindow } from '../callerPaySchedule.js';

const router = Router();

// Allowed period spans for the view selector (months).
const PERIODS = new Set([1, 2, 3, 6, 12]);

type JobRow = {
  id: number;
  profile_name: string;
  company_name: string;
  role_title: string | null;
  caller: string | null;
  caller_payout: number;
  pay_first_date: string | null;
  pay_cycle: string | null;
};

// Jobs that generate caller payouts: active, assigned to a caller, non-zero payout.
function payableJobs(): JobRow[] {
  return db.prepare(`
    SELECT id, profile_name, company_name, role_title, caller, caller_payout,
           pay_first_date, pay_cycle
    FROM jobs
    WHERE status = 'active' AND caller IS NOT NULL AND TRIM(caller) <> '' AND caller_payout > 0
    ORDER BY company_name
  `).all() as JobRow[];
}

// Admin: the list of callers who have payable jobs (caller switcher).
router.get('/callers', (req: AuthedRequest, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'forbidden' });
  const seen = new Map<string, string>(); // lowercased → display name
  for (const j of payableJobs()) {
    const name = (j.caller || '').trim();
    if (name) seen.set(name.toLowerCase(), name);
  }
  // Also include callers who only have paid history now (their jobs may have
  // been paused/ended) so admins can still open their records.
  const paidCallers = db.prepare(
    "SELECT DISTINCT caller FROM caller_payout_paid WHERE caller IS NOT NULL AND TRIM(caller) <> ''",
  ).all() as { caller: string }[];
  for (const r of paidCallers) {
    const name = r.caller.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  res.json({ callers: Array.from(seen.values()).sort((a, b) => a.localeCompare(b)) });
});

// Schedule + paid history for one caller over the selected period.
router.get('/', (req: AuthedRequest, res) => {
  const admin = isAdmin(req.user);
  // Non-admins can only ever see their own schedule; admins pick via ?caller=.
  const caller = admin ? String(req.query.caller || '').trim() : (req.user?.name || '').trim();
  const months = PERIODS.has(Number(req.query.months)) ? Number(req.query.months) : 1;

  if (!caller) return res.json({ caller: '', months, schedule: [], history: [] });

  const callerLc = caller.toLowerCase();
  const jobs = payableJobs().filter((j) => (j.caller || '').trim().toLowerCase() === callerLc);
  const jobIds = jobs.map((j) => j.id);

  const { startTs, endTs } = viewWindow(months);

  // Recorded (paid) payouts for this caller's jobs, keyed by job_id + date.
  const paidRows = jobIds.length
    ? (db.prepare(
        `SELECT job_id, pay_date, amount FROM caller_payout_paid WHERE job_id IN (${jobIds.map(() => '?').join(',')})`,
      ).all(...jobIds) as { job_id: number; pay_date: string; amount: number }[])
    : [];
  const paidSet = new Set(paidRows.map((r) => `${r.job_id}|${r.pay_date}`));

  type Item = {
    job_id: number;
    company_name: string;
    profile_name: string;
    role_title: string | null;
    caller: string | null;
    pay_cycle: string | null;
    pay_date: string;
    amount: number;
    paid: boolean;
  };

  const schedule: Item[] = [];
  for (const j of jobs) {
    const divisor = cycleDivisor(j.pay_cycle);
    if (!divisor) continue;
    const amount = Math.round(((j.caller_payout || 0) / divisor) * 100) / 100;
    for (const occ of projectOccurrences(j.pay_first_date, j.pay_cycle, endTs)) {
      if (occ.ts < startTs) continue; // keep the view to the selected window
      schedule.push({
        job_id: j.id,
        company_name: j.company_name,
        profile_name: j.profile_name,
        role_title: j.role_title,
        caller: j.caller,
        pay_cycle: j.pay_cycle,
        pay_date: occ.date,
        amount,
        paid: paidSet.has(`${j.id}|${occ.date}`),
      });
    }
  }
  schedule.sort((a, b) => a.pay_date.localeCompare(b.pay_date) || a.company_name.localeCompare(b.company_name));

  // Paid history is kept independently of job status: a payout already made stays
  // on record even if the job is later paused or ended (its upcoming schedule
  // disappears, but what was already paid remains). Keyed by the caller, not by
  // the active-jobs list.
  const history = db.prepare(`
    SELECT p.job_id, p.pay_date, p.amount, p.paid_at,
           j.company_name, j.profile_name, j.role_title
    FROM caller_payout_paid p
    JOIN jobs j ON j.id = p.job_id
    WHERE LOWER(TRIM(p.caller)) = ?
    ORDER BY p.pay_date DESC, p.paid_at DESC
  `).all(callerLc);

  res.json({ caller, months, schedule, history });
});

// Admin: mark a scheduled payout paid (or un-mark it). Keyed by job + date.
router.post('/mark', (req: AuthedRequest, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'forbidden' });
  const jobId = Number(req.body?.job_id);
  const payDate = String(req.body?.pay_date || '').trim();
  const paid = !!req.body?.paid;
  if (!jobId || !/^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
    return res.status(400).json({ error: 'job_id and pay_date (YYYY-MM-DD) required' });
  }
  const job = db.prepare('SELECT id, caller, caller_payout, pay_cycle FROM jobs WHERE id = ?').get(jobId) as
    | { id: number; caller: string | null; caller_payout: number; pay_cycle: string | null }
    | undefined;
  if (!job) return res.status(404).json({ error: 'job not found' });

  if (paid) {
    const divisor = cycleDivisor(job.pay_cycle) || 1;
    const amount = Math.round(((job.caller_payout || 0) / divisor) * 100) / 100;
    db.prepare(`
      INSERT INTO caller_payout_paid (job_id, caller, pay_date, amount)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(job_id, pay_date) DO UPDATE SET amount = excluded.amount, caller = excluded.caller, paid_at = datetime('now')
    `).run(jobId, job.caller ?? null, payDate, amount);
  } else {
    db.prepare('DELETE FROM caller_payout_paid WHERE job_id = ? AND pay_date = ?').run(jobId, payDate);
  }
  res.json({ ok: true, paid });
});

export default router;
