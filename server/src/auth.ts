import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';

export type UserRow = {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  active: number;
  roles: string;
  created_at: string;
  updated_at: string;
};

export type PublicUser = {
  id: number;
  name: string;
  email: string;
  active: boolean;
  roles: string[];
};

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    active: !!u.active,
    roles: (u.roles || '').split(',').map((r) => r.trim()).filter(Boolean),
  };
}

export type AuthedRequest = Request & { user?: UserRow };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const userId = (req.session as { userId?: number } | null | undefined)?.userId;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!user || !user.active) {
    req.session = null;
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.user = user;
  next();
}

export function requireRole(role: 'admin' | 'dev' | 'superadmin') {
  return function (req: AuthedRequest, res: Response, next: NextFunction) {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    const roles = (req.user.roles || '').split(',');
    // superadmin satisfies any admin-required check (covers admin role too).
    if (role === 'admin' && roles.includes('superadmin')) return next();
    if (!roles.includes(role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

// Treat superadmin as a flavour of admin — anywhere we used to gate on "admin",
// superadmin should pass too.
export function isAdmin(user: UserRow | undefined): boolean {
  if (!user) return false;
  const roles = (user.roles || '').split(',');
  return roles.includes('admin') || roles.includes('superadmin');
}

export function isSuperAdmin(user: UserRow | undefined): boolean {
  if (!user) return false;
  return (user.roles || '').split(',').includes('superadmin');
}

const ALLOWED_ROLES = new Set(['superadmin', 'admin', 'dev']);

export function normalizeRoles(input: unknown): string {
  let arr: string[] = [];
  if (typeof input === 'string') arr = input.split(',');
  else if (Array.isArray(input)) arr = input.map(String);
  return Array.from(new Set(arr.map((r) => r.trim().toLowerCase()).filter((r) => ALLOWED_ROLES.has(r)))).join(',');
}
