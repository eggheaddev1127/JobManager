import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import cookieSession from 'cookie-session';
import { db, initSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { isAdmin, requireAuth, requireRole, type AuthedRequest } from './auth.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import profilesRoutes from './routes/profiles.js';
import jobsRoutes from './routes/jobs.js';
import interviewsRoutes from './routes/interviews.js';
import unavailabilityRoutes from './routes/unavailability.js';
import jobApplyRoutes from './routes/jobApply.js';
import paymentsRoutes from './routes/payments.js';
import resumesRoutes from './routes/resumes.js';
import callerPayRoutes from './routes/callerPay.js';

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
    profiles: (db.prepare('SELECT COUNT(*) AS c FROM profiles').get() as { c: number }).c,
    jobs: (db.prepare('SELECT COUNT(*) AS c FROM jobs').get() as { c: number }).c,
    interviews: (db.prepare('SELECT COUNT(*) AS c FROM interviews').get() as { c: number }).c,
    users: (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c,
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

// Caller Pay: any authenticated user. Admins pick a caller + period; others are
// scoped to their own schedule inside the route. Writes (mark paid) are admin-only.
app.use('/api/caller-pay', callerPayRoutes);

// Interviews: any authenticated user. For non-admins, scope to their handler name.
app.use('/api/interviews', (req: AuthedRequest, _res, next) => {
  if (req.user && !isAdmin(req.user)) {
    (req as AuthedRequest & { handlerFilter?: string }).handlerFilter = req.user.name;
  }
  next();
}, interviewsRoutes);

const PORT = Number(process.env.PORT) || 4000;
// Windows (local dev): plain IPv4 loopback. Linux host: IPv6 loopback (see below).
const HOST = process.env.HOST || (process.platform === 'win32' ? '127.0.0.1' : '::1');
// This VM's TCP loopback intermittently stalls request *bodies* (~30% of POSTs
// hang for seconds), which surfaces as a Cloudflare 524 when saving. So the
// Vite dev proxy talks to the API over a Unix domain socket instead — Unix
// sockets bypass the TCP/IP loopback stack entirely (no packet loss, no Nagle),
// making the proxy→API hop reliable. We ALSO keep a TCP listener (IPv6 loopback)
// for direct access, tooling, and tests.
const SOCK = process.env.API_SOCK || '/tmp/job-manager-api.sock';

function attachNoDelay(srv: http.Server) {
  // Disable Nagle so small segments flush immediately (helps the TCP path).
  srv.on('connection', (socket) => { if ('setNoDelay' in socket) socket.setNoDelay(true); });
}

const tcpServer = http.createServer(app);
attachNoDelay(tcpServer);
tcpServer.listen(PORT, HOST, () => {
  console.log(`Job Manager API listening on http://${HOST}:${PORT}`);
});

// Unix sockets aren't available on Windows (a plain path isn't a valid named
// pipe), so local Windows runs use the TCP listener only.
if (process.platform !== 'win32') {
  try { fs.unlinkSync(SOCK); } catch { /* socket file not present — fine */ }
  const sockServer = http.createServer(app);
  attachNoDelay(sockServer);
  sockServer.listen(SOCK, () => {
    console.log(`Job Manager API also listening on unix socket ${SOCK}`);
  });
}
