import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, HttpError, setUnauthorizedHandler } from './api';
import type { User } from './types';
import { clearCache } from './util/dataCache';

type AuthValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.auth.me();
      setUser(me);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) setUser(null);
      else console.error('auth.me failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    clearCache(); // never show a previous user's cached data
    const me = await api.auth.login(email, password);
    setUser(me);
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout();
    clearCache();
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function hasRole(user: User | null, role: 'admin' | 'dev' | 'superadmin'): boolean {
  return !!user && user.roles.includes(role);
}

// Anywhere we used to gate on "admin", superadmin should pass too — admin is
// a superset of dev permissions, and superadmin is a superset of admin.
export function isAdmin(user: User | null): boolean {
  return hasRole(user, 'admin') || hasRole(user, 'superadmin');
}

export function isSuperAdmin(user: User | null): boolean {
  return hasRole(user, 'superadmin');
}
