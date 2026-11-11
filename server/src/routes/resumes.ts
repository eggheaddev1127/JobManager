import { Router } from 'express';
import archiver from 'archiver';
import { db } from '../db.js';
import { getSetting, setSetting, SETTINGS_KEYS, DEFAULT_RESUME_PROMPT } from '../settings.js';
import { extractResumeText, fetchJobDescription } from '../resume/extract.js';
import { tailorResume, tailorLatexPlaceholders, tailorLatexFull, renderResumePdf, ResumeGenError } from '../resume/generate.js';
import { isLatexMaster, scanPlaceholders, spliceTemplate, compileLatex, LatexError, buildResumeHeader, injectTitlePlaceholders } from '../resume/latex.js';

// All routes here are admin-gated at mount time (see index.ts). This router
// owns: resume-generation settings (Claude key + global prompt), per-profile
// master resumes, and the day's tailored-resume generation / review / ZIP.
const router = Router();

const isDateStr = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const MAX_RESUME_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/rtf',
  // LaTeX master resumes. Browsers report .tex inconsistently (often empty or
  // text/x-tex / application/x-tex), so we also accept by extension below.
  'application/x-tex',
  'text/x-tex',
  'application/x-latex',
]);

// A .tex file may arrive with an empty or generic mime; accept it by extension.
function isAllowedResume(mimeType: string, filename: string): boolean {
  if (ALLOWED_MIME.has(mimeType)) return true;
  const ext = filename.toLowerCase().split('.').pop();
  return ext === 'tex' || ext === 'latex';
}

// --- Settings: Claude API key + global tailoring prompt ----------------------
// The key is write-only from the UI's perspective: we never send it back, only
// whether one is configured.
router.get('/settings', (_req, res) => {
  const key = getSetting(SETTINGS_KEYS.claudeApiKey);
  const prompt = getSetting(SETTINGS_KEYS.resumePrompt);
  res.json({
    has_api_key: !!(key && key.trim()),
    api_key_hint: key && key.trim() ? `…${key.trim().slice(-4)}` : null,
    prompt: prompt ?? DEFAULT_RESUME_PROMPT,
    is_default_prompt: prompt == null,
  });
});

router.put('/settings', (req, res) => {
  const { api_key, prompt } = req.body ?? {};
  // Only overwrite the key when a non-empty value is provided (so saving the
  // prompt alone doesn't wipe the key). Send api_key: '' explicitly to clear.
  if (typeof api_key === 'string') {
    if (api_key.trim()) setSetting(SETTINGS_KEYS.claudeApiKey, api_key.trim());
    else setSetting(SETTINGS_KEYS.claudeApiKey, '');
  }
  if (typeof prompt === 'string') setSetting(SETTINGS_KEYS.resumePrompt, prompt);
  const key = getSetting(SETTINGS_KEYS.claudeApiKey);
  const savedPrompt = getSetting(SETTINGS_KEYS.resumePrompt);
  res.json({
    has_api_key: !!(key && key.trim()),
    api_key_hint: key && key.trim() ? `…${key.trim().slice(-4)}` : null,
    prompt: savedPrompt ?? DEFAULT_RESUME_PROMPT,
    is_default_prompt: savedPrompt == null,
  });
});

// --- Master resume per profile ------------------------------------------------
type MasterMeta = { profile_id: number; filename: string; has_text: boolean; text_len: number; updated_at: string };

// Which profiles have a master resume (for badges on the Profiles page).
router.get('/masters', (_req, res) => {
  const rows = db.prepare(`
    SELECT profile_id, filename, updated_at,
           (text IS NOT NULL AND LENGTH(text) > 0) AS has_text,
           COALESCE(LENGTH(text), 0) AS text_len
    FROM profile_resumes
  `).all() as { profile_id: number; filename: string; updated_at: string; has_text: number; text_len: number }[];
  const out: MasterMeta[] = rows.map((r) => ({
    profile_id: r.profile_id, filename: r.filename, has_text: !!r.has_text, text_len: r.text_len, updated_at: r.updated_at,
  }));
  res.json(out);
});

router.post('/masters/:profileId', async (req, res) => {
  const profileId = Number(req.params.profileId);
  if (!Number.isFinite(profileId)) return res.status(400).json({ error: 'invalid profile' });
  const prof = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
  if (!prof) return res.status(404).json({ error: 'profile not found' });

  const { filename, mime, data } = req.body ?? {};
  if (typeof filename !== 'string' || !filename.trim()) return res.status(400).json({ error: 'filename required' });
  if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'file data required' });
  const mimeType = typeof mime === 'string' && mime ? mime : 'application/octet-stream';
  if (!isAllowedResume(mimeType, filename)) return res.status(415).json({ error: 'unsupported type — use PDF, DOC, DOCX, RTF, TXT, or TEX' });

  let buf: Buffer;
  try { buf = Buffer.from(data, 'base64'); } catch { return res.status(400).json({ error: 'invalid file data' }); }
  if (buf.length === 0) return res.status(400).json({ error: 'file is empty' });
  if (buf.length > MAX_RESUME_BYTES) return res.status(413).json({ error: 'file too large (max 8MB)' });

  const text = await extractResumeText(buf, mimeType, filename);
  db.prepare(`
    INSERT INTO profile_resumes (profile_id, filename, mime, data, text, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(profile_id) DO UPDATE SET filename = excluded.filename, mime = excluded.mime,
      data = excluded.data, text = excluded.text, updated_at = datetime('now')
  `).run(profileId, filename.trim(), mimeType, buf, text || null);

  res.json({ profile_id: profileId, filename: filename.trim(), has_text: !!text, text_len: text.length });
});

router.get('/masters/:profileId/file', (req, res) => {
  const profileId = Number(req.params.profileId);
  const row = db.prepare('SELECT filename, mime, data FROM profile_resumes WHERE profile_id = ?').get(profileId) as
    { filename: string; mime: string | null; data: Uint8Array } | undefined;
  if (!row) return res.status(404).json({ error: 'no master resume' });
  const buf = Buffer.from(row.data);
  const safe = row.filename.replace(/[^\w.\-() ]+/g, '_');
  res.setHeader('Content-Type', row.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.setHeader('Content-Length', String(buf.length));
  res.send(buf);
});

router.delete('/masters/:profileId', (req, res) => {
  db.prepare('DELETE FROM profile_resumes WHERE profile_id = ?').run(Number(req.params.profileId));
  res.status(204).end();
});

// Set (or clear) the placeholder-marked template for a profile. Body:
// { template_marked: string | null }. When present, generation uses the
// efficient placeholder path (Claude fills only marked regions).
router.put('/masters/:profileId/marked', (req, res) => {
  const profileId = Number(req.params.profileId);
  const master = db.prepare('SELECT profile_id FROM profile_resumes WHERE profile_id = ?').get(profileId);
  if (!master) return res.status(404).json({ error: 'no master resume for this profile' });
  const marked = typeof req.body?.template_marked === 'string' && req.body.template_marked.trim() ? req.body.template_marked : null;
  db.prepare(`UPDATE profile_resumes SET template_marked = ?, updated_at = datetime('now') WHERE profile_id = ?`).run(marked, profileId);
  res.json({ profile_id: profileId, has_marked: !!marked });
});

// --- Generated resumes for a day/profile -------------------------------------
type GenRow = {
  id: number; date: string; profile_id: number; link_id: number; url: string;
  company_name: string | null; jd_text: string | null; jd_source: string | null;
  resume_md: string | null; resume_tex: string | null; custom_prompt: string | null;
  status: string; error: string | null; updated_at: string;
};

// Columns for list/detail reads — everything EXCEPT the heavy resume_pdf blob.
const GEN_COLS = 'id, date, profile_id, link_id, url, company_name, jd_text, jd_source, resume_md, resume_tex, custom_prompt, status, error, updated_at';

// True when a finished resume exists — either a compiled LaTeX PDF (resume_tex
// present) or a Markdown resume (resume_md present).
function hasResume(r: GenRow): boolean {
  return !!(r.resume_tex && r.resume_tex.trim()) || !!(r.resume_md && r.resume_md.trim());
}

// Public shape (omit heavy jd_text / resume bodies from the list).
function toPublic(r: GenRow) {
  return {
    id: r.id, date: r.date, profile_id: r.profile_id, link_id: r.link_id, url: r.url,
    company_name: r.company_name, jd_source: r.jd_source, status: r.status, error: r.error,
    has_jd: !!(r.jd_text && r.jd_text.trim()), has_resume: hasResume(r),
    custom_prompt: r.custom_prompt, updated_at: r.updated_at,
  };
}

// List generation state for a day + profile.
router.get('/day/:date/:profileId', (req, res) => {
  const { date } = req.params;
  const profileId = Number(req.params.profileId);
  if (!isDateStr(date)) return res.status(400).json({ error: 'valid date required' });
  // Prune rows whose link was deleted from the day, so counts/status always
  // reflect the CURRENT links (removing every link resets the panel to empty).
  db.prepare(`DELETE FROM generated_resumes WHERE date = ? AND profile_id = ?
    AND link_id NOT IN (SELECT id FROM job_apply_links WHERE date = ?)`).run(date, profileId, date);
  // Reconcile: a row that HAS finished output (a PDF or markdown) but is still
  // marked busy is done — full stop. This is the bulletproof invariant that a
  // completed resume can never show an endless spinner, no matter how its worker
  // died (server restart mid-run, etc.). Runs every load, cheap. We exclude rows
  // still actively building in THIS process (inFlight) so a legitimate in-progress
  // regenerate isn't prematurely flipped. Note we check resume_pdf/resume_md only
  // (not resume_tex), so a LaTeX row that has its .tex but is mid-compile is left
  // alone until the PDF lands.
  {
    const candidates = db.prepare(`SELECT id FROM generated_resumes
      WHERE date = ? AND profile_id = ? AND status IN ('fetching', 'pending', 'generating')
        AND (resume_pdf IS NOT NULL OR (resume_md IS NOT NULL AND LENGTH(TRIM(resume_md)) > 0))`).all(date, profileId) as { id: number }[];
    const fix = db.prepare(`UPDATE generated_resumes SET status = 'done', error = NULL, updated_at = datetime('now') WHERE id = ?`);
    for (const c of candidates) if (!inFlight.has(c.id)) fix.run(c.id);
  }
  // Self-heal: (re)kick any row stuck at pending/generating that has a JD but no
  // running worker (e.g. orphaned by a server restart). Fires in the background;
  // the client's polling will show it move to done/error.
  sweepStalledRows(date, profileId);
  const rows = db.prepare(`SELECT ${GEN_COLS} FROM generated_resumes WHERE date = ? AND profile_id = ? ORDER BY id`).all(date, profileId) as GenRow[];
  res.json({ items: rows.map(toPublic) });
});

// Full detail for one generated resume (JD text + resume markdown) — for the
// online review pane.
router.get('/item/:id', (req, res) => {
  const row = db.prepare(`SELECT ${GEN_COLS} FROM generated_resumes WHERE id = ?`).get(Number(req.params.id)) as GenRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ...toPublic(row), jd_text: row.jd_text ?? '', resume_md: row.resume_md ?? '' });
});

// Provide/replace the JD text manually (for links that couldn't be scraped).
// Pass generate:true to also kick off generation in the background — used by the
// "Save & generate" action. A plain save (generate omitted/false) NEVER triggers
// generation, so you can edit the JD/company without spending an API call. The
// one exception: a row that has NO resume yet AND is still waiting for a JD gets
// auto-started, so a fresh unscraped link doesn't sit stuck at pending forever.
router.put('/item/:id/jd', (req, res) => {
  const row = db.prepare(`SELECT ${GEN_COLS} FROM generated_resumes WHERE id = ?`).get(Number(req.params.id)) as GenRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  const jd = typeof req.body?.jd_text === 'string' ? req.body.jd_text.trim() : '';
  const company = typeof req.body?.company_name === 'string' ? req.body.company_name.trim() : row.company_name;
  // Only "Save & generate" builds immediately; a plain save just records the JD
  // and marks the row 'ready' so it goes through the gated Generate-all.
  const shouldGenerate = !!jd && req.body?.generate === true;
  const hadResume = !!(row.resume_tex && row.resume_tex.trim()) || !!(row.resume_md && row.resume_md.trim());

  db.prepare(`UPDATE generated_resumes SET jd_text = ?, company_name = ?, jd_source = 'manual',
              status = CASE
                WHEN ? = '' THEN 'needs_jd'          -- JD cleared
                WHEN ? THEN 'pending'                -- Save & generate
                WHEN ? THEN status                   -- keep 'done' for a built row
                ELSE 'ready'                         -- JD present, awaiting Generate
              END,
              updated_at = datetime('now') WHERE id = ?`)
    .run(jd || null, company || null, jd, shouldGenerate ? 1 : 0, hadResume ? 1 : 0, row.id);

  // The JD belongs to the job posting, not the profile: fan a manually-entered
  // JD out to the SAME link's rows under OTHER profiles that don't have one yet,
  // so you never re-type the same JD per profile. Those rows flip needs_jd →
  // ready (they'll build on that profile's next gated Generate). We don't touch
  // rows that already have their own JD or a finished resume.
  if (jd) {
    db.prepare(`
      UPDATE generated_resumes
      SET jd_text = ?, company_name = COALESCE(company_name, ?), jd_source = 'manual',
          status = CASE WHEN status IN ('needs_jd', 'fetching', 'failed') THEN 'ready' ELSE status END,
          updated_at = datetime('now')
      WHERE link_id = ? AND id != ?
        AND (jd_text IS NULL OR LENGTH(TRIM(jd_text)) = 0)
        AND resume_tex IS NULL AND resume_md IS NULL
    `).run(jd, company || null, row.link_id, row.id);
  }

  if (shouldGenerate) triggerGenerateRow(row.id, row.profile_id);
  const updated = db.prepare(`SELECT ${GEN_COLS} FROM generated_resumes WHERE id = ?`).get(row.id) as GenRow;
  res.json({ ...toPublic(updated), jd_text: updated.jd_text ?? '', resume_md: updated.resume_md ?? '' });
});

// --- Generation ---------------------------------------------------------------
function requireConfig(): { apiKey: string; prompt: string } | { error: string } {
  const apiKey = getSetting(SETTINGS_KEYS.claudeApiKey);
  if (!apiKey || !apiKey.trim()) return { error: 'No Claude API key configured — add one in Resume Settings.' };
  const prompt = getSetting(SETTINGS_KEYS.resumePrompt) ?? DEFAULT_RESUME_PROMPT;
  return { apiKey: apiKey.trim(), prompt };
}

// Rows currently being generated in THIS process, so no two workers build the
// same row at once (batch run + sweeper + manual regenerate). generateOne owns
// this set — it adds on entry and removes when it settles.
const inFlight = new Set<number>();

// Fire generation for a single row in the background (loads config + master,
// then runs generateOne). Used when a manual JD is saved and by the sweeper.
// No-ops (leaving an error on the row) if config/master are missing so the UI
// shows an actionable state. Skips rows already in flight.
// Load a profile's master text + (optional) marked template in one place.
function loadMaster(profileId: number): { text: string | null; marked: string | null } | undefined {
  return db.prepare('SELECT text, template_marked AS marked FROM profile_resumes WHERE profile_id = ?').get(profileId) as
    { text: string | null; marked: string | null } | undefined;
}

function triggerGenerateRow(rowId: number, profileId: number): void {
  if (inFlight.has(rowId)) return;
  const cfg = requireConfig();
  if ('error' in cfg) {
    db.prepare(`UPDATE generated_resumes SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`).run(cfg.error, rowId);
    return;
  }
  const prof = db.prepare('SELECT name FROM profiles WHERE id = ?').get(profileId) as { name: string } | undefined;
  const master = loadMaster(profileId);
  if (!prof || !master || !master.text || !master.text.trim()) {
    db.prepare(`UPDATE generated_resumes SET status = 'error', error = 'No master resume for this profile — upload one on the Profiles page.', updated_at = datetime('now') WHERE id = ?`).run(rowId);
    return;
  }
  // generateOne guards concurrency internally via inFlight.
  void generateOne(rowId, cfg.apiKey, cfg.prompt, master.text, prof.name, master.marked)
    .catch((e) => console.error('background generation failed', e));
}

// Self-healing sweeper: pick up rows that SHOULD be generating but aren't. A row
// gets orphaned when the process restarts mid-run (its worker dies), leaving it
// stuck at 'pending'/'generating' forever. On every day-list fetch we (re)fire
// any such row that has a JD and isn't already in flight — so a stuck "Queued"
// resolves itself. Rows with no JD are left as 'needs_jd' (user must paste one).
function sweepStalledRows(date: string, profileId: number): void {
  // Only re-fire GENUINELY ORPHANED builds: stuck at pending/generating, with a
  // JD, NO output yet, NOT already in flight, and not touched for a while (so we
  // don't collide with an active batch that just queued them or a worker mid-run
  // — that collision was what left rows with a finished PDF stuck at generating).
  const stalled = db.prepare(`
    SELECT id FROM generated_resumes
    WHERE date = ? AND profile_id = ? AND status IN ('pending', 'generating')
      AND jd_text IS NOT NULL AND LENGTH(TRIM(jd_text)) > 0
      AND resume_pdf IS NULL AND (resume_md IS NULL OR LENGTH(TRIM(resume_md)) = 0)
      AND (julianday('now') - julianday(updated_at)) * 86400 > 90
  `).all(date, profileId) as { id: number }[];
  for (const r of stalled) {
    if (!inFlight.has(r.id)) triggerGenerateRow(r.id, profileId);
  }
  // Recover a JD check orphaned mid-fetch (row stuck at 'fetching' with no JD)
  // by re-running the (idempotent) prepare in the background.
  const stuckFetching = (db.prepare(`SELECT COUNT(*) AS c FROM generated_resumes
    WHERE date = ? AND profile_id = ? AND status = 'fetching'
      AND (jd_text IS NULL OR LENGTH(TRIM(jd_text)) = 0)`).get(date, profileId) as { c: number }).c;
  if (stuckFetching > 0) void prepareJds(date, profileId).catch(() => { /* best effort */ });
}

// The day's links that apply to a profile by category: a link matches if it
// shares a category with the profile, OR the link has no category at all
// (uncategorized links go to everyone). Mirrors the client's matching rule.
function linksForProfile(date: string, profileId: number): { id: number; url: string }[] {
  const profileCats = new Set(
    (db.prepare('SELECT category_id FROM profile_categories WHERE profile_id = ?').all(profileId) as { category_id: number }[]).map((r) => r.category_id),
  );
  const links = db.prepare('SELECT id, url FROM job_apply_links WHERE date = ? ORDER BY sort, id').all(date) as { id: number; url: string }[];
  const linkCats = db.prepare(`
    SELECT lc.link_id AS linkId, lc.category_id AS catId FROM link_categories lc
    JOIN job_apply_links l ON l.id = lc.link_id WHERE l.date = ?
  `).all(date) as { linkId: number; catId: number }[];
  const byLink = new Map<number, number[]>();
  for (const r of linkCats) (byLink.get(r.linkId) ?? byLink.set(r.linkId, []).get(r.linkId)!).push(r.catId);
  return links.filter((l) => {
    const cats = byLink.get(l.id) ?? [];
    if (cats.length === 0) return true;               // uncategorized → everyone
    return cats.some((c) => profileCats.has(c));       // shares a category
  });
}

// Ensure a generated_resumes row exists for every link of the day that APPLIES
// to this profile (by category), and drop rows whose link is gone / re-tagged.
// Brand-new rows start as 'fetching' (their JD is about to be checked).
function ensureRows(date: string, profileId: number) {
  const links = linksForProfile(date, profileId);
  const insert = db.prepare(`INSERT INTO generated_resumes (date, profile_id, link_id, url, status)
    VALUES (?, ?, ?, ?, 'fetching') ON CONFLICT(date, profile_id, link_id) DO NOTHING`);
  for (const l of links) insert.run(date, profileId, l.id, l.url);
  const liveIds = new Set(links.map((l) => l.id));
  const existing = db.prepare('SELECT id, link_id FROM generated_resumes WHERE date = ? AND profile_id = ?').all(date, profileId) as { id: number; link_id: number }[];
  for (const e of existing) if (!liveIds.has(e.link_id)) db.prepare('DELETE FROM generated_resumes WHERE id = ?').run(e.id);
}

// Phase 1 — check/fill the JD for every link WITHOUT building anything. A row
// that has (or gets) a JD becomes 'ready'; one that can't be fetched becomes
// 'needs_jd' (user must paste it). Returns how many still need a JD, so the
// caller can GATE building until all links have one. Rows already 'done'/
// 'generating' are left alone. JD source preference: reuse a JD from the same
// link under another profile → auto-fetch from the URL.
// Shortest text we accept as a real job description. Real JDs run to thousands of
// characters; a failed fetch typically yields a site title / nav crumb well under
// this, which must never be stored as a JD or counted as "ready".
const MIN_JD_LEN = 200;

// Does this row hold a genuine JD? A hand-typed JD counts at any length (the user
// chose it); a fetched/failed one must clear MIN_JD_LEN.
function hasRealJd(r: { jd_text: string | null; jd_source: string | null }): boolean {
  const jd = (r.jd_text ?? '').trim();
  if (!jd) return false;
  if (r.jd_source === 'manual') return true;
  return jd.length >= MIN_JD_LEN;
}

async function prepareJds(date: string, profileId: number): Promise<{ total: number; needsJd: number }> {
  ensureRows(date, profileId);
  // Mark JD-less, buildable rows as 'fetching' so the UI shows the check running.
  // "JD-less" includes rows holding only junk (a short scrape like a site title
  // that failed the fetch but got saved) — anything below MIN_JD_LEN that wasn't
  // typed by hand is not a real JD and should be re-fetched, never left 'ready'.
  db.prepare(`UPDATE generated_resumes SET status = 'fetching', updated_at = datetime('now')
    WHERE date = ? AND profile_id = ? AND status IN ('needs_jd', 'ready', 'pending')
      AND jd_source <> 'manual'
      AND (jd_text IS NULL OR LENGTH(TRIM(jd_text)) < ${MIN_JD_LEN})`).run(date, profileId);

  const rows = db.prepare(`SELECT ${GEN_COLS} FROM generated_resumes WHERE date = ? AND profile_id = ?`).all(date, profileId) as GenRow[];
  // First pass (instant, no network): resolve rows that already have a REAL JD or
  // can reuse one from the same link under another profile. Queue the rest to
  // fetch. A hand-typed JD counts at any length; a fetched one must be substantive
  // (a short scrape is a failed fetch, not a JD).
  const toFetch: GenRow[] = [];
  for (const r of rows) {
    if (r.status === 'done' || r.status === 'generating') continue;
    if (hasRealJd(r)) {
      if (r.status !== 'ready') db.prepare(`UPDATE generated_resumes SET status = 'ready', updated_at = datetime('now') WHERE id = ?`).run(r.id);
      continue;
    }
    const shared = findSharedJd(r.link_id, r.id);
    if (shared && shared.jd_text && shared.jd_text.trim().length >= MIN_JD_LEN) {
      db.prepare(`UPDATE generated_resumes SET jd_text = ?, company_name = COALESCE(?, company_name),
                  jd_source = ?, status = 'ready', updated_at = datetime('now') WHERE id = ?`)
        .run(shared.jd_text, shared.company_name, shared.jd_source ?? 'fetched', r.id);
      continue;
    }
    toFetch.push(r);
  }

  // Second pass: fetch the remaining URLs CONCURRENTLY (bounded pool) rather than
  // one-at-a-time. Each fetch has its own timeout; the old sequential loop meant a
  // handful of slow/hanging sites could stall the whole check for minutes. Each
  // row flips to ready/needs_jd as its own fetch settles, so the UI fills in fast.
  const CONCURRENCY = 6;
  let next = 0;
  const worker = async () => {
    while (next < toFetch.length) {
      const r = toFetch[next++];
      const jd = await fetchJobDescription(r.url);
      // On failure, DON'T persist the junk scrape (a short site title etc.) as the
      // JD, and don't overwrite a company with junk — leave the row needs_jd with a
      // null JD so it isn't mistaken for ready on the next check.
      const ok = jd.ok && jd.text.trim().length >= MIN_JD_LEN;
      db.prepare(`UPDATE generated_resumes SET jd_text = ?, company_name = COALESCE(?, company_name),
                  jd_source = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(ok ? jd.text : null, ok ? jd.company : null, ok ? 'fetched' : 'failed', ok ? 'ready' : 'needs_jd', r.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));

  const needsJd = (db.prepare(`SELECT COUNT(*) AS c FROM generated_resumes WHERE date = ? AND profile_id = ? AND status = 'needs_jd'`).get(date, profileId) as { c: number }).c;
  return { total: rows.length, needsJd };
}

// Find a JD already stored for the same link under a different profile row,
// preferring a manually-entered one. Lets a JD typed for one profile serve all.
function findSharedJd(linkId: number, excludeRowId: number): { jd_text: string; company_name: string | null; jd_source: string | null } | null {
  const row = db.prepare(`
    SELECT jd_text, company_name, jd_source FROM generated_resumes
    WHERE link_id = ? AND id != ? AND jd_text IS NOT NULL AND LENGTH(TRIM(jd_text)) > 0
    ORDER BY (jd_source = 'manual') DESC, updated_at DESC
    LIMIT 1
  `).get(linkId, excludeRowId) as { jd_text: string; company_name: string | null; jd_source: string | null } | undefined;
  return row ?? null;
}

// Tailor one row (must have JD text + master resume). For a LaTeX master, this
// tailors the placeholder content (or the whole file), splices it into the
// template, and compiles a PDF with Tectonic — storing resume_tex + resume_pdf.
// For a plain-text master it produces Markdown (resume_md) as before.
async function generateOne(rowId: number, apiKey: string, globalPrompt: string, masterText: string, profileName: string, markedTemplate: string | null) {
  // Guard against two workers building the same row at once (batch run + sweeper,
  // or an overlapping manual regenerate). A concurrent second run is what left a
  // row with a finished PDF but stuck at 'generating'. Only one owner proceeds.
  if (inFlight.has(rowId)) return;
  inFlight.add(rowId);
  try {
    const r = db.prepare(`SELECT ${GEN_COLS}, resume_pdf FROM generated_resumes WHERE id = ?`).get(rowId) as (GenRow & { resume_pdf: Uint8Array | null }) | undefined;
    if (!r) return;
    // Already finished (a build wrote its output while this call was queued, e.g.
    // batch + sweeper both targeting the row). Don't rebuild — just make sure the
    // status reflects the completed output, and stop. This prevents the "has a
    // PDF but stuck at generating" state where a second run resets a done row.
    if (r.resume_pdf || (r.resume_md && r.resume_md.trim())) {
      if (r.status !== 'done') db.prepare(`UPDATE generated_resumes SET status = 'done', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(rowId);
      return;
    }
    if (!r.jd_text || !r.jd_text.trim()) {
      db.prepare(`UPDATE generated_resumes SET status = 'needs_jd', updated_at = datetime('now') WHERE id = ?`).run(rowId);
      return;
    }
    db.prepare(`UPDATE generated_resumes SET status = 'generating', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(rowId);
    if (isLatexMaster(masterText)) {
      // Tailor first, then compile. Persist the tailored .tex up front so a
      // compile failure still leaves the source for debugging/inspection.
      const tex = await tailorLatexTex(apiKey, globalPrompt, masterText, markedTemplate, r);
      db.prepare(`UPDATE generated_resumes SET resume_tex = ?, resume_md = NULL, updated_at = datetime('now') WHERE id = ?`).run(tex, rowId);
      const pdf = await compileLatex(tex);
      db.prepare(`UPDATE generated_resumes SET resume_pdf = ?, status = 'done', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(pdf, rowId);
    } else {
      const md = await tailorResume({
        apiKey, globalPrompt, customPrompt: r.custom_prompt, masterResumeText: masterText,
        jobDescription: r.jd_text, profileName, companyName: r.company_name,
      });
      db.prepare(`UPDATE generated_resumes SET resume_md = ?, resume_tex = NULL, resume_pdf = NULL, status = 'done', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(md, rowId);
    }
  } catch (e) {
    const msg = e instanceof LatexError ? `LaTeX compile failed: ${e.message}`
      : e instanceof ResumeGenError ? e.message
      : (e instanceof Error ? e.message : String(e));
    db.prepare(`UPDATE generated_resumes SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`).run(msg, rowId);
  } finally {
    inFlight.delete(rowId);
  }
}

// LaTeX path step 1: tailor content → splice into the template. Returns the
// final .tex WITHOUT compiling (so the caller can persist it even if the
// subsequent compile fails, for debugging).
//   originalText  — the master with REAL content (Claude's fact source).
//   markedTemplate — same doc with %%PLACEHOLDER%% markers (splice target).
//                    When absent/marker-less, falls back to the full-file rewrite.
// True when the profile is in the "Enterprise Platforms" category, whose resumes
// take their job TITLES from the target JD (see injectTitlePlaceholders) rather
// than the template's fixed titles.
function profileWantsJdTitles(profileId: number): boolean {
  const row = db.prepare(`
    SELECT 1 FROM profile_categories pc JOIN categories c ON c.id = pc.category_id
    WHERE pc.profile_id = ? AND LOWER(TRIM(c.name)) = 'enterprise platforms' LIMIT 1
  `).get(profileId);
  return !!row;
}

async function tailorLatexTex(apiKey: string, globalPrompt: string, originalText: string, markedTemplate: string | null, r: GenRow): Promise<string> {
  // For "Enterprise Platforms" profiles, turn each experience title into a
  // %%TITLE_n%% placeholder so titles track the target job (companies/dates/bullets
  // stay put). No-op for other profiles and for templates without an Experience
  // section.
  if (markedTemplate && profileWantsJdTitles(r.profile_id)) {
    const injected = injectTitlePlaceholders(markedTemplate);
    if (injected.count > 0) markedTemplate = injected.template;
  }
  const scan = markedTemplate ? scanPlaceholders(markedTemplate) : { style: -1, names: [] as string[] };
  if (markedTemplate && scan.names.length > 0) {
    // Some markers are filled by CODE from the profile (not Claude) — currently
    // just %%HEADER%% (name/email/phone/links), so editing a profile flows into
    // every resume without touching the template. Split those out.
    const codeFilled: Record<string, string> = {};
    if (scan.names.includes('HEADER')) {
      const p = db.prepare('SELECT name, gmail, gv, full_address, linkedin_url FROM profiles WHERE id = ?').get(r.profile_id) as
        { name: string; gmail: string | null; gv: string | null; full_address: string | null; linkedin_url: string | null } | undefined;
      if (p) {
        codeFilled.HEADER = buildResumeHeader({
          name: p.name, email: p.gmail, phone: p.gv, address: p.full_address, linkedin: p.linkedin_url,
        });
      }
    }
    const claudeNames = scan.names.filter((n) => !(n in codeFilled));
    // Placeholder mode — Claude fills only the CONTENT sections (cheap output).
    // It sees the ORIGINAL (with real bullets) as the source of truth, but we
    // splice its output into the MARKED template.
    const content = claudeNames.length > 0 ? await tailorLatexPlaceholders({
      apiKey, globalPrompt, customPrompt: r.custom_prompt, masterTemplate: originalText,
      placeholderNames: claudeNames, jobDescription: r.jd_text!, profileName: '', companyName: r.company_name,
    }) : {};
    return spliceTemplate(markedTemplate, scan.style, { ...content, ...codeFilled });
  }
  // No markers — Claude rewrites the whole document (preamble preserved).
  return tailorLatexFull({
    apiKey, globalPrompt, customPrompt: r.custom_prompt, masterTemplate: originalText,
    jobDescription: r.jd_text!, profileName: '', companyName: r.company_name,
  });
}

// Validate a day+profile is ready to generate; returns the matching links or an
// error response object. Shared by prepare + generate.
function checkGenerable(date: string, profileId: number): { prof: { id: number; name: string }; masterText: string; marked: string | null } | { status: number; error: string } {
  const prof = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(profileId) as { id: number; name: string } | undefined;
  if (!prof) return { status: 404, error: 'profile not found' };
  const master = loadMaster(profileId);
  if (!master || !master.text || !master.text.trim()) {
    return { status: 400, error: `No master resume with readable text for ${prof.name}. Upload one on the Profiles page.` };
  }
  const matching = linksForProfile(date, profileId);
  if (matching.length === 0) {
    const anyLinks = (db.prepare('SELECT COUNT(*) AS c FROM job_apply_links WHERE date = ?').get(date) as { c: number }).c;
    return { status: 400, error: anyLinks === 0 ? 'no job links for this day'
      : `None of this day's links match ${prof.name}'s categories. Tag some links, or assign categories to this profile.` };
  }
  return { prof, masterText: master.text, marked: master.marked };
}

// PHASE 1 — Prepare: create rows + check/fetch every link's JD, WITHOUT building
// any resume. Responds immediately; the client polls GET /day to watch the check
// and to see which links still need a JD. This is what the "Generate" button
// calls first — the user is then asked to fill any missing JDs before building.
router.post('/prepare/:date/:profileId', async (req, res) => {
  const { date } = req.params;
  const profileId = Number(req.params.profileId);
  if (!isDateStr(date)) return res.status(400).json({ error: 'valid date required' });
  const chk = checkGenerable(date, profileId);
  if ('error' in chk) return res.status(chk.status).json({ error: chk.error });

  // Mark buildable JD-less rows as 'fetching' up front so the UI reflects it now.
  db.prepare(`UPDATE generated_resumes SET status = 'fetching', updated_at = datetime('now')
    WHERE date = ? AND profile_id = ? AND status IN ('needs_jd', 'ready', 'pending')
      AND (jd_text IS NULL OR LENGTH(TRIM(jd_text)) = 0)`).run(date, profileId);
  res.json({ ok: true, started: true });
  void prepareJds(date, profileId).catch((e) => console.error('JD prepare failed', e));
});

// PHASE 2 — Generate: build resumes for the day+profile. GATED: refuses if any
// applicable link still lacks a JD (the user must add them first). Only rows
// that are 'ready'/'pending' (JD present, not yet built) are tailored.
router.post('/generate/:date/:profileId', async (req, res) => {
  const { date } = req.params;
  const profileId = Number(req.params.profileId);
  if (!isDateStr(date)) return res.status(400).json({ error: 'valid date required' });
  const cfg = requireConfig();
  if ('error' in cfg) return res.status(400).json({ error: cfg.error });
  const chk = checkGenerable(date, profileId);
  if ('error' in chk) return res.status(chk.status).json({ error: chk.error });
  const { prof, masterText, marked } = chk;

  // Make sure rows exist and JDs are resolved before gating on them.
  const { needsJd } = await prepareJds(date, profileId);
  if (needsJd > 0) {
    return res.status(409).json({
      error: `${needsJd} link${needsJd === 1 ? '' : 's'} still need a job description. Add ${needsJd === 1 ? 'it' : 'them'} first, then generate.`,
      needs_jd: needsJd,
    });
  }

  // Build every row that has a JD but isn't done yet.
  const rows = db.prepare(`SELECT id FROM generated_resumes WHERE date = ? AND profile_id = ? AND status IN ('ready', 'pending', 'generating') AND jd_text IS NOT NULL AND LENGTH(TRIM(jd_text)) > 0`).all(date, profileId) as { id: number }[];
  // Flag them queued immediately so the UI shows progress right away.
  db.prepare(`UPDATE generated_resumes SET status = 'pending', updated_at = datetime('now')
    WHERE date = ? AND profile_id = ? AND status = 'ready'`).run(date, profileId);
  res.json({ ok: true, started: true, count: rows.length });

  void (async () => {
    try {
      for (const row of rows) {
        await generateOne(row.id, cfg.apiKey, cfg.prompt, masterText, prof.name, marked);
      }
    } catch (e) {
      console.error('resume generation run failed', e);
    }
  })();
});

// Regenerate a single resume, optionally with a custom per-resume prompt.
router.post('/item/:id/regenerate', async (req, res) => {
  const row = db.prepare(`SELECT ${GEN_COLS} FROM generated_resumes WHERE id = ?`).get(Number(req.params.id)) as GenRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  const cfg = requireConfig();
  if ('error' in cfg) return res.status(400).json({ error: cfg.error });
  const prof = db.prepare('SELECT name FROM profiles WHERE id = ?').get(row.profile_id) as { name: string } | undefined;
  if (!prof) return res.status(404).json({ error: 'profile not found' });
  const master = loadMaster(row.profile_id);
  if (!master || !master.text || !master.text.trim()) return res.status(400).json({ error: 'no master resume text for this profile' });

  // Persist the custom prompt (empty string clears it back to global-only).
  if (typeof req.body?.custom_prompt === 'string') {
    const cp = req.body.custom_prompt.trim();
    db.prepare(`UPDATE generated_resumes SET custom_prompt = ?, updated_at = datetime('now') WHERE id = ?`).run(cp || null, row.id);
  }

  // Mark as generating and do the (slow) tailor+compile in the BACKGROUND, then
  // respond immediately. A synchronous Claude call + LaTeX compile easily exceeds
  // the client's per-request timeout; the review modal polls GET /item/:id until
  // this leaves the 'generating' state.
  const masterText = master.text;
  const marked = master.marked;
  // Clear the existing output so generateOne's "already has output → skip" guard
  // (which protects batch/sweeper against double-runs) doesn't no-op an EXPLICIT
  // regenerate. Without this, hitting Regenerate did nothing.
  db.prepare(`UPDATE generated_resumes SET resume_tex = NULL, resume_pdf = NULL, resume_md = NULL, status = 'generating', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(row.id);
  res.json({ ok: true, started: true, id: row.id });
  void generateOne(row.id, cfg.apiKey, cfg.prompt, masterText, prof.name, marked)
    .catch((e) => console.error('regenerate failed', e));
});

// Manually edit the resume markdown (after online review tweaks).
router.put('/item/:id/resume', (req, res) => {
  const row = db.prepare('SELECT id FROM generated_resumes WHERE id = ?').get(Number(req.params.id)) as { id: number } | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  const md = typeof req.body?.resume_md === 'string' ? req.body.resume_md : '';
  db.prepare(`UPDATE generated_resumes SET resume_md = ?, status = CASE WHEN ? = '' THEN status ELSE 'done' END, updated_at = datetime('now') WHERE id = ?`)
    .run(md || null, md, row.id);
  const updated = db.prepare(`SELECT ${GEN_COLS} FROM generated_resumes WHERE id = ?`).get(row.id) as GenRow;
  res.json({ ...toPublic(updated), jd_text: updated.jd_text ?? '', resume_md: updated.resume_md ?? '' });
});

// Live PDF preview of one resume (inline, not an attachment). Serves the
// compiled LaTeX PDF when present, else renders the Markdown resume.
router.get('/item/:id/pdf', async (req, res) => {
  const row = db.prepare('SELECT resume_md, resume_pdf FROM generated_resumes WHERE id = ?').get(Number(req.params.id)) as
    { resume_md: string | null; resume_pdf: Uint8Array | null } | undefined;
  if (!row) return res.status(404).json({ error: 'no resume yet' });
  try {
    let pdf: Buffer;
    if (row.resume_pdf) pdf = Buffer.from(row.resume_pdf);
    else if (row.resume_md) pdf = await renderResumePdf(row.resume_md);
    else return res.status(404).json({ error: 'no resume yet' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="resume.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'pdf render failed' });
  }
});

// --- ZIP download -------------------------------------------------------------
// Sanitize a path segment for a ZIP entry. Keeps it filesystem-friendly.
function safeSeg(s: string, fallback: string): string {
  const cleaned = (s || '').replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return cleaned || fallback;
}

router.get('/zip/:date/:profileId', (req, res) => {
  const { date } = req.params;
  const profileId = Number(req.params.profileId);
  if (!isDateStr(date)) return res.status(400).json({ error: 'valid date required' });
  const prof = db.prepare('SELECT name FROM profiles WHERE id = ?').get(profileId) as { name: string } | undefined;
  if (!prof) return res.status(404).json({ error: 'profile not found' });
  // Include the resume bodies AND the compiled PDF blob (needed to build the ZIP).
  const rows = db.prepare(`SELECT ${GEN_COLS}, resume_pdf FROM generated_resumes
    WHERE date = ? AND profile_id = ? AND status = 'done' AND (resume_md IS NOT NULL OR resume_pdf IS NOT NULL)
    ORDER BY id`).all(date, profileId) as (GenRow & { resume_pdf: Uint8Array | null })[];
  if (rows.length === 0) return res.status(400).json({ error: 'no completed resumes to download' });

  // Zip name: M/D_profile_name (matches the requested "7/1_chris_lewis"). The
  // slash isn't filename-safe, so use a hyphen in the actual download filename
  // while keeping the requested shape.
  const [, mm, dd] = date.split('-').map(Number) as unknown as [number, number, number];
  const dparts = date.split('-');
  const niceDate = `${Number(dparts[1])}-${Number(dparts[2])}`; // e.g. 7-1
  const profSlug = safeSeg(prof.name, 'profile').replace(/\s+/g, '_').toLowerCase();
  const zipName = `${niceDate}_${profSlug}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { try { res.status(500).end(); } catch { /* already sent */ } console.error('zip error', err); });
  archive.pipe(res);

  // Number each folder (1. Netsuite, 2. Oracle, …) for easy distinction, and
  // deduplicate names when two postings share a company.
  const used = new Map<string, number>();
  const pdfPromises: Promise<void>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let name = safeSeg(r.company_name || '', `Company_${i + 1}`);
    const seen = used.get(name.toLowerCase()) ?? 0;
    used.set(name.toLowerCase(), seen + 1);
    if (seen > 0) name = `${name} (${seen + 1})`;
    const folder = `${i + 1}. ${name}`;

    // JD.txt — include the source URL as a header line for reference.
    const jd = `Source: ${r.url}\n\n${r.jd_text ?? ''}`;
    archive.append(jd, { name: `${folder}/JD.txt` });

    // resume.pdf — use the compiled LaTeX PDF if present, else render Markdown.
    if (r.resume_pdf) {
      archive.append(Buffer.from(r.resume_pdf), { name: `${folder}/resume.pdf` });
    } else if (r.resume_md) {
      pdfPromises.push(
        renderResumePdf(r.resume_md).then((pdf) => { archive.append(pdf, { name: `${folder}/resume.pdf` }); }),
      );
    }
  }

  Promise.all(pdfPromises)
    .then(() => archive.finalize())
    .catch((err) => { console.error('zip build failed', err); try { res.status(500).end(); } catch { /* sent */ } });
});

export default router;
