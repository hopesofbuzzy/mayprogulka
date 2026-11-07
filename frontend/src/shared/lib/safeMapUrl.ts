// Until map origins are agreed, only same-origin HTTP(S) resources can be opened.
export function safeMapUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
