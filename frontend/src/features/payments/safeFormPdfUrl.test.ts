import { describe, expect, it } from 'vitest';
import { safeFormPdfUrl } from './safeFormPdfUrl';

const origin = 'https://walk.example.test';
const path = '/test-approved/forms/00123.pdf';
const allowlist = [path]; // Explicit test policy, not an inferred backend path.
describe('PDF URL policy', () => {
  it('fails closed with the unconfigured production allowlist', () => {
    expect(safeFormPdfUrl(path)).toBeNull();
  });
  it('accepts exact relative/absolute same-origin PDF paths only under an explicit policy', () => {
    expect(safeFormPdfUrl(path, allowlist, origin)).toBe(origin + path);
    expect(safeFormPdfUrl(origin + path, allowlist, origin)).toBe(origin + path);
  });
  it.each([null, undefined, '', 123, 'javascript:alert(1)', 'data:application/pdf,test', 'blob:https://walk.example.test/file', '//evil.example/test-approved/forms/00123.pdf', '//walk.example.test/test-approved/forms/00123.pdf', 'https://evil.example/test-approved/forms/00123.pdf', 'http://127.0.0.1:8000/test-approved/forms/00123.pdf', 'https://user:pass@walk.example.test/test-approved/forms/00123.pdf', '/api/v1/participants/42/pay', '/other.pdf', '/test-approved/forms/00123.pdf?token=test', '/test-approved/forms/00123.pdf#view', '/redirect?next=/test-approved/forms/00123.pdf', '/wrong/../test-approved/forms/00123.pdf', '/test-approved/forms/%30%30%31%32%33.pdf', '/test-approved/forms/00123.pdf%0a', '/test-approved/forms/00123.pdf%250a', '/test-approved\\forms/00123.pdf', ' /test-approved/forms/00123.pdf', '/test-approved/forms/00123.pdf\n', 'test-approved/forms/00123.pdf'])('blocks an untrusted URL %#', value => {
    expect(safeFormPdfUrl(value, allowlist, origin)).toBeNull();
  });
});
