import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { SESSION_EXPIRED_EVENT, tokenStore } from '../services/api';
import { authService } from '../services/authService';
import type { User } from '../types';

interface AuthValue {
  user: User | null;
  bootstrapping: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  signup: (username: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapping, setBootstrapping] = useState(() => tokenStore.get() !== null);

  useEffect(() => {
    if (!tokenStore.get()) return;

    let cancelled = false;
    authService.me()
      .then((me) => { if (!cancelled) setUser(me); })
      .catch(() => { tokenStore.clear(); })
      .finally(() => { if (!cancelled) setBootstrapping(false); });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const session = await authService.login(identifier, password);
    tokenStore.set(session.token, session.refreshToken);
    setUser(session.user);
  }, []);

  const signup = useCallback(async (username: string, email: string, password: string) => {
    const session = await authService.signup(username, email, password);
    tokenStore.set(session.token, session.refreshToken);
    setUser(session.user);
  }, []);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const session = await authService.googleSignIn(credential);
    tokenStore.set(session.token, session.refreshToken);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
    } finally {
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, bootstrapping, isAuthenticated: user !== null, login, signup, signInWithGoogle, logout, setUser }),
    [user, bootstrapping, login, signup, signInWithGoogle, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
