import { Router, type NextFunction, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { isSuperAdmin, type AuthedRequest } from '../auth.js';

const router = Router();

// --- Payments page password lock (independent from auth login & from Jobs) ----

function getPayHash(): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'payments_password_hash'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

function setPayHash(hash: string) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('payments_password_hash', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(hash);
}

type SessionWithPay = { userId?: number; paymentsUnlocked?: boolean } | null | undefined;

function isPayUnlocked(req: AuthedRequest): boolean {
  return !!(req.session as SessionWithPay)?.paymentsUnlocked;
}

router.get('/unlock-status', (req: AuthedRequest, res) => {
  res.json({ unlocked: isPayUnlocked(req) });
});

router.post('/unlock', async (req: AuthedRequest, res) => {
  const { password } = req.body ?? {};
  if (!password) return res.status(400).json({ error: 'password required' });
  const hash = getPayHash();
  if (!hash) return res.status(500).json({ error: 'payments password not initialised' });
  const ok = await bcrypt.compare(String(password), hash);
  // 403, not 401: a wrong *page* password must not be read as an expired login
  // session (the client logs out on 401). The user stays logged in.
  if (!ok) return res.status(403).json({ error: 'incorrect password' });
  const sess = req.session as SessionWithPay;
  if (sess) sess.paymentsUnlocked = true;
  res.json({ ok: true });
});

router.post('/lock', (req: AuthedRequest, res) => {
  const sess = req.session as SessionWithPay;
  if (sess) sess.paymentsUnlocked = false;
  res.json({ ok: true });
});

router.post('/change-password', async (req: AuthedRequest, res) => {
  if (!isPayUnlocked(req)) return res.status(423).json({ error: 'unlock the page first' });
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'current and new password required' });
  if (String(newPassword).length < 4) return res.status(400).json({ error: 'new password must be at least 4 characters' });
  const hash = getPayHash();
  if (!hash) return res.status(500).json({ error: 'payments password not initialised' });
  const ok = await bcrypt.compare(String(currentPassword), hash);
  if (!ok) return res.status(403).json({ error: 'current password is incorrect' });
  setPayHash(await bcrypt.hash(String(newPassword), 10));
  res.json({ ok: true });
});

// Gate every endpoint below on the unlock flag.
function requirePayUnlocked(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!isPayUnlocked(req)) return res.status(423).json({ error: 'payments page is locked' });
  next();
}
router.use(requirePayUnlocked);

// --- Helpers ------------------------------------------------------------------

type AccountRow = { id: number; acct_type: string; name: string; balance: number };

// Resolve a transaction side (account | job | free text) to a display label.
function sideLabel(
  acctType: string | null, acctName: string | null,
  jobCompany: string | null, jobProfile: string | null,
  text: string | null,
  accountId: number | null, jobId: number | null,
): string {
  if (acctType != null) return `${acctType} ${acctName}`.trim();
  if (jobCompany != null) return jobProfile ? `${jobCompany} (${jobProfile})` : jobCompany;
  if (text && text.trim()) return text.trim();
  // Reference to a since-deleted account/job.
  if (accountId != null) return '(deleted account)';
  if (jobId != null) return '(deleted job)';
  return '—';
}

// Normalize one side of a transaction from the request body into the three
// nullable columns, by precedence account > job > text (only one is kept).
function normSide(prefix: 'from' | 'to', body: Record<string, unknown>) {
  const accountId = body[`${prefix}_account_id`];
  const jobId = body[`${prefix}_job_id`];
  const text = body[`${prefix}_text`];
  const acc = accountId == null || accountId === '' ? null : Number(accountId);
  const job = jobId == null || jobId === '' ? null : Number(jobId);
  if (acc != null) return { [`${prefix}_account_id`]: acc, [`${prefix}_job_id`]: null, [`${prefix}_text`]: null };
  if (job != null) return { [`${prefix}_account_id`]: null, [`${prefix}_job_id`]: job, [`${prefix}_text`]: null };
  return { [`${prefix}_account_id`]: null, [`${prefix}_job_id`]: null, [`${prefix}_text`]: (text == null ? null : String(text)) };
}

const KINDS = new Set(['deposit', 'payout', 'transfer']);

// --- Accounts -----------------------------------------------------------------

// The stored `balance` column is the OPENING balance. The current balance shown
// to the user is computed = opening + (money in) − (money out), summed across
// every transaction touching the account. So adding income/expense moves the
// balance automatically, with no double-counting.
const ACCOUNT_SELECT = `
  SELECT a.id, a.acct_type, a.name,
    a.balance AS opening_balance,
    a.balance
      + COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = a.id), 0)
      - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = a.id), 0) AS balance
  FROM financial_accounts a
`;
function getAccount(id: number) {
  return db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(id);
}
// Net effect of all transactions on an account (money in − money out).
function accountNet(id: number): number {
  const r = db.prepare(`
    SELECT COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = ?), 0)
         - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = ?), 0) AS net
  `).get(id, id) as { net: number };
  return r.net || 0;
}

router.get('/accounts', (_req, res) => {
  res.json(db.prepare(`${ACCOUNT_SELECT} ORDER BY a.acct_type, a.name`).all());
});

router.post('/accounts', (req: AuthedRequest, res) => {
  const body = req.body ?? {};
  const acct_type = String(body.acct_type ?? '').trim();
  const name = String(body.name ?? '').trim();
  if (!acct_type || !name) return res.status(400).json({ error: 'account type and name are required' });
  // Admins (and superadmins) may seed a starting balance — the route is already
  // admin-gated at mount, so any caller here is at least an admin. A brand-new
  // account has no transactions, so its opening balance == its current balance.
  const balance = Number(body.balance) || 0;
  const info = db.prepare('INSERT INTO financial_accounts (acct_type, name, balance) VALUES (?, ?, ?)').run(acct_type, name, balance);
  res.status(201).json(getAccount(Number(info.lastInsertRowid)));
});

router.put('/accounts/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM financial_accounts WHERE id = ?').get(id) as AccountRow | undefined;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const body = req.body ?? {};
  const acct_type = body.acct_type != null ? String(body.acct_type).trim() : existing.acct_type;
  const name = body.name != null ? String(body.name).trim() : existing.name;
  // `body.balance` is the desired CURRENT balance; back-compute the opening
  // balance so current = opening + net. Editable by admins and superadmins.
  let opening = existing.balance;
  if ('balance' in body) opening = (Number(body.balance) || 0) - accountNet(id);
  db.prepare("UPDATE financial_accounts SET acct_type = ?, name = ?, balance = ?, updated_at = datetime('now') WHERE id = ?")
    .run(acct_type, name, opening, id);
  res.json(getAccount(id));
});

router.delete('/accounts/:id', (req: AuthedRequest, res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'only a superadmin can delete an account' });
  const id = Number(req.params.id);
  db.prepare('DELETE FROM financial_accounts WHERE id = ?').run(id);
  res.status(204).end();
});

// Minimal job list for the transaction editor's "Job" picker (avoids the
// separate Jobs page lock).
router.get('/jobs', (_req, res) => {
  const rows = db.prepare("SELECT id, company_name, profile_name FROM jobs ORDER BY (status = 'active') DESC, company_name").all();
  res.json(rows);
});

// --- Transactions -------------------------------------------------------------

const TXN_SELECT = `
  SELECT t.*,
    fa.acct_type AS from_acct_type, fa.name AS from_acct_name,
    ta.acct_type AS to_acct_type,   ta.name AS to_acct_name,
    fj.company_name AS from_job_company, fj.profile_name AS from_job_profile,
    tj.company_name AS to_job_company,   tj.profile_name AS to_job_profile
  FROM transactions t
  LEFT JOIN financial_accounts fa ON fa.id = t.from_account_id
  LEFT JOIN financial_accounts ta ON ta.id = t.to_account_id
  LEFT JOIN jobs fj ON fj.id = t.from_job_id
  LEFT JOIN jobs tj ON tj.id = t.to_job_id
`;

type TxnJoined = Record<string, unknown> & {
  id: number; ts: string; kind: string; amount: number; purpose: string | null;
  from_account_id: number | null; from_job_id: number | null; from_text: string | null;
  to_account_id: number | null; to_job_id: number | null; to_text: string | null;
  from_acct_type: string | null; from_acct_name: string | null;
  to_acct_type: string | null; to_acct_name: string | null;
  from_job_company: string | null; from_job_profile: string | null;
  to_job_company: string | null; to_job_profile: string | null;
};

function shapeTxn(t: TxnJoined) {
  return {
    id: t.id, ts: t.ts, kind: t.kind, amount: t.amount, purpose: t.purpose,
    from_account_id: t.from_account_id, from_job_id: t.from_job_id, from_text: t.from_text,
    to_account_id: t.to_account_id, to_job_id: t.to_job_id, to_text: t.to_text,
    group_id: (t.group_id as number | null) ?? null,
    from_label: sideLabel(t.from_acct_type, t.from_acct_name, t.from_job_company, t.from_job_profile, t.from_text, t.from_account_id, t.from_job_id),
    to_label: sideLabel(t.to_acct_type, t.to_acct_name, t.to_job_company, t.to_job_profile, t.to_text, t.to_account_id, t.to_job_id),
  };
}

// Clean a list of transaction ids from a request body.
function txnIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)));
}

// Derive a group label from its deposit leg (the company that paid). Groups are
// "payment cycles" identified by the depositing company (QCells, CommonGood, …).
function labelFromDeposit(ids: number[]): string {
  if (ids.length === 0) return 'Payment';
  const ph = ids.map(() => '?').join(',');
  const dep = db.prepare(
    `SELECT t.from_text, j.company_name FROM transactions t LEFT JOIN jobs j ON j.id = t.from_job_id
     WHERE t.id IN (${ph}) AND t.kind = 'deposit' AND (t.from_job_id IS NOT NULL OR (t.from_text IS NOT NULL AND TRIM(t.from_text) <> ''))
     ORDER BY t.ts ASC LIMIT 1`,
  ).get(...ids) as { from_text: string | null; company_name: string | null } | undefined;
  return (dep?.company_name || dep?.from_text || 'Payment').trim() || 'Payment';
}

// All transactions (newest first), or those touching one account (oldest first)
// when ?account=<id> is given (the account drill-down: start → end).
router.get('/transactions', (req, res) => {
  const accountId = req.query.account != null ? Number(req.query.account) : null;
  let rows: TxnJoined[];
  if (accountId != null && !Number.isNaN(accountId)) {
    rows = db.prepare(`${TXN_SELECT} WHERE t.from_account_id = ? OR t.to_account_id = ? ORDER BY t.ts ASC, t.id ASC`)
      .all(accountId, accountId) as TxnJoined[];
  } else {
    rows = db.prepare(`${TXN_SELECT} ORDER BY t.ts DESC, t.id DESC`).all() as TxnJoined[];
  }
  res.json(rows.map(shapeTxn));
});

function buildTxnValues(body: Record<string, unknown>) {
  const kind = KINDS.has(String(body.kind)) ? String(body.kind) : 'payout';
  return {
    ts: String(body.ts ?? '').trim() || new Date().toISOString().slice(0, 16),
    kind,
    ...normSide('from', body),
    ...normSide('to', body),
    purpose: body.purpose == null ? null : String(body.purpose),
    amount: Number(body.amount) || 0,
  } as Record<string, unknown>;
}

router.post('/transactions', (req, res) => {
  const v = buildTxnValues(req.body ?? {});
  const info = db.prepare(`
    INSERT INTO transactions (ts, kind, from_account_id, from_job_id, from_text, to_account_id, to_job_id, to_text, purpose, amount)
    VALUES (@ts, @kind, @from_account_id, @from_job_id, @from_text, @to_account_id, @to_job_id, @to_text, @purpose, @amount)
  `).run(v);
  const row = db.prepare(`${TXN_SELECT} WHERE t.id = ?`).get(info.lastInsertRowid) as TxnJoined;
  res.status(201).json(shapeTxn(row));
});

router.put('/transactions/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const v = { ...buildTxnValues(req.body ?? {}), id };
  db.prepare(`
    UPDATE transactions SET ts = @ts, kind = @kind,
      from_account_id = @from_account_id, from_job_id = @from_job_id, from_text = @from_text,
      to_account_id = @to_account_id, to_job_id = @to_job_id, to_text = @to_text,
      purpose = @purpose, amount = @amount, updated_at = datetime('now')
    WHERE id = @id
  `).run(v);
  const row = db.prepare(`${TXN_SELECT} WHERE t.id = ?`).get(id) as TxnJoined;
  res.json(shapeTxn(row));
});

router.delete('/transactions/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  res.status(204).end();
});

// --- Transaction groups (payment cycles) --------------------------------------
// Groups that still have at least one member, with their labels.
router.get('/transactions/groups', (_req, res) => {
  const rows = db.prepare(`
    SELECT g.id, g.label
    FROM transaction_groups g
    WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.group_id = g.id)
    ORDER BY g.id DESC
  `).all() as { id: number; label: string | null }[];
  res.json(rows);
});

// Create a group from selected transactions. Auto-labels from the deposit leg
// unless a label is provided. Any prior group of those transactions is left as-is
// except that the transactions are re-pointed to the new group.
router.post('/transactions/group', (req, res) => {
  const ids = txnIds(req.body?.ids);
  if (ids.length === 0) return res.status(400).json({ error: 'select at least one transaction' });
  const label = typeof req.body?.label === 'string' && req.body.label.trim()
    ? req.body.label.trim() : labelFromDeposit(ids);
  const gid = Number(db.prepare('INSERT INTO transaction_groups (label) VALUES (?)').run(label).lastInsertRowid);
  const ph = ids.map(() => '?').join(',');
  db.prepare(`UPDATE transactions SET group_id = ?, updated_at = datetime('now') WHERE id IN (${ph})`).run(gid, ...ids);
  cleanupEmptyGroups();
  res.status(201).json({ id: gid, label });
});

// Add transactions to an existing group (for legs that arrive days later).
router.post('/transactions/group/:gid/add', (req, res) => {
  const gid = Number(req.params.gid);
  if (!db.prepare('SELECT id FROM transaction_groups WHERE id = ?').get(gid)) return res.status(404).json({ error: 'group not found' });
  const ids = txnIds(req.body?.ids);
  if (ids.length === 0) return res.status(400).json({ error: 'select at least one transaction' });
  const ph = ids.map(() => '?').join(',');
  db.prepare(`UPDATE transactions SET group_id = ?, updated_at = datetime('now') WHERE id IN (${ph})`).run(gid, ...ids);
  cleanupEmptyGroups();
  res.json({ ok: true, id: gid });
});

// Remove transactions from whatever group they're in (back to Ungrouped).
router.post('/transactions/ungroup', (req, res) => {
  const ids = txnIds(req.body?.ids);
  if (ids.length === 0) return res.status(400).json({ error: 'select at least one transaction' });
  const ph = ids.map(() => '?').join(',');
  db.prepare(`UPDATE transactions SET group_id = NULL, updated_at = datetime('now') WHERE id IN (${ph})`).run(...ids);
  cleanupEmptyGroups();
  res.json({ ok: true });
});

// Disband a whole group (its transactions become Ungrouped).
router.delete('/transactions/group/:gid', (req, res) => {
  const gid = Number(req.params.gid);
  db.prepare('UPDATE transactions SET group_id = NULL, updated_at = datetime(\'now\') WHERE group_id = ?').run(gid);
  db.prepare('DELETE FROM transaction_groups WHERE id = ?').run(gid);
  res.status(204).end();
});

// Drop group rows that no longer have any member transactions.
function cleanupEmptyGroups() {
  db.prepare('DELETE FROM transaction_groups WHERE id NOT IN (SELECT DISTINCT group_id FROM transactions WHERE group_id IS NOT NULL)').run();
}

export default router;
