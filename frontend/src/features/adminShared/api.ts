import { StaleSessionError } from '../../shared/api/errors';
import { sessionStore } from '../../shared/session/store';

export class AdminFailure extends Error {
  constructor(message: string, public readonly uncertain = false, public readonly details: unknown = undefined) { super(message); }
}
export const currentAdmin = (epoch: number) => sessionStore.isCurrentSession(epoch) && sessionStore.getSnapshot().session?.role === 'admin';
export function requireAdmin(epoch: number) { if (!currentAdmin(epoch)) throw new StaleSessionError(); }
