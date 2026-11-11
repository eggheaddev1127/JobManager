import { Router } from 'express';
import { db } from '../db.js';
const router = Router();
const COLS = [
    'date', 'meeting_slot', 'country', 'profile_name', 'company_name',
    'step', 'step_details', 'agency_recruiter_id', 'agency_name', 'progress',
    'meeting_url', 'jd_url', 'recording_url', 'notes', 'handler', 'last_followed_up_at',
    'meeting_type', 'recurrence',
];
// Resume upload constraints. Kept loose — we accept common document types.
const MAX_RESUME_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_RESUME_MIME = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/rtf',
]);
// Pipeline identity = (profile, company), matched CASE-INSENSITIVELY so
// "Corelight" and "corelight" are the same pipeline (shared resume + JD).
function pipelineKey(row) {
    return `${(row.profile_name ?? '').trim().toLowerCase()}::${(row.company_name ?? '').trim().toLowerCase()}`;
}
// Allowed repeat frequencies. Anything else (including 'none', '', or unknown
// strings) is stored as NULL — i.e. a one-off, non-recurring interview.
const RECURRENCE_VALUES = new Set(['daily', 'weekday', 'weekly', 'biweekly', 'monthly', 'yearly']);
function normalizeRecurrence(v) {
    return typeof v === 'string' && RECURRENCE_VALUES.has(v) ? v : null;
}
const keyOf = (r) => `${(r.profile_name ?? '').trim().toLowerCase()}::${(r.company_name ?? '').trim().toLowerCase()}`;
function computeResumeGroups(rows) {
    const parent = new Map();
    const add = (k) => { if (!parent.has(k))
        parent.set(k, k); };
    const find = (x) => {
        let root = x;
        while (parent.get(root) !== root)
            root = parent.get(root);
        while (parent.get(x) !== x) {
            const next = parent.get(x);
            parent.set(x, root);
            x = next;
        }
        return root;
    };
    const union = (a, b) => {
        add(a);
        add(b);
        const ra = find(a), rb = find(b);
        if (ra === rb)
            return;
        // Attach the larger key under the smaller for a deterministic canonical key.
        if (ra < rb)
            parent.set(rb, ra);
        else
            parent.set(ra, rb);
    };
    const byId = new Map();
    for (const r of rows) {
        byId.set(r.id, r);
        add(keyOf(r));
    }
    for (const r of rows) {
        if (r.agency_recruiter_id != null) {
            const ar = byId.get(Number(r.agency_recruiter_id));
            if (ar)
                union(keyOf(r), keyOf(ar));
        }
    }
    const canonOf = new Map();
    for (const k of parent.keys())
        canonOf.set(k, find(k));
    const keysByCanon = new Map();
    for (const [k, c] of canonOf) {
        const arr = keysByCanon.get(c) ?? [];
        arr.push(k);
        keysByCanon.set(c, arr);
    }
    return { canonOf, keysByCanon };
}
// Resolve an interview id to its resume group: the pipeline key, the handler
// (for dev scoping), and every pipeline key sharing the group.
function resolveGroup(id) {
    const rows = db.prepare('SELECT id, profile_name, company_name, agency_recruiter_id, handler FROM interviews')
        .all();
    const target = rows.find((r) => r.id === id);
    if (!target)
        return null;
    const { canonOf, keysByCanon } = computeResumeGroups(rows);
    const key = keyOf(target);
    const canon = canonOf.get(key) ?? key;
    return { key, handler: target.handler, groupKeys: keysByCanon.get(canon) ?? [key] };
}
// Normalised `${profile}::${company}` keys (lowercased) for every Job Apply row
// that holds a real JD. Matches the lowercased pipelineKey() so we can tell which
// pipelines have a job description on file.
function jdKeySet() {
    const set = new Set();
    for (const r of db.prepare(`
    SELECT p.name AS profile, g.company_name AS company
    FROM generated_resumes g JOIN profiles p ON p.id = g.profile_id
    WHERE g.jd_text IS NOT NULL AND LENGTH(TRIM(g.jd_text)) > 0
  `).all()) {
        set.add(`${(r.profile ?? '').trim().toLowerCase()}::${(r.company ?? '').trim().toLowerCase()}`);
    }
    return set;
}
// Newest JD text saved for any (profile, company) in this pipeline group.
function findPipelineJd(groupKeys) {
    const wanted = new Set(groupKeys.map((k) => k.toLowerCase()));
    const rows = db.prepare(`
    SELECT p.name AS profile, g.company_name AS company, g.jd_text AS jd_text
    FROM generated_resumes g JOIN profiles p ON p.id = g.profile_id
    WHERE g.jd_text IS NOT NULL AND LENGTH(TRIM(g.jd_text)) > 0
    ORDER BY g.updated_at DESC
  `).all();
    for (const r of rows) {
        const key = `${(r.profile ?? '').trim().toLowerCase()}::${(r.company ?? '').trim().toLowerCase()}`;
        if (wanted.has(key))
            return { jd_text: r.jd_text, company_name: r.company };
    }
    return null;
}
// Canonical step ordering — must match the client's STEPS constant.
// Used to determine the FIRST step of a pipeline (lowest index).
const STEP_ORDER = {
    'agency recruiter': 1,
    'intro': 2,
    'client screen': 3,
    'hiring manager': 4,
    'tech screen': 5,
    'job': 6,
};
function stepIndex(step) {
    if (!step)
        return 999;
    return STEP_ORDER[step.toLowerCase()] ?? 999;
}
function stepNameAtIndex(idx) {
    for (const [name, i] of Object.entries(STEP_ORDER)) {
        if (i === idx)
            return name;
    }
    return null;
}
router.get('/', (req, res) => {
    // ALWAYS read the full interviews table so pipeline status reflects what every
    // handler has done — not just rows the requester (a dev) can see. This is the
    // crucial bit that lets dev A's pipeline go "failed" when dev B fails a later
    // step at the same (profile, company).
    const allRows = db.prepare(`
    SELECT * FROM interviews
    ORDER BY (date IS NULL OR date = '') ASC, date DESC, id DESC
  `).all();
    // Pipeline summary: pipeline = (profile_name, company_name).
    //
    // status precedence (highest first):
    //   'failed'   — any row has progress=Failed (terminal loss)
    //   'complete' — any row has step=Job (candidate is working there; pipeline is done, not live)
    //   'passed'   — any row has progress=Passed (and not failed/complete)
    //   'pending'  — otherwise
    //
    // first_step_passed — see below. This is the "live" criterion used by the
    // client. Special cases:
    //   - If the pipeline's first step is Agency Recruiter, it is NEVER live
    //     (agency intros are stepping stones, not client engagement).
    //   - If the pipeline's first step is Client Screen and the candidate's
    //     Client Screen row links to an Agency Recruiter row (any pipeline) that
    //     was Passed, mark first_step_passed = true (the agency forwarded them
    //     to the client, even if Client Screen itself is still Waiting).
    //   - Otherwise: first_step_passed is true iff some row at the earliest
    //     canonical step is Passed.
    // Index every row by id so Client Screen → linked Agency Recruiter lookups work.
    const byId = new Map();
    for (const r of allRows)
        byId.set(r.id, r);
    // First pass: status + earliest-step bookkeeping.
    const pipelines = new Map();
    for (const r of allRows) {
        const key = pipelineKey(r);
        const cur = pipelines.get(key) ?? {
            profile_name: r.profile_name ?? '',
            company_name: r.company_name ?? '',
            status: 'pending',
            rows: [],
            latest_step: r.step ?? null,
            first_step_index: 999,
            first_step_passed: false,
        };
        cur.rows.push(r);
        if (cur.latest_step === null)
            cur.latest_step = r.step;
        const prog = (r.progress ?? '').toLowerCase();
        const step = (r.step ?? '').toLowerCase();
        const idx = stepIndex(r.step);
        if (idx < cur.first_step_index) {
            cur.first_step_index = idx;
            cur.first_step_passed = prog === 'passed';
        }
        else if (idx === cur.first_step_index && prog === 'passed') {
            cur.first_step_passed = true;
        }
        if (prog === 'failed') {
            cur.status = 'failed';
        }
        else if (cur.status !== 'failed' && step === 'job') {
            cur.status = 'complete';
        }
        else if (cur.status !== 'failed' && cur.status !== 'complete' && prog === 'passed') {
            cur.status = 'passed';
        }
        pipelines.set(key, cur);
    }
    // Second pass: apply special live rules per pipeline.
    for (const cur of pipelines.values()) {
        const firstStepName = stepNameAtIndex(cur.first_step_index);
        if (firstStepName === 'agency recruiter') {
            // Agency Recruiter as the first (and earliest) step → never live.
            cur.first_step_passed = false;
            continue;
        }
        if (firstStepName === 'client screen') {
            // Live if any Client Screen row in this pipeline references a passed AR.
            const csRows = cur.rows.filter((r) => stepIndex(r.step) === STEP_ORDER['client screen']);
            const linkedARPassed = csRows.some((r) => {
                if (r.agency_recruiter_id == null)
                    return false;
                const ar = byId.get(Number(r.agency_recruiter_id));
                return ar != null && (ar.progress ?? '').toLowerCase() === 'passed';
            });
            if (linkedARPassed) {
                cur.first_step_passed = true;
            }
            // Otherwise leave first_step_passed as already computed (Client Screen
            // itself passed → live; not passed → not live).
        }
    }
    // Now filter visible rows for non-admins (handlerFilter set by middleware).
    const handlerFilter = req.handlerFilter;
    const visibleRows = handlerFilter
        ? allRows.filter((r) => (r.handler ?? '').toLowerCase() === handlerFilter.toLowerCase())
        : allRows;
    // Resume filenames, resolved per GROUP (pipelines joined by AR links share
    // one resume). Map each stored pipeline_key's filename onto its group canon,
    // then read it back via each interview's canon.
    const { canonOf } = computeResumeGroups(allRows);
    const canonResume = new Map();
    for (const r of db.prepare('SELECT pipeline_key, filename FROM pipeline_resumes').all()) {
        // Lowercase the stored key so lookups stay case-insensitive even if a legacy
        // row wasn't migrated.
        const k = r.pipeline_key.toLowerCase();
        canonResume.set(canonOf.get(k) ?? k, r.filename);
    }
    // JD availability, resolved per GROUP like the resume. A pipeline "has a JD"
    // when Job Apply holds a saved (fetched or typed) job description for the same
    // (profile, company) — matched case-insensitively. Surfaced so you can prep
    // from the exact posting; the text itself is fetched on demand via /:id/jd.
    const jdKeys = jdKeySet();
    const canonJd = new Set();
    // JD URL shared across the pipeline group: if ANY interview in the group has a
    // jd_url, every interview in it shows that link (like the shared resume). Fixes
    // e.g. a later Corelight round whose own jd_url was left blank.
    const canonJdUrl = new Map();
    for (const r of allRows) {
        const key = pipelineKey(r);
        const canon = canonOf.get(key) ?? key;
        if (jdKeys.has(key))
            canonJd.add(canon);
        if (!canonJdUrl.has(canon) && r.jd_url && r.jd_url.trim())
            canonJdUrl.set(canon, r.jd_url.trim());
    }
    // Job Apply tailored resume per (profile, company). Shown in the interview
    // details when NO resume was uploaded to the pipeline — so a resume built
    // during application still appears (matching the editor's "already on file"
    // heads-up, which also counts it). Newest wins.
    const jaResumeByKey = new Map();
    for (const r of db.prepare(`
    SELECT p.name AS profile, g.company_name AS company, g.id AS gid
    FROM generated_resumes g JOIN profiles p ON p.id = g.profile_id
    WHERE g.status = 'done' AND (g.resume_pdf IS NOT NULL OR (g.resume_md IS NOT NULL AND LENGTH(TRIM(g.resume_md)) > 0))
    ORDER BY g.updated_at ASC
  `).all()) {
        jaResumeByKey.set(`${(r.profile ?? '').trim().toLowerCase()}::${(r.company ?? '').trim().toLowerCase()}`, r.gid);
    }
    // Attach global pipeline status + first-step-passed flag to each visible row.
    const enriched = visibleRows.map((r) => {
        const key = pipelineKey(r);
        const canon = canonOf.get(key) ?? key;
        const p = pipelines.get(key);
        return {
            ...r,
            pipeline_key: key,
            pipeline_status: p?.status ?? 'pending',
            pipeline_first_step_passed: p?.first_step_passed ?? false,
            resume_filename: canonResume.get(canon) ?? null,
            has_jd: canonJd.has(canon),
            pipeline_jd_url: canonJdUrl.get(canon) ?? null,
            ja_resume_id: jaResumeByKey.get(key) ?? null,
        };
    });
    res.json({
        interviews: enriched,
        pipelines: Array.from(pipelines.values()),
    });
});
// Distinct company names already used on interviews — powers the company-name
// autocomplete in the editor so users pick an existing spelling (avoiding typos
// and case mismatches that would split a pipeline). Newest-used first.
router.get('/companies', (_req, res) => {
    const rows = db.prepare(`
    SELECT company_name AS name, MAX(COALESCE(date, '')) AS last
    FROM interviews
    WHERE company_name IS NOT NULL AND TRIM(company_name) <> ''
    GROUP BY company_name
    ORDER BY last DESC, name COLLATE NOCASE
  `).all();
    res.json({ companies: rows.map((r) => r.name) });
});
// What already exists for a (profile, company) pipeline — used by the editor to
// show a heads-up (JD link/content + resume) BEFORE an interview is created, even
// for the very first round. Pulls from earlier interviews AND from Job Apply.
router.get('/pipeline-preview', (req, res) => {
    const profile = String(req.query.profile ?? '').trim().toLowerCase();
    const company = String(req.query.company ?? '').trim().toLowerCase();
    const empty = { jd_url: null, jd_text: null, resume_filename: null, resume_interview_id: null, ja_resume_id: null };
    if (!profile || !company)
        return res.json(empty);
    const key = `${profile}::${company}`;
    // JD URL from any earlier interview in this pipeline.
    const jdUrlRow = db.prepare(`
    SELECT jd_url FROM interviews
    WHERE LOWER(TRIM(profile_name)) = ? AND LOWER(TRIM(company_name)) = ?
      AND jd_url IS NOT NULL AND TRIM(jd_url) <> ''
    ORDER BY COALESCE(date,'') DESC LIMIT 1`).get(profile, company);
    // JD content saved in Job Apply for this pipeline.
    const jd = findPipelineJd([key]);
    // Uploaded resume shared across this pipeline + an interview id to download it.
    const resumeRow = db.prepare(`SELECT filename FROM pipeline_resumes WHERE LOWER(pipeline_key) = ? LIMIT 1`).get(key);
    const ivRow = db.prepare(`SELECT id FROM interviews WHERE LOWER(TRIM(profile_name)) = ? AND LOWER(TRIM(company_name)) = ? ORDER BY COALESCE(date,'') DESC LIMIT 1`).get(profile, company);
    // Tailored resume built in Job Apply for this profile + company (downloadable).
    const jaResume = db.prepare(`
    SELECT g.id FROM generated_resumes g JOIN profiles p ON p.id = g.profile_id
    WHERE LOWER(p.name) = ? AND LOWER(g.company_name) = ? AND g.status = 'done'
      AND (g.resume_pdf IS NOT NULL OR (g.resume_md IS NOT NULL AND LENGTH(TRIM(g.resume_md)) > 0))
    ORDER BY g.updated_at DESC LIMIT 1`).get(profile, company);
    res.json({
        jd_url: jdUrlRow?.jd_url ?? null,
        jd_text: jd?.jd_text ?? null,
        resume_filename: resumeRow?.filename ?? null,
        resume_interview_id: resumeRow ? (ivRow?.id ?? null) : null,
        ja_resume_id: jaResume?.id ?? null,
    });
});
router.post('/', (req, res) => {
    if (req.handlerFilter)
        return res.status(403).json({ error: 'only admins can create interviews' });
    const body = req.body ?? {};
    const arId = body.agency_recruiter_id;
    const values = {
        date: body.date ?? null,
        meeting_slot: body.meeting_slot ?? null,
        country: body.country ?? null,
        profile_name: body.profile_name ?? null,
        company_name: body.company_name ?? null,
        step: body.step ?? null,
        step_details: body.step_details ?? null,
        agency_recruiter_id: arId == null || arId === '' ? null : Number(arId),
        agency_name: body.agency_name ?? null,
        progress: body.progress ?? 'Not started',
        meeting_url: body.meeting_url ?? null,
        jd_url: body.jd_url ?? null,
        recording_url: body.recording_url ?? null,
        notes: body.notes ?? null,
        handler: body.handler ?? null,
        last_followed_up_at: body.last_followed_up_at ?? null,
        meeting_type: body.meeting_type ?? null,
        recurrence: normalizeRecurrence(body.recurrence),
    };
    const info = db.prepare(`
    INSERT INTO interviews (date, meeting_slot, country, profile_name, company_name, step, step_details, agency_recruiter_id, agency_name, progress, meeting_url, jd_url, recording_url, notes, handler, last_followed_up_at, meeting_type, recurrence)
    VALUES (@date, @meeting_slot, @country, @profile_name, @company_name, @step, @step_details, @agency_recruiter_id, @agency_name, @progress, @meeting_url, @jd_url, @recording_url, @notes, @handler, @last_followed_up_at, @meeting_type, @recurrence)
  `).run(values);
    res.status(201).json(db.prepare('SELECT * FROM interviews WHERE id = ?').get(info.lastInsertRowid));
});
// Mark an interview as "followed up today". Resets the follow-up timer so the
// badge disappears for one wait period (7d for Intro, 3d otherwise). If status
// remains Waiting past that period, the badge reappears.
router.post('/:id/follow-up', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM interviews WHERE id = ?').get(id);
    if (!existing)
        return res.status(404).json({ error: 'not found' });
    if (req.handlerFilter) {
        const owner = String(existing.handler ?? '').toLowerCase();
        if (owner !== req.handlerFilter.toLowerCase())
            return res.status(403).json({ error: 'forbidden' });
    }
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("UPDATE interviews SET last_followed_up_at = ?, updated_at = datetime('now') WHERE id = ?").run(today, id);
    res.json(db.prepare('SELECT * FROM interviews WHERE id = ?').get(id));
});
router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM interviews WHERE id = ?').get(id);
    if (!existing)
        return res.status(404).json({ error: 'not found' });
    if (req.handlerFilter) {
        const owner = String(existing.handler ?? '').toLowerCase();
        if (owner !== req.handlerFilter.toLowerCase())
            return res.status(403).json({ error: 'forbidden' });
    }
    const merged = { ...existing };
    if (req.handlerFilter) {
        // Devs can only update notes + recording URL; everything else is silently ignored.
        if ('notes' in req.body)
            merged.notes = req.body.notes;
        if ('recording_url' in req.body)
            merged.recording_url = req.body.recording_url;
    }
    else {
        for (const c of COLS) {
            if (c in req.body)
                merged[c] = req.body[c];
        }
    }
    merged.id = id;
    // Normalize incoming agency_recruiter_id values from the client.
    if (merged.agency_recruiter_id === '' || merged.agency_recruiter_id === undefined) {
        merged.agency_recruiter_id = null;
    }
    else if (merged.agency_recruiter_id !== null) {
        merged.agency_recruiter_id = Number(merged.agency_recruiter_id);
    }
    // Normalize recurrence to a known value or NULL (only when admins set it).
    if ('recurrence' in merged)
        merged.recurrence = normalizeRecurrence(merged.recurrence);
    db.prepare(`
    UPDATE interviews
    SET date = @date, meeting_slot = @meeting_slot, country = @country,
        profile_name = @profile_name, company_name = @company_name, step = @step,
        step_details = @step_details, agency_recruiter_id = @agency_recruiter_id,
        agency_name = @agency_name,
        progress = @progress, meeting_url = @meeting_url, jd_url = @jd_url,
        recording_url = @recording_url, notes = @notes, handler = @handler,
        last_followed_up_at = @last_followed_up_at,
        meeting_type = @meeting_type,
        recurrence = @recurrence,
        updated_at = datetime('now')
    WHERE id = @id
  `).run(merged);
    res.json(db.prepare('SELECT * FROM interviews WHERE id = ?').get(id));
});
router.delete('/:id', (req, res) => {
    if (req.handlerFilter)
        return res.status(403).json({ error: 'only admins can delete interviews' });
    const id = Number(req.params.id);
    db.prepare('DELETE FROM interviews WHERE id = ?').run(id);
    // Sweep resumes whose pipeline key no longer maps to any interview (the AR
    // link, and thus the group, may also have changed). Cheap; the table is tiny.
    // Compare LOWERCASED keys on both sides — pipeline_key is stored lowercase
    // (case-insensitive pipelines), so an original-case comparison here would treat
    // every resume as an orphan and wipe the table.
    db.prepare(`
    DELETE FROM pipeline_resumes
    WHERE LOWER(pipeline_key) NOT IN (
      SELECT DISTINCT LOWER(TRIM(COALESCE(profile_name,'')) || '::' || TRIM(COALESCE(company_name,''))) FROM interviews
    )
  `).run();
    res.status(204).end();
});
// --- Resume upload / download / delete (shared per resume group) --------------
// A resume belongs to a GROUP of pipelines (see computeResumeGroups): the
// (profile, company) pipeline plus any pipeline joined to it through a Client
// Screen's Agency Recruiter link. The :id identifies the interview acted on;
// resolveGroup() expands it to every pipeline key sharing the group.
function inClause(keys) {
    return keys.map(() => '?').join(',');
}
// Upload (or replace) the resume for this interview's group. Admin only.
// Body: { filename: string, mime: string, data: string (base64) }.
router.post('/:id/resume', (req, res) => {
    if (req.handlerFilter)
        return res.status(403).json({ error: 'only admins can manage resumes' });
    const group = resolveGroup(Number(req.params.id));
    if (!group)
        return res.status(404).json({ error: 'not found' });
    const { filename, mime, data } = req.body ?? {};
    if (typeof filename !== 'string' || !filename.trim())
        return res.status(400).json({ error: 'filename is required' });
    if (typeof data !== 'string' || !data)
        return res.status(400).json({ error: 'file data is required' });
    const mimeType = typeof mime === 'string' && mime ? mime : 'application/octet-stream';
    if (!ALLOWED_RESUME_MIME.has(mimeType)) {
        return res.status(415).json({ error: 'unsupported file type — use PDF, DOC, DOCX, RTF, or TXT' });
    }
    let buf;
    try {
        buf = Buffer.from(data, 'base64');
    }
    catch {
        return res.status(400).json({ error: 'invalid file data' });
    }
    if (buf.length === 0)
        return res.status(400).json({ error: 'file is empty' });
    if (buf.length > MAX_RESUME_BYTES)
        return res.status(413).json({ error: 'file too large (max 8MB)' });
    // Clear any existing resume anywhere in the group, then store one row under
    // the acted-on interview's own pipeline key. Reads scan the whole group.
    db.prepare(`DELETE FROM pipeline_resumes WHERE pipeline_key IN (${inClause(group.groupKeys)})`).run(...group.groupKeys);
    db.prepare(`
    INSERT INTO pipeline_resumes (pipeline_key, filename, mime, data, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(group.key, filename.trim(), mimeType, buf);
    res.json({ ok: true, pipeline_key: group.key, resume_filename: filename.trim() });
});
// Download the group's resume. Any authenticated user who can see the interview
// — for devs (handlerFilter set) that means interviews they handle.
router.get('/:id/resume', (req, res) => {
    const group = resolveGroup(Number(req.params.id));
    if (!group)
        return res.status(404).json({ error: 'not found' });
    if (req.handlerFilter && String(group.handler ?? '').toLowerCase() !== req.handlerFilter.toLowerCase()) {
        return res.status(403).json({ error: 'forbidden' });
    }
    const row = db.prepare(`SELECT filename, mime, data FROM pipeline_resumes WHERE pipeline_key IN (${inClause(group.groupKeys)}) ORDER BY pipeline_key LIMIT 1`).get(...group.groupKeys);
    if (!row)
        return res.status(404).json({ error: 'no resume on file' });
    const buf = Buffer.from(row.data);
    // Sanitize filename for the Content-Disposition header.
    const safeName = row.filename.replace(/[^\w.\-() ]+/g, '_');
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
});
// The pipeline's job description (from Job Apply, matched by profile + company).
// Any authenticated user who can see the interview may read it.
router.get('/:id/jd', (req, res) => {
    const group = resolveGroup(Number(req.params.id));
    if (!group)
        return res.status(404).json({ error: 'not found' });
    if (req.handlerFilter && String(group.handler ?? '').toLowerCase() !== req.handlerFilter.toLowerCase()) {
        return res.status(403).json({ error: 'forbidden' });
    }
    const jd = findPipelineJd(group.groupKeys);
    if (!jd)
        return res.status(404).json({ error: 'no JD on file for this pipeline' });
    res.json(jd);
});
// Delete the group's resume. Admin only.
router.delete('/:id/resume', (req, res) => {
    if (req.handlerFilter)
        return res.status(403).json({ error: 'only admins can manage resumes' });
    const group = resolveGroup(Number(req.params.id));
    if (!group)
        return res.status(404).json({ error: 'not found' });
    db.prepare(`DELETE FROM pipeline_resumes WHERE pipeline_key IN (${inClause(group.groupKeys)})`).run(...group.groupKeys);
    res.status(204).end();
});
export default router;
