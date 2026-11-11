import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
if (!existsSync(DATA_DIR))
    mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, 'job-manager.db');
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
const _origPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
    const stmt = _origPrepare(sql);
    // Method exists on Node's StatementSync in 22.10+; guard for older runtimes.
    const setLenient = stmt
        .setAllowUnknownNamedParameters;
    if (typeof setLenient === 'function')
        setLenient.call(stmt, true);
    return stmt;
};
export function initSchema() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no INTEGER,
      name TEXT NOT NULL,
      gmail TEXT,
      linkedin_url TEXT,
      full_address TEXT,
      gv TEXT,
      github TEXT,
      race TEXT,
      gv2 TEXT,
      apply_enabled INTEGER NOT NULL DEFAULT 1,
      color INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_name TEXT NOT NULL,
      company_name TEXT NOT NULL,
      role_title TEXT,
      specs TEXT,
      source TEXT,
      salary_monthly REAL DEFAULT 0,
      caller_payout REAL DEFAULT 0,
      dev_payout REAL DEFAULT 0,
      started_on TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      roles TEXT NOT NULL DEFAULT 'dev',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      meeting_slot TEXT,
      country TEXT,
      profile_name TEXT,
      company_name TEXT,
      step TEXT,
      step_details TEXT,
      agency_recruiter_id INTEGER,
      agency_name TEXT,
      progress TEXT,
      last_followed_up_at TEXT,
      meeting_type TEXT,
      meeting_url TEXT,
      jd_url TEXT,
      recording_url TEXT,
      notes TEXT,
      handler TEXT,
      recurrence TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
    // Resumes are shared per PIPELINE — a pipeline being (profile_name,
    // company_name). The key matches the server's pipelineKey():
    // `${profile.trim()}::${company.trim()}`. Every interview in the pipeline
    // (including ones added later) sees the same resume; replace/delete affect
    // the whole pipeline. Binaries live here (not on interviews) so the
    // interviews SELECT * queries never pull the blob.
    db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_resumes (
      pipeline_key TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime TEXT,
      data BLOB NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
    // Clean up the earlier per-interview resume design, if present.
    db.exec('DROP TABLE IF EXISTS interview_resumes');
    // Job Apply: a shared daily list of job links with per-(candidate)profile
    // sign-off, plus a seed reference database used only for duplicate detection.
    db.exec(`
    CREATE TABLE IF NOT EXISTS job_apply_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      url TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS job_apply_days (
      date TEXT PRIMARY KEY,
      done INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS job_apply_confirms (
      date TEXT NOT NULL,
      profile_id INTEGER NOT NULL,
      PRIMARY KEY (date, profile_id)
    );
    CREATE TABLE IF NOT EXISTS seed_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_job_apply_links_date ON job_apply_links(date)');
    // Job categories (e.g. "AI/ML", "Full Stack"). A link and a profile can each
    // belong to MANY categories (join tables). Matching: a profile sees a day's
    // link if they share at least one category — OR the link has no category at
    // all (uncategorized links go to everyone, preserving the old behavior).
    db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS link_categories (
      link_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (link_id, category_id)
    );
    CREATE TABLE IF NOT EXISTS profile_categories (
      profile_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (profile_id, category_id)
    );
  `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_link_categories_link ON link_categories(link_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_profile_categories_profile ON profile_categories(profile_id)');
    // Master resume per profile — the base CV that Claude tailors to each job's
    // JD. One per profile (keyed by profile_id). `text` is the extracted plain
    // text (from PDF/DOCX/TXT) that gets fed to the model; the binary is kept so
    // the master can be re-downloaded. Binary lives here (not on profiles) so the
    // profiles SELECT * never drags the blob around.
    db.exec(`
    CREATE TABLE IF NOT EXISTS profile_resumes (
      profile_id INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      mime TEXT,
      data BLOB NOT NULL,
      text TEXT,
      template_marked TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
    // `template_marked`: for LaTeX masters, a copy of the .tex with %%PLACEHOLDER%%
    // markers where tailored content goes. The original `text` (real content) is
    // still sent to Claude as the fact source; the marked version is the splice
    // target. Absent → the whole template is used (full-file rewrite path).
    {
        const cols = db.prepare('PRAGMA table_info(profile_resumes)').all().map((c) => c.name);
        if (!cols.includes('template_marked'))
            db.exec('ALTER TABLE profile_resumes ADD COLUMN template_marked TEXT');
    }
    // Tailored resumes generated for a given day. One row per (date, profile,
    // job link). Holds the fetched/pasted JD text, the model's tailored resume
    // (markdown), a status, and an optional per-resume custom prompt used when the
    // user regenerates a single one. company_name is extracted for the ZIP folder.
    db.exec(`
    CREATE TABLE IF NOT EXISTS generated_resumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      profile_id INTEGER NOT NULL,
      link_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      company_name TEXT,
      jd_text TEXT,
      jd_source TEXT,                       -- 'fetched' | 'manual' | 'failed'
      resume_md TEXT,
      resume_tex TEXT,                        -- final spliced/tailored LaTeX (LaTeX masters)
      resume_pdf BLOB,                        -- compiled PDF bytes (LaTeX masters)
      custom_prompt TEXT,
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'generating'|'done'|'error'|'needs_jd'
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, profile_id, link_id)
    );
  `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_generated_resumes_day ON generated_resumes(date, profile_id)');
    // Dev-marked unavailable time blocks, shown on the Calendar. A dev marks
    // their own; admins can see everyone's. Times are minutes-since-midnight in
    // EST (the app's canonical timezone), matching interview meeting slots.
    db.exec(`
    CREATE TABLE IF NOT EXISTS unavailability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_min INTEGER NOT NULL,
      end_min INTEGER NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
    // Payments (admin/superadmin, page-locked). Financial accounts carry a
    // manually-seeded balance (only superadmin may change it). Transactions are a
    // ledger/log that does NOT auto-adjust balances. Each transaction side (from/
    // to) is one of: a financial account, a job, or free text — stored as the
    // matching *_account_id / *_job_id / *_text column (others NULL). No FK
    // constraints so deleting an account/job never blocks or cascades; a dangling
    // reference simply resolves to a fallback label at read time.
    db.exec(`
    CREATE TABLE IF NOT EXISTS financial_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      acct_type TEXT NOT NULL,
      name TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'payout',
      from_account_id INTEGER,
      from_job_id INTEGER,
      from_text TEXT,
      to_account_id INTEGER,
      to_job_id INTEGER,
      to_text TEXT,
      purpose TEXT,
      amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_ts ON transactions(ts)');
    // Lightweight migrations for existing DBs.
    const profCols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
    if (!profCols.includes('apply_enabled')) {
        db.exec('ALTER TABLE profiles ADD COLUMN apply_enabled INTEGER NOT NULL DEFAULT 1');
    }
    if (!profCols.includes('color')) {
        db.exec('ALTER TABLE profiles ADD COLUMN color INTEGER');
    }
    const ivCols = db.prepare('PRAGMA table_info(interviews)').all().map(c => c.name);
    if (!ivCols.includes('handler')) {
        db.exec('ALTER TABLE interviews ADD COLUMN handler TEXT');
        // Backfill what we already know from notes — only obvious matches.
        db.exec("UPDATE interviews SET handler = 'Shane' WHERE notes LIKE '%Handled by shane%' AND handler IS NULL");
    }
    if (!ivCols.includes('step_details')) {
        db.exec('ALTER TABLE interviews ADD COLUMN step_details TEXT');
    }
    if (!ivCols.includes('agency_recruiter_id')) {
        db.exec('ALTER TABLE interviews ADD COLUMN agency_recruiter_id INTEGER');
    }
    if (!ivCols.includes('agency_name')) {
        db.exec('ALTER TABLE interviews ADD COLUMN agency_name TEXT');
    }
    if (!ivCols.includes('last_followed_up_at')) {
        db.exec('ALTER TABLE interviews ADD COLUMN last_followed_up_at TEXT');
    }
    if (!ivCols.includes('meeting_type')) {
        db.exec('ALTER TABLE interviews ADD COLUMN meeting_type TEXT');
    }
    if (!ivCols.includes('recurrence')) {
        db.exec('ALTER TABLE interviews ADD COLUMN recurrence TEXT');
    }
    // generated_resumes gained LaTeX output columns (compiled from a .tex master).
    const grCols = db.prepare('PRAGMA table_info(generated_resumes)').all().map((c) => c.name);
    if (grCols.length > 0) {
        if (!grCols.includes('resume_tex'))
            db.exec('ALTER TABLE generated_resumes ADD COLUMN resume_tex TEXT');
        if (!grCols.includes('resume_pdf'))
            db.exec('ALTER TABLE generated_resumes ADD COLUMN resume_pdf BLOB');
    }
    // Resumes moved from per-interview columns to the pipeline_resumes table.
    // Drop the now-unused columns if an earlier build added them. (SQLite 3.35+
    // supports DROP COLUMN; guard in case it isn't available.)
    for (const col of ['resume_filename', 'resume_mime']) {
        if (ivCols.includes(col)) {
            try {
                db.exec(`ALTER TABLE interviews DROP COLUMN ${col}`);
            }
            catch { /* leave it — harmless */ }
        }
    }
    migrateSlotFormats();
    migrateStepNames();
    migrateUserRoles();
    migratePaymentsOpeningBalance();
}
// One-time: financial_accounts.balance used to be the *current* balance (manual).
// It now means the *opening* balance, and the current balance is computed as
// opening + (money in) − (money out). To preserve every account's currently-
// shown balance, set opening = current − net once. Guarded so it runs only once.
function migratePaymentsOpeningBalance() {
    const done = db.prepare("SELECT value FROM settings WHERE key = 'payments_opening_migrated'").get();
    if (done)
        return;
    db.exec(`
    UPDATE financial_accounts SET balance = balance
      - COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = financial_accounts.id), 0)
      + COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = financial_accounts.id), 0)
  `);
    db.prepare("INSERT INTO settings (key, value) VALUES ('payments_opening_migrated', '1')").run();
    console.log('Migrated financial_accounts.balance to opening-balance semantics (current = opening + net transactions)');
}
// Promote Shane (the seeded admin) to superadmin and ensure Philip exists as
// admin. Idempotent — safe to run on every startup.
function migrateUserRoles() {
    const shane = db.prepare("SELECT id, roles FROM users WHERE LOWER(email) = LOWER('shanecard926@gmail.com')").get();
    if (shane && shane.roles && !shane.roles.split(',').includes('superadmin')) {
        const next = shane.roles
            .split(',')
            .map((r) => (r.trim() === 'admin' ? 'superadmin' : r.trim()))
            .filter(Boolean);
        if (!next.includes('superadmin'))
            next.push('superadmin');
        db.prepare("UPDATE users SET roles = ?, updated_at = datetime('now') WHERE id = ?")
            .run(Array.from(new Set(next)).join(','), shane.id);
        console.log(`Promoted Shane to superadmin (roles: ${next.join(',')})`);
    }
    // NOTE: deliberately does NOT create any users. Seeding lives in seed.ts and
    // only runs on an empty users table, so a deleted user is never resurrected.
}
// One-off (idempotent) migration:
//   - "Recruiter" → "Agency Recruiter"
//   - "Live Coding" / "System Design" stand-alone steps → "Tech Screen" with
//     step_details capturing the original sub-type.
function migrateStepNames() {
    const n1 = db.prepare("UPDATE interviews SET step = 'Agency Recruiter' WHERE step = 'Recruiter'").run().changes;
    const n2 = db.prepare(`
    UPDATE interviews
       SET step_details = CASE WHEN step_details IS NULL OR step_details = ''
                               THEN 'Live Coding'
                               ELSE step_details END,
           step = 'Tech Screen'
     WHERE step = 'Live Coding'
  `).run().changes;
    const n3 = db.prepare(`
    UPDATE interviews
       SET step_details = CASE WHEN step_details IS NULL OR step_details = ''
                               THEN 'System Design'
                               ELSE step_details END,
           step = 'Tech Screen'
     WHERE step = 'System Design'
  `).run().changes;
    const total = n1 + n2 + n3;
    if (total > 0) {
        console.log(`Migrated ${total} step(s) (Recruiter→Agency Recruiter, Live Coding/System Design→Tech Screen)`);
    }
}
// One-off (idempotent) migration: convert legacy free-text meeting_slot values
// like "9-9.30am", "12.30-1pm", "11.45-12pm" to the canonical 24-hour form
// "HH:MM-HH:MM" used by the new editor. Already-canonical values are skipped.
const CANON_24H = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;
function migrateLegacySlot(slot) {
    const trimmed = slot.trim();
    if (!trimmed)
        return null;
    if (CANON_24H.test(trimmed))
        return null; // already canonical
    const s = trimmed.toLowerCase();
    const parts = s.split(/[-–—]/);
    if (parts.length < 2)
        return null;
    let startStr = parts[0].trim();
    let endStr = parts[1].trim();
    const startMer = (startStr.match(/am|pm/) ?? [])[0] ?? '';
    const endMer = (endStr.match(/am|pm/) ?? [])[0] ?? '';
    startStr = startStr.replace(/am|pm/g, '').trim();
    endStr = endStr.replace(/am|pm/g, '').trim();
    const parseTime = (str) => {
        const m = /(\d+)(?:[.:](\d+))?/.exec(str);
        if (!m)
            return null;
        return { h: Number(m[1]), m: Number(m[2] ?? 0) };
    };
    const start = parseTime(startStr);
    const end = parseTime(endStr);
    if (!start || !end)
        return null;
    const to24 = (h, mer) => {
        if (mer === 'pm' && h < 12)
            return h + 12;
        if (mer === 'am' && h === 12)
            return 0;
        return h;
    };
    let sMer = startMer;
    let eMer = endMer;
    if (!sMer && eMer) {
        // Try start with same as end; flip start if it would be later than end.
        sMer = eMer;
        const sH = to24(start.h, sMer);
        const eH = to24(end.h, eMer);
        if (sH * 60 + start.m > eH * 60 + end.m) {
            sMer = eMer === 'pm' ? 'am' : 'pm';
        }
    }
    else if (sMer && !eMer) {
        eMer = sMer;
        const sH = to24(start.h, sMer);
        const eH = to24(end.h, eMer);
        if (eH * 60 + end.m <= sH * 60 + start.m) {
            eMer = sMer === 'am' ? 'pm' : 'am';
        }
    }
    else if (!sMer && !eMer) {
        sMer = 'am';
        eMer = 'am';
    }
    const sH = to24(start.h, sMer);
    const eH = to24(end.h, eMer);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(sH)}:${pad(start.m)}-${pad(eH)}:${pad(end.m)}`;
}
function migrateSlotFormats() {
    const rows = db.prepare(`
    SELECT id, meeting_slot FROM interviews
    WHERE meeting_slot IS NOT NULL AND meeting_slot != ''
  `).all();
    const update = db.prepare('UPDATE interviews SET meeting_slot = ? WHERE id = ?');
    let migrated = 0;
    tx(() => {
        for (const row of rows) {
            const next = migrateLegacySlot(row.meeting_slot);
            if (next && next !== row.meeting_slot) {
                update.run(next, row.id);
                migrated++;
            }
        }
    });
    if (migrated > 0)
        console.log(`Migrated ${migrated} meeting_slot value(s) to canonical HH:MM-HH:MM`);
}
export function tx(fn) {
    db.exec('BEGIN');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    }
    catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}
