import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
const router = Router();
const COLS = [
    'profile_name', 'company_name', 'role_title', 'specs', 'source',
    'salary_monthly', 'caller_payout', 'dev_payout', 'started_on', 'status', 'notes',
];
// --- Jobs page password lock (independent from auth login) --------------------
function getJobsHash() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'jobs_password_hash'").get();
    return row?.value ?? null;
}
function setJobsHash(hash) {
    db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('jobs_password_hash', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(hash);
}
function isJobsUnlocked(req) {
    return !!req.session?.jobsUnlocked;
}
// Lock/unlock endpoints first so the unlock POST itself doesn't get blocked.
router.get('/unlock-status', (req, res) => {
    res.json({ unlocked: isJobsUnlocked(req) });
});
router.post('/unlock', async (req, res) => {
    const { password } = req.body ?? {};
    if (!password)
        return res.status(400).json({ error: 'password required' });
    const hash = getJobsHash();
    if (!hash)
        return res.status(500).json({ error: 'jobs password not initialised' });
    const ok = await bcrypt.compare(String(password), hash);
    // 403, not 401: a wrong *page* password must not be read as an expired login
    // session (the client logs out on 401). The user stays logged in.
    if (!ok)
        return res.status(403).json({ error: 'incorrect password' });
    const sess = req.session;
    if (sess)
        sess.jobsUnlocked = true;
    res.json({ ok: true });
});
router.post('/lock', (req, res) => {
    const sess = req.session;
    if (sess)
        sess.jobsUnlocked = false;
    res.json({ ok: true });
});
router.post('/change-password', async (req, res) => {
    if (!isJobsUnlocked(req))
        return res.status(423).json({ error: 'unlock the page first' });
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword)
        return res.status(400).json({ error: 'current and new password required' });
    if (String(newPassword).length < 4)
        return res.status(400).json({ error: 'new password must be at least 4 characters' });
    const hash = getJobsHash();
    if (!hash)
        return res.status(500).json({ error: 'jobs password not initialised' });
    const ok = await bcrypt.compare(String(currentPassword), hash);
    // 403, not 401 (see /unlock): wrong page password must not log the user out.
    if (!ok)
        return res.status(403).json({ error: 'current password is incorrect' });
    setJobsHash(await bcrypt.hash(String(newPassword), 10));
    res.json({ ok: true });
});
// Gate every CRUD endpoint below on the unlock flag.
function requireJobsUnlocked(req, res, next) {
    if (!isJobsUnlocked(req))
        return res.status(423).json({ error: 'jobs page is locked' });
    next();
}
router.use(requireJobsUnlocked);
router.get('/', (_req, res) => {
    const rows = db.prepare(`
    SELECT * FROM jobs
    ORDER BY (status = 'active') DESC, started_on DESC, id DESC
  `).all();
    const active = rows.filter((r) => r.status === 'active');
    const summary = {
        active_count: active.length,
        monthly_income: active.reduce((s, j) => s + (j.salary_monthly || 0), 0),
        monthly_caller_payout: active.reduce((s, j) => s + (j.caller_payout || 0), 0),
        monthly_dev_payout: active.reduce((s, j) => s + (j.dev_payout || 0), 0),
        monthly_net: active.reduce((s, j) => s + ((j.salary_monthly || 0) - (j.caller_payout || 0) - (j.dev_payout || 0)), 0),
    };
    res.json({ jobs: rows, summary });
});
router.post('/', (req, res) => {
    const body = req.body ?? {};
    const values = {
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
    };
    const info = db.prepare(`
    INSERT INTO jobs (profile_name, company_name, role_title, specs, source, salary_monthly, caller_payout, dev_payout, started_on, status, notes)
    VALUES (@profile_name, @company_name, @role_title, @specs, @source, @salary_monthly, @caller_payout, @dev_payout, @started_on, @status, @notes)
  `).run(values);
    const created = db.prepare('SELECT * FROM jobs WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
});
router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!existing)
        return res.status(404).json({ error: 'not found' });
    const merged = { ...existing };
    for (const c of COLS) {
        if (c in req.body)
            merged[c] = req.body[c];
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
        status = @status, notes = @notes, updated_at = datetime('now')
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
