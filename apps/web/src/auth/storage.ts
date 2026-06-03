import type { User, UserRole } from '@/lib/api';

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

const authStorageKey = 'ba-bazaar-auth-session';

export function getStoredSession(): AuthSession | null {
  const raw = window.localStorage.getItem(authStorageKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    window.localStorage.removeItem(authStorageKey);
    return null;
  }
}

export function setStoredSession(session: AuthSession) {
  window.localStorage.setItem(authStorageKey, JSON.stringify(session));
}

export function clearStoredSession() {
  window.localStorage.removeItem(authStorageKey);
}

export function getStoredRole(): UserRole | null {
  return getStoredSession()?.user.role ?? null;
}
