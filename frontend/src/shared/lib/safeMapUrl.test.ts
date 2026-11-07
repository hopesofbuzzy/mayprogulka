import { describe, expect, it } from 'vitest';
import { safeMapUrl } from './safeMapUrl';

describe('map URLs', () => {
  it.each([null, undefined, '', 'javascript:alert(1)', 'data:text/html,test', '//other.example/map', 'https://other.example/map', 'http://user:pass@localhost:3000/map'])('rejects unapproved address %s', (value) => {
    expect(safeMapUrl(value)).toBeNull();
  });
  it('allows a same-origin path', () => {
    expect(safeMapUrl('/maps/route.pdf')).toBe(`${window.location.origin}/maps/route.pdf`);
  });
});
