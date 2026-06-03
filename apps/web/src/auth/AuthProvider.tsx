import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import {
  API_BASE_URL,
  type User
} from '@/lib/api';
import {
  clearStoredSession,
  getStoredSession,
  setStoredSession,
  type AuthSession
} from './storage';

type RegisterInput = {
  full_name: string;
  email: string;
  password: string;
};

type AuthContextValue = {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isReady: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  syncFromStorage: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() =>
    typeof window === 'undefined' ? null : getStoredSession()
  );
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    function handleAuthLogout() {
      setSession(null);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === 'ba-bazaar-auth-session') {
        setSession(getStoredSession());
      }
    }

    window.addEventListener('auth:logout', handleAuthLogout as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('auth:logout', handleAuthLogout as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    const { accessToken, refreshToken } = session;

    let cancelled = false;

    async function tryRefreshSession() {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      }).catch(() => null);

      if (!response?.ok) {
        return null;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            access_token?: string;
            refresh_token?: string;
          }
        | null;

      if (!payload?.access_token || !payload.refresh_token) {
        return null;
      }

      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token
      };
    }

    async function fetchCurrentUser(currentAccessToken: string) {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${currentAccessToken}`
        }
      }).catch(() => null);

      if (!response) {
        return null;
      }

      if (!response.ok) {
        return response;
      }

      const payload = (await response.json().catch(() => null)) as { user?: User } | null;
      return payload?.user ?? null;
    }

    async function syncSessionUser() {
      let nextAccessToken = accessToken;
      let nextRefreshToken = refreshToken;
      let currentUser = await fetchCurrentUser(nextAccessToken);

      if (cancelled) {
        return;
      }

      if (currentUser instanceof Response && currentUser.status === 401) {
        const refreshedTokens = await tryRefreshSession();

        if (!refreshedTokens) {
          clearStoredSession();
          setSession(null);
          window.dispatchEvent(new Event('auth:logout'));
          return;
        }

        nextAccessToken = refreshedTokens.accessToken;
        nextRefreshToken = refreshedTokens.refreshToken;
        currentUser = await fetchCurrentUser(nextAccessToken);
      }

      if (cancelled) {
        return;
      }

      if (currentUser instanceof Response || !currentUser) {
        return;
      }

      const nextSession: AuthSession = {
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
        user: currentUser
      };
      setStoredSession(nextSession);
      setSession(nextSession);
    }

    void syncSessionUser();

    return () => {
      cancelled = true;
    };
  }, [session?.accessToken]);

  async function login(email: string, password: string) {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          message?: string;
          access_token?: string;
          refresh_token?: string;
          user?: User;
        }
      | null;

    if (!response.ok || !payload?.access_token || !payload.refresh_token || !payload.user) {
      throw new Error(payload?.message ?? 'Login failed.');
    }

    const nextSession: AuthSession = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      user: payload.user
    };
    setStoredSession(nextSession);
    setSession(nextSession);
    return payload.user;
  }

  async function register(input: RegisterInput) {
    const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;

    if (!response.ok) {
      throw new Error(payload?.message ?? 'Register failed.');
    }
  }

  async function logout() {
    const refreshToken = session?.refreshToken;

    if (refreshToken) {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      }).catch(() => undefined);
    }

    clearStoredSession();
    setSession(null);
    window.dispatchEvent(new Event('auth:logout'));
  }

  function syncFromStorage() {
    setSession(getStoredSession());
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      refreshToken: session?.refreshToken ?? null,
      isAuthenticated: Boolean(session?.accessToken && session?.user),
      isReady,
      login,
      register,
      logout,
      syncFromStorage
    }),
    [isReady, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}
