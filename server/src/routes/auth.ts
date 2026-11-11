import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth, toPublicUser, type AuthedRequest, type UserRow } from '../auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = db
    .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)')
    .get(String(email)) as UserRow | undefined;
  if (!user || !user.active) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  (req.session as { userId?: number } | null) = { userId: user.id };
  res.json(toPublicUser(user));
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json(toPublicUser(req.user!));
});

router.post('/change-password', requireAuth, async (req: AuthedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'current and new password required' });
  if (String(newPassword).length < 4) return res.status(400).json({ error: 'new password must be at least 4 characters' });
  const ok = await bcrypt.compare(String(currentPassword), req.user!.password_hash);
  if (!ok) return res.status(401).json({ error: 'current password is incorrect' });
  const hash = await bcrypt.hash(String(newPassword), 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, req.user!.id);
  res.json({ ok: true });
});

export default router;
