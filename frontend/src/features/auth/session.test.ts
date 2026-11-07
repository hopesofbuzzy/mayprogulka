import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { sessionStore } from '../../shared/session/store';
import { api } from '../../shared/api/client';
import { authenticate, CancelledAuthError } from './api';
import { ApiError, StaleSessionError } from '../../shared/api/errors';

const transport = vi.fn<typeof fetch>();
const reply = (user = 1) => ({ access_token: `test-only-token-${user}`, user_id: user, role: user === 1 ? 'participant' : 'future-role' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function login(user = 1) { sessionStore.login(reply(user), sessionStore.beginAuthentication()); }
const input = { username: 'test_walker', email: '', password: 'example-pass' };
beforeEach(() => { sessionStore.logout(); transport.mockReset(); vi.stubGlobal('fetch', transport); });
afterEach(() => { sessionStore.logout(); });

describe('shared Bearer client and session isolation', () => {
  it('sends Bearer for the protected request; routes remain public even when signed in', async () => {
    login();
    transport.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ routes: [] }));
    await api.GET('/api/v1/auth/me');
    await api.GET('/api/v1/routes');
    expect((transport.mock.calls[0]![0] as Request).headers.get('Authorization')).toBe(`Bearer ${reply().access_token}`);
    expect((transport.mock.calls[1]![0] as Request).headers.has('Authorization')).toBe(false);
    expect((transport.mock.calls[0]![0] as Request).credentials).toBe('omit');
  });
  it('guest routes never need a token', async () => {
    transport.mockResolvedValue(json({ routes: [] }));
    await api.GET('/api/v1/routes');
    expect((transport.mock.calls[0]![0] as Request).headers.has('Authorization')).toBe(false);
  });
  it('expires the current session only on protected 401', async () => {
    login();
    transport.mockResolvedValue(json({}, 401));
    await expect(api.GET('/api/v1/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(sessionStore.getSnapshot()).toEqual({ session: null, expired: true });
    expect(sessionStore.getCredentials()).toBeNull();
  });
  it.each([403, 500, 502])('does not clear a session on HTTP %i', async (status) => {
    login();
    transport.mockResolvedValue(json({}, status));
    await expect(api.GET('/api/v1/auth/me')).rejects.toMatchObject({ status });
    expect(sessionStore.getSnapshot().session?.userId).toBe(1);
  });
  it('does not clear a session on network failure or a public 401', async () => {
    login();
    transport.mockRejectedValueOnce(new TypeError('network failure')).mockResolvedValueOnce(json({}, 401));
    await expect(api.GET('/api/v1/auth/me')).rejects.toBeInstanceOf(TypeError);
    await expect(api.GET('/api/v1/routes')).rejects.toBeInstanceOf(ApiError);
    expect(sessionStore.getSnapshot().session?.userId).toBe(1);
  });
  it.each([200, 401])('rejects an old protected HTTP %i without changing the new session', async (status) => {
    login();
    let resolve!: (response: Response) => void;
    transport.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const old = api.GET('/api/v1/auth/me');
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    sessionStore.logout();
    login(2);
    resolve(json({}, status));
    await expect(old).rejects.toBeInstanceOf(StaleSessionError);
    expect(sessionStore.getSnapshot().session?.userId).toBe(2);
  });
  it('a late auth response after logout cannot resurrect a session', async () => {
    let resolve!: (response: Response) => void;
    transport.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const pending = authenticate('login', input, new AbortController().signal);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    sessionStore.logout();
    resolve(json(reply()));
    await expect(pending).rejects.toBeInstanceOf(CancelledAuthError);
    expect(sessionStore.getSnapshot().session).toBeNull();
  });
  it('a later sign-in wins over an older auth response, even if the old transport ignores cancellation', async () => {
    let resolveOld!: (response: Response) => void;
    transport.mockImplementationOnce(() => new Promise<Response>(done => { resolveOld = done; })).mockResolvedValueOnce(json(reply(2)));
    const older = authenticate('login', input, new AbortController().signal);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    await authenticate('login', input, new AbortController().signal);
    resolveOld(json(reply(1)));
    await expect(older).rejects.toBeInstanceOf(CancelledAuthError);
    expect(sessionStore.getSnapshot().session).toEqual({ userId: 2, role: 'future-role' });
  });
  it('private cleanup runs before observers see login, logout or account switching', () => {
    const events: string[] = [];
    const unregister = sessionStore.registerPrivateCleanup(() => events.push('cleanup'));
    const unsubscribe = sessionStore.subscribe(() => events.push('observe'));
    login(); sessionStore.logout(); login(2);
    expect(events).toEqual(['cleanup', 'observe', 'cleanup', 'observe', 'cleanup', 'observe']);
    unregister(); unsubscribe();
  });
  it('a freshly loaded module has no session and never uses browser persistence', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    login();
    expect(sessionStore.getCredentials()).not.toBeNull();
    vi.resetModules();
    const { sessionStore: fresh } = await import('../../shared/session/store');
    expect(fresh.getSnapshot()).toEqual({ session: null, expired: false });
    expect(fresh.getCredentials()).toBeNull();
    expect(local).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
  });
});
