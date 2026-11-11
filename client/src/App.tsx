import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ProfilesPage from './pages/ProfilesPage';
import JobsPage from './pages/JobsPage';
import InterviewsPage from './pages/InterviewsPage';
import CalendarPage from './pages/CalendarPage';
import JobApplyPage from './pages/JobApplyPage';
import PaymentsPage from './pages/PaymentsPage';
import CallerPayPage from './pages/CallerPayPage';
import UsersPage from './pages/UsersPage';
import LoginPage from './pages/LoginPage';
import ChangePasswordModal from './components/ChangePasswordModal';
import { isAdmin, isSuperAdmin, useAuth } from './auth';
import type { User } from './types';
import type { ReactNode } from 'react';

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="center-loader">Loading…</div>;
  }

  if (!user) {
    if (location.pathname !== '/login') return <Navigate to="/login" replace />;
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!user.active) {
    return (
      <div className="app">
        <AppHeader user={user} />
        <main className="page">
          <div className="access-denied">
            <h2>Access disabled</h2>
            <p>
              <strong>{user.name}</strong> does not currently have access to the system.
              Ask an admin to enable access on the Users page.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeader user={user} />
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/interviews" replace />} />
          <Route path="/login" element={<Navigate to="/interviews" replace />} />
          <Route path="/profiles" element={<AdminOnly user={user}><ProfilesPage /></AdminOnly>} />
          <Route path="/jobs" element={<AdminOnly user={user}><JobsPage /></AdminOnly>} />
          <Route path="/interviews" element={<InterviewsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/job-apply" element={<AdminOnly user={user}><JobApplyPage /></AdminOnly>} />
          <Route path="/payments" element={<AdminOnly user={user}><PaymentsPage /></AdminOnly>} />
          <Route path="/caller-pay" element={<CallerPayPage />} />
          <Route path="/users" element={<SuperAdminOnly user={user}><UsersPage /></SuperAdminOnly>} />
          <Route path="*" element={<Navigate to="/interviews" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function AdminOnly({ user, children }: { user: User; children: ReactNode }) {
  if (!isAdmin(user)) return <Navigate to="/interviews" replace />;
  return <>{children}</>;
}

function SuperAdminOnly({ user, children }: { user: User; children: ReactNode }) {
  if (!isSuperAdmin(user)) return <Navigate to="/interviews" replace />;
  return <>{children}</>;
}

function AppHeader({ user }: { user: User }) {
  const { logout } = useAuth();
  const admin = isAdmin(user);
  const superAdmin = isSuperAdmin(user);
  const [showChangePass, setShowChangePass] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark">J</span>
          <span>Job Manager</span>
        </div>

        <nav className="nav">
          {admin && <NavTab to="/profiles" label="Profiles" />}
          {admin && <NavTab to="/jobs" label="Running Jobs" />}
          {admin && <NavTab to="/payments" label="Payments" />}
          <NavTab to="/interviews" label="Interviews" />
          <NavTab to="/calendar" label="Calendar" />
          {admin && <NavTab to="/job-apply" label="Job Apply" />}
          <NavTab to="/caller-pay" label={admin ? 'Pay Schedule' : 'Payment'} />
          {superAdmin && <NavTab to="/users" label="Users" />}
        </nav>

        <div className="user-info">
          <div style={{ textAlign: 'right' }}>
            <div className="user-info-name">{user.name}</div>
            <div className="user-info-role">{user.roles.join(' + ') || 'no role'}</div>
          </div>
          <button className="btn" onClick={() => setShowChangePass(true)}>Change password</button>
          <button className="btn" onClick={() => void logout()}>Sign out</button>
        </div>
      </div>

      {showChangePass && <ChangePasswordModal onClose={() => setShowChangePass(false)} />}
    </header>
  );
}

function NavTab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
      {label}
    </NavLink>
  );
}
