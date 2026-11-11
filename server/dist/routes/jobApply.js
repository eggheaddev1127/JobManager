import { Router } from 'express';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';
const router = Router();
// Normalize a URL for duplicate comparison (mirror of the client's normLink).
function normLink(u) {
    return (u || '').trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/+$/, '');
}
// Today's date in EST (the app's canonical timezone), as YYYY-MM-DD.
function estToday() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date()).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}
const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayDone = (date) => !!db.prepare('SELECT done FROM job_apply_days WHERE date = ?').get(date)?.done;
// Category ids attached to each link of a day: { linkId: [catId, ...] }.
function linkCategoryMap(date) {
    const rows = db.prepare(`
    SELECT lc.link_id AS linkId, lc.category_id AS catId
    FROM link_categories lc
    JOIN job_apply_links l ON l.id = lc.link_id
    WHERE l.date = ?
  `).all(date);
    const map = {};
    for (const r of rows)
        (map[r.linkId] = map[r.linkId] || []).push(r.catId);
    return map;
}
// Company name a user typed for each link, taken from any generated resume for
// that link (the review modal saves company_name per link). Latest non-empty
// value wins. { linkId: "Acme" }
function linkCompanyMap(date) {
    const rows = db.prepare(`
    SELECT g.link_id AS linkId, g.company_name AS company
    FROM generated_resumes g
    JOIN job_apply_links l ON l.id = g.link_id
    WHERE l.date = ? AND g.company_name IS NOT NULL AND TRIM(g.company_name) <> ''
    ORDER BY g.updated_at ASC
  `).all(date);
    const map = {};
    for (const r of rows)
        map[r.linkId] = r.company.trim(); // later rows overwrite → newest wins
    return map;
}
function dayPayload(date) {
    const links = db.prepare('SELECT id, url FROM job_apply_links WHERE date = ? ORDER BY sort, id').all(date);
    const confirmed = db.prepare('SELECT profile_id FROM job_apply_confirms WHERE date = ?').all(date).map((r) => r.profile_id);
    const catMap = linkCategoryMap(date);
    const companyMap = linkCompanyMap(date);
    const withCats = links.map((l) => ({ ...l, category_ids: catMap[l.id] ?? [], company: companyMap[l.id] ?? null }));
    return { links: withCats, confirmed, done: dayDone(date) };
}
// --- Daily / weekly data ------------------------------------------------------
// GET /api/job-apply?start=YYYY-MM-DD&end=YYYY-MM-DD → { days: { [date]: {...} } }
router.get('/', (req, res) => {
    const start = String(req.query.start ?? '');
    const end = String(req.query.end ?? '');
    if (!isDateStr(start) || !isDateStr(end))
        return res.status(400).json({ error: 'start and end (YYYY-MM-DD) required' });
    const dates = new Set();
    for (const r of db.prepare('SELECT DISTINCT date FROM job_apply_links WHERE date BETWEEN ? AND ?').all(start, end))
        dates.add(r.date);
    for (const r of db.prepare('SELECT date FROM job_apply_days WHERE date BETWEEN ? AND ?').all(start, end))
        dates.add(r.date);
    const days = {};
    for (const d of dates)
        days[d] = dayPayload(d);
    res.json({ days });
});
// GET /api/job-apply/search?q=… → links whose company name or JD text contains the
// query, across ALL dates. Company + JD live in generated_resumes (per profile),
// so we match there and roll up to one row per link.
router.get('/search', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2)
        return res.json({ results: [] });
    // Escape LIKE wildcards in the user's text so "50%" searches literally.
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const rows = db.prepare(`
    SELECT l.id, l.url, l.date,
      MAX(CASE WHEN g.company_name LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS co_match,
      MAX(CASE WHEN g.jd_text     LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS jd_match
    FROM job_apply_links l
    JOIN generated_resumes g ON g.link_id = l.id
    WHERE g.company_name LIKE ? ESCAPE '\\' OR g.jd_text LIKE ? ESCAPE '\\'
    GROUP BY l.id
    ORDER BY l.date DESC, l.id DESC
    LIMIT 100
  `).all(like, like, like, like);
    const companyStmt = db.prepare(`SELECT company_name FROM generated_resumes WHERE link_id = ? AND company_name IS NOT NULL AND TRIM(company_name) <> '' ORDER BY updated_at DESC LIMIT 1`);
    const jdStmt = db.prepare(`SELECT jd_text FROM generated_resumes WHERE link_id = ? AND jd_text LIKE ? ESCAPE '\\' ORDER BY LENGTH(jd_text) DESC LIMIT 1`);
    // Finished resumes available for this link (one per profile that has one built).
    const resumeStmt = db.prepare(`
    SELECT g.id, p.name AS profile
    FROM generated_resumes g JOIN profiles p ON p.id = g.profile_id
    WHERE g.link_id = ? AND g.status = 'done'
      AND (g.resume_pdf IS NOT NULL OR (g.resume_md IS NOT NULL AND LENGTH(TRIM(g.resume_md)) > 0))
    ORDER BY p.name`);
    const needle = q.toLowerCase();
    const results = rows.map((r) => {
        const company = companyStmt.get(r.id)?.company_name ?? null;
        const resumes = resumeStmt.all(r.id);
        let snippet = null;
        if (r.jd_match) {
            const jd = (jdStmt.get(r.id, like)?.jd_text ?? '');
            const idx = jd.toLowerCase().indexOf(needle);
            if (idx >= 0) {
                const start = Math.max(0, idx - 60);
                const end = Math.min(jd.length, idx + q.length + 60);
                snippet = (start > 0 ? '…' : '') + jd.slice(start, end).replace(/\s+/g, ' ').trim() + (end < jd.length ? '…' : '');
            }
        }
        return { id: r.id, url: r.url, date: r.date, company, matchedCompany: !!r.co_match, matchedJd: !!r.jd_match, snippet, resumes };
    });
    res.json({ results });
});
// --- Daily link mutations (shared; blocked once the day is locked) -------------
function ensureEditable(date, res) {
    if (dayDone(date)) {
        res.status(409).json({ error: 'day is locked — reopen it to edit' });
        return false;
    }
    return true;
}
// Normalize an incoming category id list to a clean array of existing ids.
function cleanCategoryIds(input) {
    if (!Array.isArray(input))
        return [];
    const ids = Array.from(new Set(input.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)));
    if (ids.length === 0)
        return [];
    const valid = new Set(db.prepare(`SELECT id FROM categories`).all().map((r) => r.id));
    return ids.filter((id) => valid.has(id));
}
function setLinkCategories(linkId, categoryIds) {
    db.prepare('DELETE FROM link_categories WHERE link_id = ?').run(linkId);
    const ins = db.prepare('INSERT OR IGNORE INTO link_categories (link_id, category_id) VALUES (?, ?)');
    for (const cid of categoryIds)
        ins.run(linkId, cid);
}
router.post('/links', (req, res) => {
    const { date, url } = req.body ?? {};
    if (!isDateStr(date))
        return res.status(400).json({ error: 'valid date required' });
    if (typeof url !== 'string' || !url.trim())
        return res.status(400).json({ error: 'url required' });
    if (!ensureEditable(date, res))
        return;
    const cats = cleanCategoryIds(req.body?.category_ids);
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM job_apply_links WHERE date = ?').get(date).m;
    const info = db.prepare('INSERT INTO job_apply_links (date, url, sort) VALUES (?, ?, ?)').run(date, url.trim(), maxSort + 1);
    const id = Number(info.lastInsertRowid);
    if (cats.length)
        setLinkCategories(id, cats);
    res.status(201).json({ id, url: url.trim(), category_ids: cats });
});
router.post('/links/bulk', (req, res) => {
    const { date, urls } = req.body ?? {};
    if (!isDateStr(date))
        return res.status(400).json({ error: 'valid date required' });
    if (!Array.isArray(urls))
        return res.status(400).json({ error: 'urls array required' });
    if (!ensureEditable(date, res))
        return;
    // Optional: apply the same category set to every link in this bulk batch.
    const cats = cleanCategoryIds(req.body?.category_ids);
    let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM job_apply_links WHERE date = ?').get(date).m;
    const insert = db.prepare('INSERT INTO job_apply_links (date, url, sort) VALUES (?, ?, ?)');
    const clean = urls.map((u) => String(u).trim()).filter(Boolean);
    for (const u of clean) {
        const info = insert.run(date, u, ++sort);
        if (cats.length)
            setLinkCategories(Number(info.lastInsertRowid), cats);
    }
    res.json({ added: clean.length });
});
// Set (replace) the categories on a single link.
router.put('/links/:id/categories', (req, res) => {
    const id = Number(req.params.id);
    const link = db.prepare('SELECT date FROM job_apply_links WHERE id = ?').get(id);
    if (!link)
        return res.status(404).json({ error: 'link not found' });
    if (!ensureEditable(link.date, res))
        return;
    const cats = cleanCategoryIds(req.body?.category_ids);
    setLinkCategories(id, cats);
    res.json({ id, category_ids: cats });
});
// Bulk delete by ids: DELETE /api/job-apply/links  body { date, ids:[] }
router.delete('/links', (req, res) => {
    const { date, ids } = req.body ?? {};
    if (!isDateStr(date))
        return res.status(400).json({ error: 'valid date required' });
    if (!Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ error: 'ids array required' });
    if (!ensureEditable(date, res))
        return;
    const ph = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM job_apply_links WHERE date = ? AND id IN (${ph})`).run(date, ...ids.map(Number));
    res.status(204).end();
});
// Toggle a profile sign-off for a day.
router.post('/confirm', (req, res) => {
    const { date, profile_id } = req.body ?? {};
    if (!isDateStr(date))
        return res.status(400).json({ error: 'valid date required' });
    const pid = Number(profile_id);
    if (!Number.isFinite(pid))
        return res.status(400).json({ error: 'profile_id required' });
    if (!ensureEditable(date, res))
        return;
    const exists = db.prepare('SELECT 1 FROM job_apply_confirms WHERE date = ? AND profile_id = ?').get(date, pid);
    if (exists)
        db.prepare('DELETE FROM job_apply_confirms WHERE date = ? AND profile_id = ?').run(date, pid);
    else
        db.prepare('INSERT INTO job_apply_confirms (date, profile_id) VALUES (?, ?)').run(date, pid);
    res.json(dayPayload(date));
});
// Lock / reopen a day.
router.post('/done', (req, res) => {
    const { date, done } = req.body ?? {};
    if (!isDateStr(date))
        return res.status(400).json({ error: 'valid date required' });
    db.prepare(`
    INSERT INTO job_apply_days (date, done, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET done = excluded.done, updated_at = datetime('now')
  `).run(date, done ? 1 : 0);
    res.json(dayPayload(date));
});
// --- Seed database (reference links for duplicate detection) -------------------
// Read + write are admin+superadmin (the whole Job Apply router is admin-gated).
router.get('/seed', (_req, res) => {
    res.json(db.prepare('SELECT id, url, date FROM seed_links ORDER BY date DESC, id DESC').all());
});
function seedExisting() {
    const set = new Set();
    for (const r of db.prepare('SELECT url FROM seed_links').all())
        set.add(normLink(r.url));
    return set;
}
router.post('/seed', (req, res) => {
    if (!isAdmin(req.user))
        return res.status(403).json({ error: 'admins only' });
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url)
        return res.status(400).json({ error: 'url required' });
    if (seedExisting().has(normLink(url)))
        return res.status(409).json({ error: 'already in the database' });
    const info = db.prepare('INSERT INTO seed_links (url, date) VALUES (?, ?)').run(url, estToday());
    res.status(201).json({ id: info.lastInsertRowid, url, date: estToday() });
});
router.post('/seed/bulk', (req, res) => {
    if (!isAdmin(req.user))
        return res.status(403).json({ error: 'admins only' });
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : null;
    if (!urls)
        return res.status(400).json({ error: 'urls array required' });
    const have = seedExisting();
    const date = estToday();
    const insert = db.prepare('INSERT INTO seed_links (url, date) VALUES (?, ?)');
    let added = 0, skipped = 0;
    for (const raw of urls) {
        const u = String(raw).trim();
        if (!u)
            continue;
        const n = normLink(u);
        if (have.has(n)) {
            skipped++;
            continue;
        }
        have.add(n);
        insert.run(u, date);
        added++;
    }
    res.json({ added, skipped });
});
router.delete('/seed/:id', (req, res) => {
    if (!isAdmin(req.user))
        return res.status(403).json({ error: 'admins only' });
    db.prepare('DELETE FROM seed_links WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
});
// Promote a day's links into the seed database (new only), dated with that day.
router.post('/promote', (req, res) => {
    const { date, urls } = req.body ?? {};
    if (!isDateStr(date))
        return res.status(400).json({ error: 'valid date required' });
    if (!Array.isArray(urls))
        return res.status(400).json({ error: 'urls array required' });
    const have = seedExisting();
    const insert = db.prepare('INSERT INTO seed_links (url, date) VALUES (?, ?)');
    let added = 0, skipped = 0;
    for (const raw of urls) {
        const u = String(raw).trim();
        if (!u)
            continue;
        const n = normLink(u);
        if (have.has(n)) {
            skipped++;
            continue;
        }
        have.add(n);
        insert.run(u, date);
        added++;
    }
    res.json({ added, skipped });
});
router.get('/categories', (_req, res) => {
    res.json(db.prepare('SELECT id, name, sort FROM categories ORDER BY sort, id').all());
});
router.post('/categories', (req, res) => {
    if (!isAdmin(req.user))
        return res.status(403).json({ error: 'admins only' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name)
        return res.status(400).json({ error: 'name required' });
    const dup = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
    if (dup)
        return res.status(409).json({ error: 'a category with that name already exists' });
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM categories').get().m;
    const info = db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)').run(name, maxSort + 1);
    res.status(201).json({ id: Number(info.lastInsertRowid), name, sort: maxSort + 1 });
});
router.put('/categories/:id', (req, res) => {
    if (!isAdmin(req.user))
        return res.status(403).json({ error: 'admins only' });
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(id);
    if (!existing)
        return res.status(404).json({ error: 'not found' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name)
        return res.status(400).json({ error: 'name required' });
    const dup = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?').get(name, id);
    if (dup)
        return res.status(409).json({ error: 'a category with that name already exists' });
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
    res.json({ id, name });
});
router.delete('/categories/:id', (req, res) => {
    if (!isAdmin(req.user))
        return res.status(403).json({ error: 'admins only' });
    const id = Number(req.params.id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    // Clean up assignments so no link/profile references a dead category.
    db.prepare('DELETE FROM link_categories WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM profile_categories WHERE category_id = ?').run(id);
    res.status(204).end();
});
// --- Profile ↔ category assignment -------------------------------------------
// Map of { profileId: [categoryId, ...] } for all profiles (used by the Job
// Apply matching and the Profiles UI).
router.get('/profile-categories', (_req, res) => {
    const rows = db.prepare('SELECT profile_id, category_id FROM profile_categories').all();
    const map = {};
    for (const r of rows)
        (map[r.profile_id] = map[r.profile_id] || []).push(r.category_id);
    res.json(map);
});
router.put('/profile-categories/:profileId', (req, res) => {
    if (!isAdmin(req.user))
        return res.status(403).json({ error: 'admins only' });
    const profileId = Number(req.params.profileId);
    const prof = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
    if (!prof)
        return res.status(404).json({ error: 'profile not found' });
    const cats = cleanCategoryIds(req.body?.category_ids);
    db.prepare('DELETE FROM profile_categories WHERE profile_id = ?').run(profileId);
    const ins = db.prepare('INSERT OR IGNORE INTO profile_categories (profile_id, category_id) VALUES (?, ?)');
    for (const cid of cats)
        ins.run(profileId, cid);
    res.json({ profile_id: profileId, category_ids: cats });
});
export default router;
