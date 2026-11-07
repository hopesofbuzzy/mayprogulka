import { approvedFormPdfPaths } from './pdfPolicy';

export function safeFormPdfUrl(value: unknown, paths: readonly string[] = approvedFormPdfPaths, origin = window.location.origin): string | null {
  if (typeof value !== 'string' || !value || value.startsWith('//')) return null;
  // Exact, unencoded static PDF paths only: no query, fragment, credentials,
  // redirects, traversal, whitespace, or alternate URL-parser interpretations.
  const match = /^(?:https?:\/\/[^/\s\\@?#%]+)?(\/[A-Za-z0-9_/-]+\.pdf)$/.exec(value);
  if (!match || match[1]!.split('/').some(part => part === '.' || part === '..') || !paths.includes(match[1]!)) return null;
  try {
    const url = new URL(value, origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(origin).origin || url.username || url.password || url.search || url.hash || url.pathname !== match[1]) return null;
    return url.href;
  } catch { return null; }
}
