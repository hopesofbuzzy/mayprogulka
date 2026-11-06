import type { Page, TestInfo } from '@playwright/test';
import { test, expect, login, signIn, noOverflow, representativeScreenshot } from './fixtures';

const path = '/staff/routes/12/checkpoints', apiPath = '/api/v1/admin/checkpoints/batch';
const modal = (page: Page) => page.getByRole('dialog');
async function shot(page: Page, info: TestInfo, name: string) { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: false }); }
async function start(page: Page) {
  await page.getByRole('button', { name: 'Добавить несколько КП' }).click();
  await expect(modal(page)).toBeVisible();
  for (const index of [1, 2]) {
    const row = modal(page).getByRole('group', { name: `Строка ${index} — номер в интерфейсе`, exact: true });
    for (const [label, value] of [['Название КП', `Синтетическая строка ${index}`], ['Адрес', 'Синтетический адрес'], ['Координаты', '  56.8300, 060.6000  '], ['Порядок прохождения', index === 1 ? '0005' : '-1']]) await row.getByLabel(label!, { exact: true }).fill(value!);
  }
}
async function review(page: Page) { await modal(page).getByRole('button', { name: 'Проверить перед отправкой' }).click(); await expect(modal(page).getByRole('region', { name: 'Проверка партии', exact: true })).toBeFocused(); }
async function confirm(page: Page) { await modal(page).getByLabel('Введите ID маршрута 12', { exact: true }).fill('12'); await modal(page).getByRole('checkbox', { name: /Понимаю риск/ }).check(); await modal(page).getByRole('button', { name: 'Создать 2 КП', exact: true }).click(); }
async function noDialogOverflow(page: Page) { await noOverflow(page); expect(await modal(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); }

for (const role of ['participant', 'typist', 'organizer', 'unknown', 'Admin']) test(`batch opt-in never grants role ${role}`, async ({ page, api }) => {
  api.role = role; await login(page, api, path); await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить несколько КП' })).toHaveCount(0); expect(api.calls.filter(call => call.path.includes('checkpoints') || call.path === '/api/v1/routes')).toHaveLength(0); await noOverflow(page);
});

test('batch one request, two route_id levels, review confirmation and public GET', async ({ page, api }, info) => {
  api.role = 'admin'; await login(page, api, path); await expect(page.getByRole('list', { name: 'КП выбранного маршрута' })).toBeVisible();
  await representativeScreenshot(page, info, 'batch-list'); await start(page); await noDialogOverflow(page); await shot(page, info, 'batch-rows');
  await modal(page).evaluate(element => { element.scrollTop = 0; }); await shot(page, info, 'batch-top');
  await modal(page).getByRole('group').nth(0).getByLabel('Название КП').press('Enter'); expect(api.count('POST', apiPath)).toBe(0);
  await review(page); await noDialogOverflow(page); await shot(page, info, 'batch-review');
  await modal(page).getByLabel('Введите ID маршрута 12').fill('012'); await modal(page).getByRole('checkbox', { name: /Понимаю риск/ }).check(); await expect(modal(page).getByRole('button', { name: 'Создать 2 КП' })).toBeDisabled();
  await modal(page).getByRole('button', { name: 'Вернуться к строкам' }).click(); await review(page); await expect(modal(page).getByRole('checkbox', { name: /Понимаю риск/ })).not.toBeChecked();
  await confirm(page); await expect(modal(page).getByText('Сервер сообщил о создании 2 из 2 КП', { exact: true })).toBeVisible(); await expect(modal(page).getByText(/Список КП обновлён/)).toBeVisible();
  expect(api.count('POST', apiPath)).toBe(1); expect(api.count('POST', '/api/v1/admin/checkpoints')).toBe(0); expect(api.calls.filter(call => call.path === apiPath)[0]!.routeIds).toEqual([12, 12]);
  const created = api.checkpointRecords.get(12)!.filter(point => point.id > 5000); expect(created.map(point => point.coordinates)).toEqual(['  56.8300, 060.6000  ', '  56.8300, 060.6000  ']); expect(created.map(point => point.order)).toEqual([5, -1]);
  await modal(page).getByRole('button', { name: 'Закрыть партию' }).click(); await expect(page.getByRole('button', { name: 'Добавить несколько КП' })).toBeFocused();
  await page.getByRole('link', { name: 'Публичный маршрут →' }).click(); await expect(page.getByRole('list', { name: 'Контрольные пункты маршрута' })).toContainText('Синтетическая строка 2'); await page.goBack(); await expect(page.getByRole('heading', { name: 'КП маршрута', exact: true })).toBeVisible(); expect(api.count('POST', apiPath)).toBe(1); await page.reload(); await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
});

for (const mode of ['partial', 'contradictory', 'zero'] as const) test(`${mode} is not per-row success; postpone and explicit outside resolution`, async ({ page, api }, info) => {
  api.role = 'admin'; api.batchMode = mode; await login(page, api, path); await start(page); await review(page); await confirm(page);
  await expect(modal(page).getByText(/Частичный или противоречивый результат/)).toBeVisible(); await expect(modal(page).getByText(/Список КП обновлён/)).toBeVisible();
  await noDialogOverflow(page); await shot(page, info, 'batch-' + mode);
  if (mode !== 'zero') { await expect(modal(page).getByRole('heading', { name: 'Сообщение сервера №1' })).toBeVisible(); await expect(modal(page).getByRole('link')).toHaveCount(0); }
  await page.keyboard.press('Escape'); await expect(modal(page)).toHaveCount(0); await expect(page.getByRole('button', { name: 'Создать один КП' })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Добавить несколько КП' })).toBeDisabled(); await expect(page.getByRole('button', { name: /Изменить КП/ }).first()).toBeEnabled();
  await page.getByRole('link', { name: '← Управление маршрутами' }).click(); await expect(page.getByRole('heading', { name: 'Управление маршрутами', exact: true })).toBeVisible(); await page.getByRole('link', { name: /Контрольные пункты.*Тестовый городской/ }).click(); await expect(page.getByRole('button', { name: 'Создать один КП' })).toBeEnabled(); await page.goBack(); await expect(page.getByRole('heading', { name: 'Управление маршрутами', exact: true })).toBeVisible(); await page.goBack(); await expect(page.getByText(/Партия КП требует разбора/)).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться к проверке партии' }).click();
  await Promise.all([page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1/checkpoints'), modal(page).getByRole('button', { name: /Обновить список КП/ }).click()]);
  await expect(modal(page).getByRole('button', { name: /Обновить список КП/ })).toBeEnabled();
  await modal(page).getByLabel('Введите ID маршрута 12').fill('12'); await modal(page).getByRole('checkbox', { name: /С ответственным разобрано/ }).check(); await modal(page).getByRole('button', { name: 'Разобрано вне приложения' }).click(); await expect(modal(page).getByText(/Снята только локальная блокировка/)).toBeVisible();
  await modal(page).getByRole('button', { name: 'Закрыть партию' }).click(); await expect(page.getByRole('button', { name: 'Создать один КП' })).toBeEnabled(); expect(api.count('POST', apiPath)).toBe(1);
});

for (const mode of ['408', '500', 'network', 'timeout', 'malformed'] as const) test(`${mode} never repeats batch; unknown can close and resume`, async ({ page, api }, info) => {
  api.role = 'admin'; api.batchMode = mode; await login(page, api, path); await start(page); await review(page); await confirm(page); await expect(modal(page).getByText('Исход партии неизвестен', { exact: true })).toBeVisible();
  await noDialogOverflow(page); if (mode === '408') await shot(page, info, 'batch-unknown'); await modal(page).getByRole('button', { name: 'Отложить разбор / закрыть' }).click(); await expect(page.getByText(/Партия КП требует разбора/)).toBeVisible(); if (mode === '408') await representativeScreenshot(page, info, 'batch-postponed');
  await page.getByRole('button', { name: 'Вернуться к проверке партии' }).click(); await modal(page).getByRole('button', { name: /Обновить список КП/ }).click(); await expect(modal(page).getByRole('button', { name: /Обновить список КП/ })).toBeEnabled(); await expect(modal(page).getByRole('button', { name: 'Создать 2 КП' })).toHaveCount(0); expect(api.count('POST', apiPath)).toBe(1);
});

for (const mode of ['403', '409', '422'] as const) test(`batch ${mode} preserves rows and nested validation`, async ({ page, api }) => {
  api.role = 'admin'; api.batchMode = mode; await login(page, api, path); await start(page); await review(page); await confirm(page); await expect(modal(page).getByRole('alert').filter({ hasText: `(${mode})` })).toBeVisible();
  await expect(modal(page).getByRole('group').nth(0).getByLabel('Название КП')).toHaveValue('Синтетическая строка 1');
  if (mode === '422') { await expect(modal(page).getByRole('group').nth(1).getByLabel('Координаты')).toHaveAttribute('aria-invalid', 'true'); await expect(modal(page)).not.toContainText('<script>untrusted</script>'); }
  expect(api.count('POST', apiPath)).toBe(1); await noDialogOverflow(page);
});

for (const status of [201, 401]) test(`late batch ${status} after reload cannot expose A or expire B`, async ({ page, api }) => {
  api.role = 'admin'; const pending = api.deferBatch(); await login(page, api, path); await start(page); await review(page); await confirm(page); await pending.seen;
  await page.goto(path); api.identity = 'B'; await signIn(page, api); await expect(page.getByRole('button', { name: 'Добавить несколько КП' })).toBeVisible();
  pending.release({ status, body: status === 201 ? { created_count: 2, errors: [{ secret: 'Old batch response' }] } : {} }); await pending.completed;
  await expect(modal(page)).toHaveCount(0); await expect(page.getByText('Old batch response')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Создать один КП' })).toBeEnabled(); expect(api.count('POST', apiPath)).toBe(1); await noOverflow(page);
});

test('report survives failed GET and pending Escape leaves an inspectable case', async ({ page, api }) => {
  api.role = 'admin'; api.batchReadFailure = true; await login(page, api, path); await start(page); await review(page); await confirm(page);
  await expect(modal(page).getByText(/Ответ получен, но обновить список не удалось/)).toBeVisible(); await expect(modal(page).getByText('Сервер сообщил о создании 2 из 2 КП')).toBeVisible(); expect(api.count('POST', apiPath)).toBe(1); await modal(page).getByRole('button', { name: 'Закрыть партию' }).click();
  api.checkpointMode = 'success'; api.batchReadFailure = false; await page.getByRole('button', { name: 'Добавить несколько КП' }).click(); await modal(page).getByRole('button', { name: 'Начать новую пустую партию' }).click(); await modal(page).getByRole('button', { name: 'Закрыть партию' }).click();
  const pending = api.deferBatch(); await start(page); await review(page); await confirm(page); await pending.seen; await page.keyboard.press('Escape'); await expect(modal(page)).toHaveCount(0); await expect(page.getByText(/Партия КП требует разбора/)).toBeVisible(); expect(api.count('POST', apiPath)).toBe(2);
  pending.release({ status: 201, body: { created_count: 2, errors: [] } }); await pending.completed; await page.getByRole('button', { name: 'Вернуться к проверке партии' }).click(); await expect(modal(page).getByText('Исход партии неизвестен', { exact: true })).toBeVisible();
});
