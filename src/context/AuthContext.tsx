import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchApiJsonWithRetry } from '../lib/fetch-retry.ts';

const CLIENT_SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL?.trim() ||
  'https://skxgejnquhqrlqjynfkv.supabase.co';
const CLIENT_SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  'sb_publishable_-U6EEkrWGvhFYPpdNXILMQ_Il4cmf9l';

let directSupabaseClientInstance: SupabaseClient | null = null;

function getDirectSupabaseClient(): SupabaseClient {
  if (!directSupabaseClientInstance) {
    directSupabaseClientInstance = createClient(
      CLIENT_SUPABASE_URL,
      CLIENT_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: true,
        },
      }
    );
  }
  return directSupabaseClientInstance;
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface SupabaseSetupStatus {
  configured: boolean;
  missingKeys: string[];
  diagnosticError?: string;
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
  isPasswordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  updatePassword: (newPassword: string) => Promise<boolean>;
  cancelPasswordRecovery: () => void;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string>;
  refreshConfigStatus: () => Promise<void>;
  clearMessages: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function extractDisplayName(
  metadata: Record<string, unknown> | undefined
): string | null {
  if (!metadata) return null;
  const candidate = metadata.full_name ?? metadata.name;
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null;
}

function hasRecoveryHashInUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  if (!hash) return false;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return (
    params.get('type') === 'recovery' ||
    hash.toLowerCase().includes('type=recovery')
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState<boolean>(() =>
    hasRecoveryHashInUrl()
  );
  const [configStatus, setConfigStatus] = useState<SupabaseSetupStatus | null>({
    configured: true,
    missingKeys: [],
  });

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
        setConfigStatus({
          configured: true,
          missingKeys: data.missingKeys ?? [],
        });
      } else {
        setConfigStatus({
          configured: true,
          missingKeys: [],
        });
      }
    } catch {
      setConfigStatus({
        configured: true,
        missingKeys: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshConfigStatus();
  }, [refreshConfigStatus]);

  // Detect Supabase PASSWORD_RECOVERY from URL hash and onAuthStateChange
  useEffect(() => {
    const directSupabaseClient = getDirectSupabaseClient();

    if (typeof window !== 'undefined' && hasRecoveryHashInUrl()) {
      setIsPasswordRecovery(true);
      const hashParams = new URLSearchParams(
        window.location.hash.replace(/^#/, '')
      );
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      if (accessToken && refreshToken) {
        void directSupabaseClient.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      }
    }

    const {
      data: { subscription },
    } = directSupabaseClient.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        setAuthError(null);
      }
    });

    const handleHashChange = () => {
      if (hasRecoveryHashInUrl()) {
        setIsPasswordRecovery(true);
        setAuthError(null);
      }
    };
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const clearMessages = useCallback(() => {
    setAuthError(null);
    setAuthNotice(null);
  }, []);

  const signInDirectWithSupabase = useCallback(
    async (email: string, password: string) => {
      const directSupabaseClient = getDirectSupabaseClient();
      const { data, error } = await directSupabaseClient.auth.signInWithPassword(
        {
          email: email.trim(),
          password,
        }
      );

      if (error || !data.session || !data.user) {
        setAuthError(error?.message || 'Invalid email or password.');
        return;
      }

      setSession({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
        user: {
          id: data.user.id,
          email: data.user.email || email.trim(),
          displayName: extractDisplayName(
            data.user.user_metadata as Record<string, unknown> | undefined
          ),
        },
      });
    },
    []
  );

  const signUpDirectWithSupabase = useCallback(
    async (email: string, password: string, fullName?: string) => {
      const directSupabaseClient = getDirectSupabaseClient();
      const trimmedName = fullName?.trim();
      const { data, error } = await directSupabaseClient.auth.signUp({
        email: email.trim(),
        password,
        options: trimmedName
          ? { data: { full_name: trimmedName } }
          : undefined,
      });

      if (error) {
        setAuthError(error.message || 'Unable to create account.');
        return;
      }

      if (!data.session) {
        setAuthNotice(
          'Account created. Please confirm your email in Supabase before signing in.'
        );
        return;
      }

      setSession({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
        user: {
          id: data.user?.id || '',
          email: data.user?.email || email.trim(),
          displayName:
            extractDisplayName(
              data.user?.user_metadata as Record<string, unknown> | undefined
            ) ||
            trimmedName ||
            null,
        },
      });
    },
    []
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
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

        if (res.ok && !looksLikeHtml && body?.accessToken) {
          setSession({
            accessToken: String(body.accessToken),
            refreshToken: String(body.refreshToken),
            expiresAt:
              typeof body.expiresAt === 'number' ? body.expiresAt : null,
            user: body.user as AppUser,
          });
          return;
        }

        const isValidCredentialRejection =
          (res.status === 400 || res.status === 401) &&
          !looksLikeHtml &&
          typeof body?.error === 'string' &&
          body.error.length > 0;

        if (isValidCredentialRejection) {
          setAuthError(String(body.error));
          return;
        }

        await signInDirectWithSupabase(email, password);
      } catch {
        try {
          await signInDirectWithSupabase(email, password);
        } catch (fallbackErr) {
          setAuthError(
            fallbackErr instanceof Error
              ? fallbackErr.message
              : 'Unable to sign in right now. Please try again.'
          );
        }
      }
    },
    [signInDirectWithSupabase]
  );

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

        if (res.ok && !looksLikeHtml && body) {
          if (body.needsEmailConfirmation) {
            setAuthNotice(
              (typeof body.message === 'string' && body.message) ||
                'Account created. Please confirm your email before signing in.'
            );
            return;
          }
          if (body.accessToken) {
            setSession({
              accessToken: String(body.accessToken),
              refreshToken: String(body.refreshToken),
              expiresAt:
                typeof body.expiresAt === 'number' ? body.expiresAt : null,
              user: body.user as AppUser,
            });
            return;
          }
        }

        const isValidValidationError =
          res.status === 400 &&
          !looksLikeHtml &&
          typeof body?.error === 'string' &&
          body.error.length > 0;

        if (isValidValidationError) {
          setAuthError(String(body.error));
          return;
        }

        await signUpDirectWithSupabase(email, password, fullName);
      } catch {
        try {
          await signUpDirectWithSupabase(email, password, fullName);
        } catch (fallbackErr) {
          setAuthError(
            fallbackErr instanceof Error
              ? fallbackErr.message
              : 'Unable to create account right now. Please try again.'
          );
        }
      }
    },
    [signUpDirectWithSupabase]
  );

  const resetPassword = useCallback(async (email: string): Promise<boolean> => {
    setAuthError(null);
    setAuthNotice(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setAuthError('Please enter your email address.');
      return false;
    }

    try {
      const directSupabaseClient = getDirectSupabaseClient();
      const { error } = await directSupabaseClient.auth.resetPasswordForEmail(
        trimmedEmail,
        {
          redirectTo: window.location.origin,
        }
      );

      if (error) {
        setAuthError(error.message || 'Unable to send password reset link.');
        return false;
      }

      setAuthNotice(
        `Password reset link sent to ${trimmedEmail}. Please check your inbox and open the link to set a new password.`
      );
      return true;
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Unable to send password reset link. Please try again.'
      );
      return false;
    }
  }, []);

  const updatePassword = useCallback(
    async (newPassword: string): Promise<boolean> => {
      setAuthError(null);
      setAuthNotice(null);
      if (newPassword.length < 6) {
        setAuthError('New password must be at least 6 characters.');
        return false;
      }

      try {
        const directSupabaseClient = getDirectSupabaseClient();
        const { error } = await directSupabaseClient.auth.updateUser({
          password: newPassword,
        });

        if (error) {
          setAuthError(
            error.message ||
              'Unable to update password. Your reset link may have expired—please request a new one.'
          );
          return false;
        }

        await directSupabaseClient.auth.signOut().catch(() => {});
        if (typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}`
          );
        }
        setIsPasswordRecovery(false);
        setAuthNotice(
          'Your password has been updated. Please sign in with your new password.'
        );
        return true;
      } catch (err) {
        setAuthError(
          err instanceof Error
            ? err.message
            : 'Unable to update password. Please try again.'
        );
        return false;
      }
    },
    []
  );

  const cancelPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
    setAuthError(null);
    setAuthNotice(null);
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}`
      );
    }
  }, []);

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
      try {
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
              typeof refreshed.expiresAt === 'number'
                ? refreshed.expiresAt
                : null,
            user: refreshed.user as AppUser,
          };
          sessionRef.current = nextSession;
          setSession(nextSession);
          return nextSession.accessToken;
        }
      } catch {
        // Fall through to direct Supabase session refresh below
      }

      const directSupabaseClient = getDirectSupabaseClient();
      const { data, error } = await directSupabaseClient.auth.refreshSession({
        refresh_token: current.refreshToken,
      });
      if (!error && data.session && data.user) {
        const nextSession: SessionState = {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at ?? null,
          user: {
            id: data.user.id,
            email: data.user.email || current.user.email,
            displayName:
              extractDisplayName(
                data.user.user_metadata as Record<string, unknown> | undefined
              ) || current.user.displayName,
          },
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
        isPasswordRecovery,
        signIn,
        signUp,
        resetPassword,
        updatePassword,
        cancelPasswordRecovery,
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
