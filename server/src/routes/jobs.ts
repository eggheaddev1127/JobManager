import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';

const router = Router();

const COLS = [
  'profile_name', 'company_name', 'role_title', 'specs', 'source',
  'salary_monthly', 'caller_payout', 'dev_payout', 'started_on', 'status', 'notes',
  'caller', 'pay_first_date', 'pay_cycle',
] as const;
type Col = typeof COLS[number];

// --- Jobs page password lock (independent from auth login) --------------------

function getJobsHash(): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'jobs_password_hash'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

function setJobsHash(hash: string) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('jobs_password_hash', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(hash);
}

type SessionWithJobs = { userId?: number; jobsUnlocked?: boolean } | null | undefined;

function isJobsUnlocked(req: Request): boolean {
  return !!(req.session as SessionWithJobs)?.jobsUnlocked;
}

// Lock/unlock endpoints first so the unlock POST itself doesn't get blocked.
router.get('/unlock-status', (req, res) => {
  res.json({ unlocked: isJobsUnlocked(req) });
});

router.post('/unlock', async (req, res) => {
  const { password } = req.body ?? {};
  if (!password) return res.status(400).json({ error: 'password required' });
  const hash = getJobsHash();
  if (!hash) return res.status(500).json({ error: 'jobs password not initialised' });
  const ok = await bcrypt.compare(String(password), hash);
  // 403, not 401: a wrong *page* password must not be read as an expired login
  // session (the client logs out on 401). The user stays logged in.
  if (!ok) return res.status(403).json({ error: 'incorrect password' });
  const sess = req.session as SessionWithJobs;
  if (sess) sess.jobsUnlocked = true;
  res.json({ ok: true });
});

router.post('/lock', (req, res) => {
  const sess = req.session as SessionWithJobs;
  if (sess) sess.jobsUnlocked = false;
  res.json({ ok: true });
});

router.post('/change-password', async (req, res) => {
  if (!isJobsUnlocked(req)) return res.status(423).json({ error: 'unlock the page first' });
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'current and new password required' });
  if (String(newPassword).length < 4) return res.status(400).json({ error: 'new password must be at least 4 characters' });
  const hash = getJobsHash();
  if (!hash) return res.status(500).json({ error: 'jobs password not initialised' });
  const ok = await bcrypt.compare(String(currentPassword), hash);
  // 403, not 401 (see /unlock): wrong page password must not log the user out.
  if (!ok) return res.status(403).json({ error: 'current password is incorrect' });
  setJobsHash(await bcrypt.hash(String(newPassword), 10));
  res.json({ ok: true });
});

// Gate every CRUD endpoint below on the unlock flag.
function requireJobsUnlocked(req: Request, res: Response, next: NextFunction) {
  if (!isJobsUnlocked(req)) return res.status(423).json({ error: 'jobs page is locked' });
  next();
}

router.use(requireJobsUnlocked);

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT * FROM jobs
    ORDER BY (status = 'active') DESC, started_on DESC, id DESC
  `).all();

  type Job = {
    id: number;
    salary_monthly: number;
    caller_payout: number;
    dev_payout: number;
    status: string;
  };
  const active = rows.filter((r) => (r as Job).status === 'active') as Job[];
  const baseFee = getBaseFee();
  const summary = {
    active_count: active.length,
    monthly_income: active.reduce((s, j) => s + (j.salary_monthly || 0), 0),
    monthly_caller_payout: active.reduce((s, j) => s + (j.caller_payout || 0), 0),
    monthly_dev_payout: active.reduce((s, j) => s + (j.dev_payout || 0), 0),
    base_fee: baseFee,
    monthly_net: active.reduce(
      (s, j) => s + ((j.salary_monthly || 0) - (j.caller_payout || 0) - (j.dev_payout || 0)),
      0,
    ) - baseFee,
  };

  // Auto-suggest a caller for each job from the matching interview pipeline's
  // handler (profile + company, case-insensitive). Editable on the job itself;
  // this is only the default shown when no caller has been assigned yet.
  const handlerByKey = new Map<string, string>();
  const hrows = db.prepare(
    "SELECT profile_name, company_name, handler FROM interviews WHERE handler IS NOT NULL AND TRIM(handler) <> ''",
  ).all() as { profile_name: string | null; company_name: string | null; handler: string }[];
  for (const r of hrows) {
    const k = `${(r.profile_name || '').trim().toLowerCase()}::${(r.company_name || '').trim().toLowerCase()}`;
    if (!handlerByKey.has(k)) handlerByKey.set(k, r.handler);
  }
  const jobsOut = (rows as Record<string, unknown>[]).map((j) => {
    const k = `${String(j.profile_name || '').trim().toLowerCase()}::${String(j.company_name || '').trim().toLowerCase()}`;
    return { ...j, suggested_caller: handlerByKey.get(k) ?? null };
  });

  res.json({ jobs: jobsOut, summary });
});

// Fixed monthly "base fee" — a recurring deduction that isn't tied to any job.
// Stored in settings; subtracted from net monthly income.
function getBaseFee(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'running_jobs_base_fee'").get() as { value: string } | undefined;
  return Math.max(0, Number(row?.value) || 0);
}

// Set the monthly base fee. Must be registered BEFORE PUT '/:id' so the literal
// path isn't captured by the :id param route.
router.put('/base-fee', (req, res) => {
  const v = Math.max(0, Number(req.body?.base_fee) || 0);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('running_jobs_base_fee', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(String(v));
  res.json({ base_fee: v });
});

router.post('/', (req, res) => {
  const body = req.body ?? {};
  const values: Record<Col, unknown> = {
    profile_name: body.profile_name ?? '',
    company_name: body.company_name ?? '',
    role_title: body.role_title ?? null,
    specs: body.specs ?? null,
    source: body.source ?? null,
    salary_monthly: Number(body.salary_monthly) || 0,
    caller_payout: Number(body.caller_payout) || 0,
    dev_payout: Number(body.dev_payout) || 0,
    started_on: body.started_on ?? null,
    status: body.status ?? 'active',
    notes: body.notes ?? null,
    caller: body.caller ?? null,
    pay_first_date: body.pay_first_date ?? null,
    pay_cycle: body.pay_cycle ?? null,
  };
  const info = db.prepare(`
    INSERT INTO jobs (profile_name, company_name, role_title, specs, source, salary_monthly, caller_payout, dev_payout, started_on, status, notes, caller, pay_first_date, pay_cycle)
    VALUES (@profile_name, @company_name, @role_title, @specs, @source, @salary_monthly, @caller_payout, @dev_payout, @started_on, @status, @notes, @caller, @pay_first_date, @pay_cycle)
  `).run(values);
  const created = db.prepare('SELECT * FROM jobs WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const merged: Record<string, unknown> = { ...existing };
  for (const c of COLS) {
    if (c in req.body) merged[c] = req.body[c];
  }
  merged.salary_monthly = Number(merged.salary_monthly) || 0;
  merged.caller_payout = Number(merged.caller_payout) || 0;
  merged.dev_payout = Number(merged.dev_payout) || 0;
  merged.id = id;
  db.prepare(`
    UPDATE jobs
    SET profile_name = @profile_name, company_name = @company_name, role_title = @role_title,
        specs = @specs, source = @source, salary_monthly = @salary_monthly,
        caller_payout = @caller_payout, dev_payout = @dev_payout, started_on = @started_on,
        status = @status, notes = @notes, caller = @caller,
        pay_first_date = @pay_first_date, pay_cycle = @pay_cycle, updated_at = datetime('now')
    WHERE id = @id
  `).run(merged);
  res.json(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  res.status(204).end();
});

export default router;
