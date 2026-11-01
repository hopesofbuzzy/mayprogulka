import type { components } from '../api/schema';

// The JSON does not require token_type; the generator marks fields with defaults required.
export type TokenResponse = Omit<components['schemas']['TokenResponse'], 'token_type'> & { token_type?: string };
export type Session = Readonly<{ userId: number; role: string }>;
export type Credentials = Readonly<{ token: string; epoch: number }>;
type Snapshot = Readonly<{ session: Session | null; expired: boolean }>;

let snapshot: Snapshot = { session: null, expired: false };
let credentials: Credentials | null = null;
let revision = 0;
const listeners = new Set<() => void>();
const cleanups = new Set<() => void>();

function publish() {
  // Cancel/remove private data before notifying React, including account switches.
  cleanups.forEach((cleanup) => cleanup());
  listeners.forEach((listener) => listener());
}

function endSession(expired: boolean) {
  revision++;
  credentials = null;
  snapshot = { session: null, expired };
  publish();
}

// Module memory only. No browser persistence, token decoding, or session restoration.
export const sessionStore = {
  getSnapshot: () => snapshot,
  getCredentials: () => credentials,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  registerPrivateCleanup(cleanup: () => void) {
    cleanups.add(cleanup);
    return () => { cleanups.delete(cleanup); };
  },
  beginAuthentication() { return ++revision; },
  isCurrentAttempt(ticket: number) { return ticket === revision; },
  cancelAuthentication(ticket: number) { if (ticket === revision) revision++; },
  login(data: TokenResponse, ticket: number) {
    if (ticket !== revision) return false;
    revision++;
    credentials = { token: data.access_token, epoch: revision };
    snapshot = { session: { userId: data.user_id, role: data.role }, expired: false };
    publish();
    return true;
  },
  logout() { endSession(false); },
  isCurrentSession(epoch: number) { return credentials?.epoch === epoch; },
  expire(epoch: number) {
    if (credentials?.epoch === epoch) endSession(true);
  },
};
