import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sessionStore } from '../../shared/session/store';
import type { Session } from '../../shared/session/store';

type Auth = { session: Session | null; isAuthenticated: boolean; expired: boolean; logout: (locationKey?: string) => void };
const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);
  const queryClient = useQueryClient();
  useEffect(() => sessionStore.registerPrivateCleanup(() => {
    const filters = { predicate: (query: { queryKey: readonly unknown[]; meta?: Record<string, unknown> }) => query.meta?.private === true || query.queryKey[0] === 'private' };
    void queryClient.cancelQueries(filters);
    queryClient.removeQueries(filters);
    queryClient.getMutationCache().clear();
  }), [queryClient]);
  return <AuthContext.Provider value={{ ...snapshot, isAuthenticated: snapshot.session !== null, logout: sessionStore.logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider is required');
  return auth;
}
