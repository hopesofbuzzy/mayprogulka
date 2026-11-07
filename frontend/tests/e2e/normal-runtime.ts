import { test as base } from '@playwright/test';
import { test, expect, login, noOverflow } from './fixtures';

base('normal dev shows transport failure with no synthetic catalog or live request', async ({ page, baseURL }, info) => {
  const origin = new URL(baseURL!).origin, calls: string[] = [], violations: string[] = [], errors: string[] = [];
  page.on('pageerror', () => errors.push('Uncaught JavaScript error'));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { violations.push('External network blocked'); return route.abort('blockedbyclient'); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() === 'GET' && url.pathname === '/api/v1/routes' && !url.search && !request.headers().authorization) { calls.push(url.pathname); return route.abort('failed'); }
    violations.push('Unexpected API request blocked'); return route.abort('blockedbyclient');
  });
  await page.goto('/routes'); await expect(page.getByRole('heading', { name: 'Маршруты пока недоступны' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Список маршрутов' })).toHaveCount(0); expect(calls).toHaveLength(1);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect.poll(() => calls.length).toBe(2);
  await expect(page.getByRole('heading', { name: 'Маршруты пока недоступны' })).toBeVisible(); await noOverflow(page);
  await page.screenshot({ path: info.outputPath('normal-api-unavailable.png') }); expect(violations).toEqual([]); expect(errors).toEqual([]);
});

test('ordinary dev ignores accidental batch opt-in; single operations remain accessible', async ({ page, api }) => {
  api.role = 'admin'; await login(page, api, '/staff/routes/12/checkpoints'); await expect(page.getByRole('heading', { name: 'КП маршрута', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить несколько КП' })).toHaveCount(0); await page.getByRole('button', { name: 'Создать один КП' }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); expect(api.count('POST', '/api/v1/admin/checkpoints/batch')).toBe(0);
});
