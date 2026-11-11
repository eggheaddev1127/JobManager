import { db } from './db.js';
export function toPublicUser(u) {
    return {
        id: u.id,
        name: u.name,
        email: u.email,
        active: !!u.active,
        roles: (u.roles || '').split(',').map((r) => r.trim()).filter(Boolean),
    };
}
export function requireAuth(req, res, next) {
    const userId = req.session?.userId;
    if (!userId)
        return res.status(401).json({ error: 'unauthorized' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user || !user.active) {
        req.session = null;
        return res.status(401).json({ error: 'unauthorized' });
    }
    req.user = user;
    next();
}
export function requireRole(role) {
    return function (req, res, next) {
        if (!req.user)
            return res.status(401).json({ error: 'unauthorized' });
        const roles = (req.user.roles || '').split(',');
        // superadmin satisfies any admin-required check (covers admin role too).
        if (role === 'admin' && roles.includes('superadmin'))
            return next();
        if (!roles.includes(role))
            return res.status(403).json({ error: 'forbidden' });
        next();
    };
}
// Treat superadmin as a flavour of admin — anywhere we used to gate on "admin",
// superadmin should pass too.
export function isAdmin(user) {
    if (!user)
        return false;
    const roles = (user.roles || '').split(',');
    return roles.includes('admin') || roles.includes('superadmin');
}
export function isSuperAdmin(user) {
    if (!user)
        return false;
    return (user.roles || '').split(',').includes('superadmin');
}
const ALLOWED_ROLES = new Set(['superadmin', 'admin', 'dev']);
export function normalizeRoles(input) {
    let arr = [];
    if (typeof input === 'string')
        arr = input.split(',');
    else if (Array.isArray(input))
        arr = input.map(String);
    return Array.from(new Set(arr.map((r) => r.trim().toLowerCase()).filter((r) => ALLOWED_ROLES.has(r)))).join(',');
}
