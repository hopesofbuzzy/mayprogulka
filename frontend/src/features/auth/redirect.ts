const staffPaths = new Set(['/staff/routes', '/staff/typist', '/staff/typist/new', '/staff/typist/match', '/staff/typist/unlinked']);
const allowedPaths = new Set(['/', '/routes', '/account', ...staffPaths]);

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || [...value].some(char => char.charCodeAt(0) <= 32)) return '/account';
  try {
    const unsafe = (text: string) => text.includes('\\') || [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
    let decoded = value;
    for (let round = 0; round < 3; round++) {
      if (unsafe(decoded)) return '/account';
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (unsafe(decoded)) return '/account';
    const url = new URL(value, 'https://internal.invalid');
    if (staffPaths.has(url.pathname) && value !== url.pathname) return '/account';
    const participantPath = /^\/account\/participants\/(new|\d+(?:\/pay)?)$/.exec(url.pathname);
    const supportedParticipant = participantPath && (participantPath[1] === 'new' || Number.isSafeInteger(Number(participantPath[1]!.split('/')[0])));
    if (url.origin !== 'https://internal.invalid' || (!allowedPaths.has(url.pathname) && !supportedParticipant)) return '/account';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/account'; }
}

export function returnToFromState(state: unknown, role?: string) {
  if (state && typeof state === 'object' && 'returnTo' in state) return safeReturnTo(state.returnTo);
  return role === 'admin' ? '/staff/routes' : role === 'typist' ? '/staff/typist' : '/account';
}
