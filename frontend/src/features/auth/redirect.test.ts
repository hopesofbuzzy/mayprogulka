import { describe, expect, it } from 'vitest';
import { authReturnState, returnToFromState, roleHome, safeReturnTo } from './redirect';

describe('role-compatible login destinations', () => {
  it.each([['participant', '/account'], ['admin', '/staff/routes'], ['typist', '/staff/typist'], ['organizer', '/'], ['unknown', '/']])('%s defaults to %s without inventing a private role', (role, home) => {
    expect(roleHome(role)).toBe(home);
    expect(returnToFromState(null, role)).toBe(home);
    expect(returnToFromState({ returnTo: '//outside.test' }, role)).toBe(home);
    expect(authReturnState(null)).toBeUndefined();
  });
  it.each(['participant', 'typist', 'organizer', 'unknown'])('ignores an admin intent after login as %s', role => {
    for (const returnTo of ['/staff/routes', '/staff/routes/12/checkpoints']) expect(returnToFromState({ returnTo }, role)).toBe(roleHome(role));
  });
  it.each(['participant', 'admin', 'organizer'])('ignores a typist intent after login as %s', role => {
    expect(returnToFromState({ returnTo: '/staff/typist/match' }, role)).toBe(roleHome(role));
  });
  it('preserves compatible explicit intents, including admin participation, without turning a fallback into an intent', () => {
    expect(returnToFromState({ returnTo: '/account/participants/new' }, 'admin')).toBe('/account/participants/new');
    expect(returnToFromState({ returnTo: '/staff/typist/match' }, 'typist')).toBe('/staff/typist/match');
    expect(returnToFromState({ returnTo: '/staff/routes/12/checkpoints' }, 'admin')).toBe('/staff/routes/12/checkpoints');
    expect(returnToFromState({ returnTo: '/staff/routes' })).toBe('/staff/routes');
    expect(authReturnState({ returnTo: '/account?section=family#list' })).toEqual({ returnTo: '/account?section=family#list' });
    expect(safeReturnTo('/login')).toBe('/account');
  });
});
