const allowedPaths = new Set(['/', '/routes', '/account']);

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || [...value].some((char) => char.charCodeAt(0) <= 32)) return '/account';
  try {
    const url = new URL(value, 'https://internal.invalid');
    if (url.origin !== 'https://internal.invalid' || !allowedPaths.has(url.pathname)) return '/account';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/account'; }
}

export function returnToFromState(state: unknown) {
  return safeReturnTo(state && typeof state === 'object' && 'returnTo' in state ? state.returnTo : undefined);
}
