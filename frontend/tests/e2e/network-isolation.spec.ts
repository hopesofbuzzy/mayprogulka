import { test, expect } from '@playwright/test';
import { MockApi } from './fixtures';

// Test the guard itself with intentionally forbidden traffic. Ordinary journeys
// use the auto fixture, whose teardown fails on any such violation.
test('network guard aborts unexpected GET/POST and external traffic without a live fallback', async ({ context, page, baseURL }) => {
  const guard = new MockApi(); await guard.install(context, new URL(baseURL!).origin);
  await page.goto('/');
  for (const [url, method] of [['/api/v1/not-in-contract', 'GET'], ['/api/v1/admin/maps', 'POST'], ['https://external.example.test/api/v1/routes', 'GET']]) {
    const blocked = await page.evaluate(async ({ url, method }) => {
      try { await fetch(url!, { method }); return false; } catch { return true; }
    }, { url, method });
    expect(blocked).toBe(true);
  }
  expect(guard.violations).toEqual(['Unexpected API method/path blocked', 'Unexpected API method/path blocked', 'Blocked non-test origin']);
  expect(guard.errors).toEqual([]);
});
