import type { Page } from '@playwright/test';
import { test, expect, login, signIn, noOverflow } from './fixtures';

const path = '/api/v1/admin/routes/12';
const dialog = (page: Page) => page.getByRole('dialog');
async function publicCatalog(page: Page) {
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Маршруты', exact: true }).click();
  await expect(page).toHaveURL(new URL('/routes', page.url()).href);
}

test('archive → public catalog → restore → reload preserves route, participants and checkpoints', async ({ page, api }, info) => {
  api.role = 'admin'; const mine = structuredClone(api.mine);
  const bodies: unknown[] = [];
  page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === path) bodies.push(request.postDataJSON()); });
  await login(page, api, '/staff/routes');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Тестовая лесная тропа', exact: true }) });
  const checkpointLink = card.getByRole('link', { name: /Контрольные пункты/ });
  await checkpointLink.click();
  await expect(page.getByRole('list', { name: 'КП выбранного маршрута' }).getByRole('listitem')).toHaveCount(3);
  const points = structuredClone([...api.checkpointRecords]);
  await page.goBack(); await expect(page).toHaveURL(new URL('/staff/routes', page.url()).href);
  await expect(page.getByRole('button', { name: /Удалить/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Архивировать.*Тестовая лесная тропа/ }).dblclick();
  await expect(dialog(page).getByRole('heading', { name: 'Архивация маршрута' })).toBeVisible();
  expect(api.count('PUT', path)).toBe(0);
  await dialog(page).getByRole('button', { name: 'Подтвердить архивацию' }).dblclick();
  await expect(dialog(page).getByRole('heading', { name: 'Маршрут перемещён в архив' })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(card.getByText('В архиве', { exact: true })).toBeVisible();
  await noOverflow(page); await page.screenshot({ path: info.outputPath('route-archived-admin.png'), fullPage: true });
  await checkpointLink.click(); await expect(page.getByRole('list', { name: 'КП выбранного маршрута' }).getByRole('listitem')).toHaveCount(3);
  await page.goBack(); await expect(page).toHaveURL(new URL('/staff/routes', page.url()).href);
  await publicCatalog(page);
  await expect(page.getByRole('heading', { name: 'Тестовая лесная тропа', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Тестовый городской маршрут', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('public-catalog-after-archive.png'), fullPage: true });
  await page.reload(); await expect(page.getByRole('heading', { name: 'Тестовый городской маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Тестовая лесная тропа', exact: true })).toHaveCount(0);
  await login(page, api, '/staff/routes');
  await page.getByLabel('Показывать маршруты').selectOption({ label: 'Архив' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Восстановить/ }).click();
  await dialog(page).getByRole('button', { name: 'Подтвердить восстановление' }).dblclick();
  await expect(dialog(page).getByRole('heading', { name: 'Маршрут восстановлен' })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(card).toHaveCount(0); // The current filter is Archive.
  await page.getByLabel('Показывать маршруты').selectOption({ label: 'Активные' }); await expect(card).toBeVisible();
  await publicCatalog(page); await expect(page.getByRole('heading', { name: 'Тестовая лесная тропа', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Тестовая лесная тропа', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('public-catalog-after-restore.png'), fullPage: true });
  expect(bodies).toEqual([{ is_active: false }, { is_active: true }]); expect(api.count('PUT', path)).toBe(2); expect(api.count('DELETE', path)).toBe(0);
  expect(api.mine).toEqual(mine); expect([...api.checkpointRecords]).toEqual(points);
  await noOverflow(page);
});

for (const mode of ['409', '422', '403', '408', 'network'] as const) test(`archive ${mode} keeps state honest and never retries automatically`, async ({ page, api }, info) => {
  api.role = 'admin'; api.adminMode = mode; await login(page, api, '/staff/routes');
  await page.getByRole('button', { name: /Архивировать.*Тестовая лесная тропа/ }).click();
  await dialog(page).getByRole('button', { name: 'Подтвердить архивацию' }).click();
  await expect(dialog(page).getByRole('alert').first()).toBeVisible();
  await expect(dialog(page).getByRole('heading', { name: 'Маршрут перемещён в архив' })).toHaveCount(0);
  expect(api.publicRoutes.find(route => route.id === 12)?.is_active).toBe(true);
  expect(api.count('PUT', path)).toBe(1); expect(api.count('DELETE', path)).toBe(0);
  if (mode === '408' || mode === 'network') {
    await dialog(page).getByRole('button', { name: 'Проверить состояние в каталоге' }).click();
    await expect(dialog(page).getByRole('button', { name: 'Проверить перед архивацией' })).toBeDisabled();
    await dialog(page).getByRole('button', { name: 'Закрыть и проверить позже' }).click();
    await expect(page.getByText(/Отложена операция с неизвестным исходом/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Архивировать.*Тестовая лесная тропа/ })).toBeDisabled();
  }
  await noOverflow(page); await page.screenshot({ path: info.outputPath(`archive-${mode}.png`), fullPage: false });
  expect(api.count('PUT', path)).toBe(1);
});

test('pending archive can be deferred, and a late reply cannot expose data to the next session', async ({ page, api }) => {
  api.role = 'admin'; const gate = api.deferAdmin(); await login(page, api, '/staff/routes');
  await page.getByRole('button', { name: /Архивировать.*Тестовая лесная тропа/ }).click();
  await dialog(page).getByRole('button', { name: 'Подтвердить архивацию' }).click(); await gate.seen;
  await dialog(page).getByRole('button', { name: 'Закрыть и проверить позже' }).click();
  await expect(page.getByText(/Отложена операция с неизвестным исходом/)).toBeVisible();
  await page.reload(); api.identity = 'B'; await signIn(page, api);
  gate.release({ status: 200, body: { ...api.publicRoutes[0], name: 'Old archive response', is_active: false } }); await gate.completed;
  await expect(page.getByText('Old archive response')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(api.count('PUT', path)).toBe(1); expect(api.count('DELETE', path)).toBe(0);
});
