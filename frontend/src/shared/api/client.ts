import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { sessionStore } from '../session/store';
import { ApiError, StaleSessionError } from './errors';

// Paths already include /api/v1. Same-origin in production; Vite proxy in development.
export const api = createClient<paths>({
  baseUrl: '',
  credentials: 'omit',
  fetch: (...args) => globalThis.fetch(...args),
});

// Paths whose operations declare Bearer security in the current contract.
// This transports credentials; it does not grant roles or enable these features.
const protectedPaths = new Set<keyof paths>([
  '/api/v1/auth/me',
  '/api/v1/participants/register', '/api/v1/participants/my', '/api/v1/participants/{participant_id}/pay',
  '/api/v1/admin/routes', '/api/v1/admin/routes/{route_id}',
  '/api/v1/admin/checkpoints', '/api/v1/admin/checkpoints/{checkpoint_id}', '/api/v1/admin/checkpoints/batch',
  '/api/v1/typist/paper-form', '/api/v1/typist/match', '/api/v1/typist/unlinked',
]);
const requestSessions = new Map<string, number>();

api.use({
  onRequest({ request, schemaPath, id }) {
    const current = sessionStore.getCredentials();
    if (current && protectedPaths.has(schemaPath as keyof paths)) {
      request.headers.set('Authorization', `Bearer ${current.token}`);
      requestSessions.set(id, current.epoch);
    }
  },
  async onResponse({ response, id }) {
    const sent = requestSessions.get(id);
    requestSessions.delete(id);
    if (sent !== undefined && !sessionStore.isCurrentSession(sent)) throw new StaleSessionError();
    if (response.status === 401 && sent !== undefined) sessionStore.expire(sent);
    if (!response.ok) {
      let details: unknown;
      if (response.headers.get('Content-Type')?.includes('application/json')) {
        try { details = await response.clone().json(); } catch { /* Never expose HTML or malformed error bodies. */ }
      }
      throw new ApiError(response.status, details);
    }
  },
  onError({ id }) { requestSessions.delete(id); },
});
