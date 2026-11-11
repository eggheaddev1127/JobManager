import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import cookieSession from 'cookie-session';
import { db, initSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { isAdmin, requireAuth, requireRole } from './auth.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import profilesRoutes from './routes/profiles.js';
import jobsRoutes from './routes/jobs.js';
import interviewsRoutes from './routes/interviews.js';
import unavailabilityRoutes from './routes/unavailability.js';
import jobApplyRoutes from './routes/jobApply.js';
import paymentsRoutes from './routes/payments.js';
import resumesRoutes from './routes/resumes.js';
initSchema();
seedIfEmpty();
const app = express();
app.use(cors({ origin: true, credentials: true }));
// Limit is generous enough to carry a base64-encoded resume (~8MB raw → ~11MB).
app.use(express.json({ limit: '15mb' }));
app.use(cookieSession({
    name: 'jm.sess',
    keys: [process.env.SESSION_SECRET || 'dev-secret-change-me-in-prod'],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
}));
app.get('/api/health', (_req, res) => {
    const counts = {
        profiles: db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c,
        jobs: db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c,
        interviews: db.prepare('SELECT COUNT(*) AS c FROM interviews').get().c,
        users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    };
    res.json({ ok: true, counts });
});
app.use('/api/auth', authRoutes);
// All routes below require authentication.
app.use('/api', requireAuth);
// Admin-only resources.
app.use('/api/users', requireRole('admin'), usersRoutes);
app.use('/api/jobs', requireRole('admin'), jobsRoutes);
// Profiles: any authenticated user can read (needed for interview form); writes are admin-only inside the route.
app.use('/api/profiles', profilesRoutes);
// Unavailability: any authenticated user reads (scoped inside the route);
// only devs may write their own blocks.
app.use('/api/unavailability', unavailabilityRoutes);
// Job Apply: admin/superadmin only. Daily list + per-profile sign-off + seed DB.
app.use('/api/job-apply', requireRole('admin'), jobApplyRoutes);
// Payments: admin/superadmin only, additionally page-locked inside the route.
app.use('/api/payments', requireRole('admin'), paymentsRoutes);
// Resume generation: admin/superadmin only. Claude settings, per-profile master
// resumes, and the day's tailored-resume generation / review / ZIP.
app.use('/api/resumes', requireRole('admin'), resumesRoutes);
// Interviews: any authenticated user. For non-admins, scope to their handler name.
app.use('/api/interviews', (req, _res, next) => {
    if (req.user && !isAdmin(req.user)) {
        req.handlerFilter = req.user.name;
    }
    next();
}, interviewsRoutes);
const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '::1';
// This VM's TCP loopback intermittently stalls request *bodies* (~30% of POSTs
// hang for seconds), which surfaces as a Cloudflare 524 when saving. So the
// Vite dev proxy talks to the API over a Unix domain socket instead — Unix
// sockets bypass the TCP/IP loopback stack entirely (no packet loss, no Nagle),
// making the proxy→API hop reliable. We ALSO keep a TCP listener (IPv6 loopback)
// for direct access, tooling, and tests.
const SOCK = process.env.API_SOCK || '/tmp/job-manager-api.sock';
function attachNoDelay(srv) {
    // Disable Nagle so small segments flush immediately (helps the TCP path).
    srv.on('connection', (socket) => { if ('setNoDelay' in socket)
        socket.setNoDelay(true); });
}
const tcpServer = http.createServer(app);
attachNoDelay(tcpServer);
tcpServer.listen(PORT, HOST, () => {
    console.log(`Job Manager API listening on http://${HOST}:${PORT}`);
});
try {
    fs.unlinkSync(SOCK);
}
catch { /* socket file not present — fine */ }
const sockServer = http.createServer(app);
attachNoDelay(sockServer);
sockServer.listen(SOCK, () => {
    console.log(`Job Manager API also listening on unix socket ${SOCK}`);
});
