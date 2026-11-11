import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';

const router = Router();
const adminOnly = requireRole('admin');

const COLS = ['no', 'name', 'gmail', 'linkedin_url', 'full_address', 'gv', 'github', 'race', 'gv2', 'apply_enabled', 'color'] as const;
type Col = typeof COLS[number];

// Profile badge color: a hex string like "#7c3aed", or null for the auto color.
function normColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY COALESCE(no, id) ASC').all();
  res.json(rows);
});

router.post('/', adminOnly, (req, res) => {
  const body = req.body ?? {};
  const values: Record<Col, unknown> = {
    no: body.no ?? null,
    name: body.name ?? 'Unnamed',
    gmail: body.gmail ?? null,
    linkedin_url: body.linkedin_url ?? null,
    full_address: body.full_address ?? null,
    gv: body.gv ?? null,
    github: body.github ?? null,
    race: body.race ?? null,
    gv2: body.gv2 ?? null,
    apply_enabled: body.apply_enabled === false || body.apply_enabled === 0 ? 0 : 1,
    color: normColor(body.color),
  };
  const info = db.prepare(`
    INSERT INTO profiles (no, name, gmail, linkedin_url, full_address, gv, github, race, gv2, apply_enabled, color)
    VALUES (@no, @name, @gmail, @linkedin_url, @full_address, @gv, @github, @race, @gv2, @apply_enabled, @color)
  `).run(values);
  const created = db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

router.put('/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const merged: Record<string, unknown> = { ...existing };
  for (const c of COLS) {
    if (c in req.body) merged[c] = req.body[c];
  }
  merged.id = id;
  // Coerce apply_enabled to 0/1 (booleans from the client aren't valid SQLite params).
  merged.apply_enabled = merged.apply_enabled === false || merged.apply_enabled === 0 ? 0 : 1;
  merged.color = normColor(merged.color);
  db.prepare(`
    UPDATE profiles
    SET no = @no, name = @name, gmail = @gmail, linkedin_url = @linkedin_url,
        full_address = @full_address, gv = @gv, github = @github, race = @race, gv2 = @gv2,
        apply_enabled = @apply_enabled, color = @color,
        updated_at = datetime('now')
    WHERE id = @id
  `).run(merged);
  const updated = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  res.json(updated);
});

router.delete('/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  res.status(204).end();
});

export default router;
