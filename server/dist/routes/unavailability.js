import { Router } from 'express';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';
const router = Router();
// A dev marks their own unavailable time; admins/superadmins can see everyone's
// but cannot create/edit/delete. Times are minutes-since-midnight (EST).
function rolesOf(user) {
    return (user.roles || '').split(',').map((r) => r.trim()).filter(Boolean);
}
function isDevMarker(user) {
    // Only a plain dev (not an admin/superadmin) may mark unavailability.
    return rolesOf(user).includes('dev') && !isAdmin(user);
}
function validateBlock(body) {
    const date = typeof body.date === 'string' ? body.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return 'valid date (YYYY-MM-DD) is required';
    const start = Number(body.start);
    const end = Number(body.end);
    if (!Number.isFinite(start) || !Number.isFinite(end))
        return 'start and end (minutes) are required';
    if (start < 0 || end > 24 * 60 || end <= start)
        return 'end must be after start, within the day';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    return { date, start, end, note };
}
// List blocks the requester may see. Dev: only their own. Admin: everyone's.
router.get('/', (req, res) => {
    const user = req.user;
    const rows = isAdmin(user)
        ? db.prepare(`
        SELECT u.id, u.user_id, u.date, u.start_min, u.end_min, u.note, usr.name AS user_name
        FROM unavailability u LEFT JOIN users usr ON usr.id = u.user_id
        ORDER BY u.date, u.start_min
      `).all()
        : db.prepare(`
        SELECT u.id, u.user_id, u.date, u.start_min, u.end_min, u.note, ? AS user_name
        FROM unavailability u WHERE u.user_id = ?
        ORDER BY u.date, u.start_min
      `).all(user.name, user.id);
    res.json(rows);
});
router.post('/', (req, res) => {
    const user = req.user;
    if (!isDevMarker(user))
        return res.status(403).json({ error: 'only devs can mark unavailability' });
    const v = validateBlock(req.body ?? {});
    if (typeof v === 'string')
        return res.status(400).json({ error: v });
    const info = db.prepare('INSERT INTO unavailability (user_id, date, start_min, end_min, note) VALUES (?, ?, ?, ?, ?)').run(user.id, v.date, v.start, v.end, v.note);
    res.status(201).json(db.prepare('SELECT id, user_id, date, start_min, end_min, note, ? AS user_name FROM unavailability WHERE id = ?').get(user.name, info.lastInsertRowid));
});
router.put('/:id', (req, res) => {
    const user = req.user;
    if (!isDevMarker(user))
        return res.status(403).json({ error: 'only devs can mark unavailability' });
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT user_id FROM unavailability WHERE id = ?').get(id);
    if (!existing)
        return res.status(404).json({ error: 'not found' });
    if (existing.user_id !== user.id)
        return res.status(403).json({ error: 'forbidden' });
    const v = validateBlock(req.body ?? {});
    if (typeof v === 'string')
        return res.status(400).json({ error: v });
    db.prepare("UPDATE unavailability SET date = ?, start_min = ?, end_min = ?, note = ?, updated_at = datetime('now') WHERE id = ?")
        .run(v.date, v.start, v.end, v.note, id);
    res.json(db.prepare('SELECT id, user_id, date, start_min, end_min, note, ? AS user_name FROM unavailability WHERE id = ?').get(user.name, id));
});
router.delete('/:id', (req, res) => {
    const user = req.user;
    if (!isDevMarker(user))
        return res.status(403).json({ error: 'only devs can mark unavailability' });
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT user_id FROM unavailability WHERE id = ?').get(id);
    if (!existing)
        return res.status(404).json({ error: 'not found' });
    if (existing.user_id !== user.id)
        return res.status(403).json({ error: 'forbidden' });
    db.prepare('DELETE FROM unavailability WHERE id = ?').run(id);
    res.status(204).end();
});
export default router;
