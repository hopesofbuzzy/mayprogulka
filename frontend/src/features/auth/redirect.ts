import { checkpointPathId } from '../routes/model';

const staffPaths = new Set(['/staff/routes', '/staff/typist', '/staff/typist/new', '/staff/typist/match', '/staff/typist/unlinked']);
const allowedPaths = new Set(['/', '/about', '/how-to', '/faq', '/routes', '/account', ...staffPaths]);

function parsedReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || [...value].some(char => char.charCodeAt(0) <= 32)) return undefined;
  try {
    const unsafe = (text: string) => text.includes('\\') || [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
    let decoded = value;
    for (let round = 0; round < 3; round++) {
      if (unsafe(decoded)) return undefined;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (unsafe(decoded)) return undefined;
    const url = new URL(value, 'https://internal.invalid');
    const checkpointPath = checkpointPathId(url.pathname) !== null;
    if ((staffPaths.has(url.pathname) || checkpointPath) && value !== url.pathname) return undefined;
    const participantPath = /^\/account\/participants\/(new|\d+(?:\/pay)?)$/.exec(url.pathname);
    const supportedParticipant = participantPath && (participantPath[1] === 'new' || Number.isSafeInteger(Number(participantPath[1]!.split('/')[0])));
    if (url.origin !== 'https://internal.invalid' || (!allowedPaths.has(url.pathname) && !supportedParticipant && !checkpointPath)) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return undefined; }
}

export const safeReturnTo = (value: unknown): string => parsedReturnTo(value) ?? '/account';

export function roleHome(role?: string): string {
  if (role === 'admin') return '/staff/routes';
  if (role === 'typist') return '/staff/typist';
  return role === 'participant' || role === undefined ? '/account' : '/';
}

// Preserve an actual deep-link intent between auth tabs, never a fallback home.
export function authReturnState(state: unknown): { returnTo: string } | undefined {
  if (!state || typeof state !== 'object' || !('returnTo' in state)) return undefined;
  const returnTo = parsedReturnTo(state.returnTo);
  return returnTo ? { returnTo } : undefined;
}

export function returnToFromState(state: unknown, role?: string) {
  const target = authReturnState(state)?.returnTo;
  if (!target) return roleHome(role);
  const pathname = new URL(target, 'https://internal.invalid').pathname;
  if ((pathname === '/staff/routes' || checkpointPathId(pathname) !== null) && role !== undefined && role !== 'admin') return roleHome(role);
  if (pathname.startsWith('/staff/typist') && role !== undefined && role !== 'typist') return roleHome(role);
  // An explicit /account intent remains valid for admin until product policy says otherwise.
  return target;
}
