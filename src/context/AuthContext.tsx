import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { fetchApiJsonWithRetry } from '../lib/fetch-retry.ts';

export interface AppUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface SupabaseSetupStatus {
  configured: boolean;
  missingKeys: string[];
}

interface SessionState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  user: AppUser;
}

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  authError: string | null;
  authNotice: string | null;
  configStatus: SupabaseSetupStatus | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string>;
  refreshConfigStatus: () => Promise<void>;
  clearMessages: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<SupabaseSetupStatus | null>(
    null
  );

  // Keep latest session in ref so getIdToken stays stable and never stores tokens in browser storage
  const sessionRef = useRef<SessionState | null>(null);
  sessionRef.current = session;

  const refreshConfigStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { res, parsedBody, looksLikeHtml } = await fetchApiJsonWithRetry(
        '/api/config/status'
      );
      const data = parsedBody as SupabaseSetupStatus | null;
      if (
        res.ok &&
        !looksLikeHtml &&
        data &&
        typeof data.configured === 'boolean'
      ) {
        setConfigStatus(data);
      } else {
        setConfigStatus({
          configured: false,
          missingKeys: [
            'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)',
            'SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)',
          ],
        });
      }
    } catch {
      setConfigStatus({
        configured: false,
        missingKeys: [
          'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)',
          'SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)',
        ],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshConfigStatus();
  }, [refreshConfigStatus]);

  const clearMessages = useCallback(() => {
    setAuthError(null);
    setAuthNotice(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    setAuthNotice(null);
    try {
      const { res, parsedBody, looksLikeHtml } = await fetchApiJsonWithRetry(
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        }
      );
      const body = parsedBody as Record<string, unknown> | null;
      if (!res.ok || looksLikeHtml || !body) {
        setAuthError(
          (typeof body?.error === 'string' && body.error) ||
            'Unable to sign in right now. The server may still be waking up—please try again.'
        );
        return;
      }
      setSession({
        accessToken: String(body.accessToken),
        refreshToken: String(body.refreshToken),
        expiresAt:
          typeof body.expiresAt === 'number' ? body.expiresAt : null,
        user: body.user as AppUser,
      });
    } catch {
      setAuthError('Unable to reach authentication server. Please retry.');
    }
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, fullName?: string) => {
      setAuthError(null);
      setAuthNotice(null);
      try {
        const { res, parsedBody, looksLikeHtml } = await fetchApiJsonWithRetry(
          '/api/auth/signup',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, fullName }),
          }
        );
        const body = parsedBody as Record<string, unknown> | null;
        if (!res.ok || looksLikeHtml || !body) {
          setAuthError(
            (typeof body?.error === 'string' && body.error) ||
              'Unable to create account right now. Please try again.'
          );
          return;
        }
        if (body.needsEmailConfirmation) {
          setAuthNotice(
            (typeof body.message === 'string' && body.message) ||
              'Account created. Please confirm your email before signing in.'
          );
          return;
        }
        setSession({
          accessToken: String(body.accessToken),
          refreshToken: String(body.refreshToken),
          expiresAt:
            typeof body.expiresAt === 'number' ? body.expiresAt : null,
          user: body.user as AppUser,
        });
      } catch {
        setAuthError('Unable to reach authentication server. Please retry.');
      }
    },
    []
  );

  const logout = useCallback(async () => {
    setAuthError(null);
    setAuthNotice(null);
    setSession(null);
  }, []);

  const getIdToken = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) {
      throw new Error('Not authenticated. Please sign in.');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (
      current.expiresAt &&
      current.expiresAt - nowSec < 60 &&
      current.refreshToken
    ) {
      const { res, parsedBody, looksLikeHtml } = await fetchApiJsonWithRetry(
        '/api/auth/refresh',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        }
      );
      const refreshed = parsedBody as Record<string, unknown> | null;
      if (res.ok && !looksLikeHtml && refreshed?.accessToken) {
        const nextSession: SessionState = {
          accessToken: String(refreshed.accessToken),
          refreshToken: String(refreshed.refreshToken),
          expiresAt:
            typeof refreshed.expiresAt === 'number' ? refreshed.expiresAt : null,
          user: refreshed.user as AppUser,
        };
        sessionRef.current = nextSession;
        setSession(nextSession);
        return nextSession.accessToken;
      }
      setSession(null);
      throw new Error('Your session expired. Please sign in again.');
    }

    return current.accessToken;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        loading,
        authError,
        authNotice,
        configStatus,
        signIn,
        signUp,
        logout,
        getIdToken,
        refreshConfigStatus,
        clearMessages,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
