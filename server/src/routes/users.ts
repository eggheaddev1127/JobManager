import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { normalizeRoles, requireRole, toPublicUser, type AuthedRequest, type UserRow } from '../auth.js';

const router = Router();
const superAdminOnly = requireRole('superadmin');

// GET is open to any admin/superadmin (the route mount already enforces admin)
// so the Interviews handler dropdown can still populate. Writes are restricted
// to superadmin only.
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all() as UserRow[];
  res.json(rows.map(toPublicUser));
});

router.post('/', superAdminOnly, async (req, res) => {
  const { name, email, password, active = true, roles = 'dev' } = req.body ?? {};
  if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'name and email required' });
  if (!password || String(password).length < 1) return res.status(400).json({ error: 'password required' });
  const normRoles = normalizeRoles(roles);
  if (!normRoles) return res.status(400).json({ error: 'at least one role required' });

  try {
    const hash = await bcrypt.hash(String(password), 10);
    const info = db.prepare(`
      INSERT INTO users (name, email, password_hash, active, roles)
      VALUES (@name, @email, @password_hash, @active, @roles)
    `).run({
      name: String(name).trim(),
      email: String(email).trim(),
      password_hash: hash,
      active: active ? 1 : 0,
      roles: normRoles,
    });
    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
    res.status(201).json(toPublicUser(created));
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed: users.email')) {
      return res.status(409).json({ error: 'email already exists' });
    }
    res.status(500).json({ error: String(e) });
  }
});

router.put('/:id', superAdminOnly, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!existing) return res.status(404).json({ error: 'not found' });

  const body = req.body ?? {};
  const name = body.name?.trim() ?? existing.name;
  const email = body.email?.trim() ?? existing.email;
  const active = body.active === undefined ? existing.active : (body.active ? 1 : 0);
  const roles = body.roles === undefined ? existing.roles : normalizeRoles(body.roles);
  if (!roles) return res.status(400).json({ error: 'at least one role required' });

  let password_hash = existing.password_hash;
  if (body.password && String(body.password).length > 0) {
    password_hash = await bcrypt.hash(String(body.password), 10);
  }

  // Prevent self lock-out: don't let an elevated user drop their own admin/
  // superadmin status or deactivate themselves.
  if (req.user && req.user.id === id) {
    const existingArr = (existing.roles || '').split(',');
    const nextArr = roles.split(',');
    const hadElevated = existingArr.includes('admin') || existingArr.includes('superadmin');
    const stillElevated = nextArr.includes('admin') || nextArr.includes('superadmin');
    if (hadElevated && !stillElevated) return res.status(400).json({ error: 'cannot remove your own admin / superadmin role' });
    if (!active) return res.status(400).json({ error: 'cannot deactivate yourself' });
  }

  try {
    db.prepare(`
      UPDATE users SET name = @name, email = @email, password_hash = @password_hash,
        active = @active, roles = @roles, updated_at = datetime('now')
      WHERE id = @id
    `).run({ id, name, email, password_hash, active, roles });
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    res.json(toPublicUser(updated));
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed: users.email')) {
      return res.status(409).json({ error: 'email already exists' });
    }
    res.status(500).json({ error: String(e) });
  }
});

router.delete('/:id', superAdminOnly, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (req.user?.id === id) return res.status(400).json({ error: 'cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.status(204).end();
});

export default router;
