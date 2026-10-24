import { createStore } from 'zustand/vanilla';
import { api } from './api.ts';

// Who is signed in (SETTINGS_AND_SECURITY.md §4), read once at start. `setup` means no admin exists
// yet and the one-time setup page is open; `offline` means there is no ECHO server to ask (the
// fixture-only development shell).

export type SessionState =
  | { status: 'unknown' }
  | { status: 'offline' }
  | { status: 'setup' }
  | { status: 'anonymous' }
  | { status: 'signedIn'; username: string; role: 'admin' | 'user'; navidrome: boolean };

export const sessionStore = createStore<SessionState>()(() => ({ status: 'unknown' }));

export async function loadSession(): Promise<SessionState> {
  const state = await api<SessionState>('/session').catch(
    (): SessionState => ({ status: 'offline' }),
  );
  sessionStore.setState(state, true);
  return state;
}

/** The first step of signing in: a session, or a TOTP challenge. */
export const login = (username: string, password: string) =>
  api<{ totpRequired: boolean; challenge?: string }>('/auth/login', {
    method: 'POST',
    body: { username, password },
  });

export const totp = (challenge: string, code: string) =>
  api<{ ok: true }>('/auth/totp', { method: 'POST', body: { challenge, code } });

export const logout = () => api('/auth/logout', { method: 'POST', body: {} });

export const setupStart = (token: string, username: string, password: string) =>
  api<{ otpauth: string; secret: string }>('/setup', {
    method: 'POST',
    body: { token, username, password },
  });

export const setupFinish = (token: string, code: string) =>
  api<{ recoveryCodes: string[] }>('/setup/totp', { method: 'POST', body: { token, code } });
