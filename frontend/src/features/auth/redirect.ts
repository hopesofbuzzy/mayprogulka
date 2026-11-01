const allowedPaths = new Set(['/', '/routes', '/account']);

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
    const participantPath = /^\/account\/participants\/(new|\d+)$/.exec(url.pathname);
    const supportedParticipant = participantPath && (participantPath[1] === 'new' || Number.isSafeInteger(Number(participantPath[1])));
    if (url.origin !== 'https://internal.invalid' || (!allowedPaths.has(url.pathname) && !supportedParticipant)) return '/account';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/account'; }
}

export function returnToFromState(state: unknown) {
  return safeReturnTo(state && typeof state === 'object' && 'returnTo' in state ? state.returnTo : undefined);
}
