import type { Page, TestInfo } from '@playwright/test';
import { test, expect, login, signIn, noOverflow, representativeScreenshot } from './fixtures';

const path = '/api/v1/admin/routes';
const dialog = (page: Page) => page.getByRole('dialog');
async function modalScreenshot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  // Native dialog backdrops cover the viewport; capture that viewport, not the
  // scrollable document below it, so the screenshot reflects the actual overlay.
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: false });
}
async function open(page: Page, kind: 'create' | 'edit' | 'delete') {
  await expect(page.getByRole('list', { name: 'Маршруты из публичного каталога' })).toBeVisible();
  await page.getByRole('button', { name: kind === 'create' ? 'Новый маршрут' : kind === 'edit' ? /Изменить.*Тестовая лесная тропа/ : /Удалить.*Тестовая лесная тропа/ }).click();
  await expect(dialog(page)).toBeVisible();
  if (kind === 'create') { await dialog(page).getByLabel('Год', { exact: true }).fill('2030'); await dialog(page).getByLabel('Название', { exact: true }).fill('Тестовый новый путь'); await dialog(page).getByLabel('Дистанция, км').fill('12,5'); }
  if (kind === 'edit') await dialog(page).getByLabel('Название', { exact: true }).fill('Тестовое новое название');
}
async function send(page: Page, kind: 'create' | 'edit' | 'delete') {
  if (kind !== 'delete') { await dialog(page).getByRole('button', { name: 'Проверить данные' }).click(); await expect(dialog(page).getByRole('region', { name: 'Проверка маршрута' })).toBeFocused(); }
  else await dialog(page).getByLabel('Для подтверждения введите ID 12').fill('12');
  await dialog(page).getByRole('button', { name: kind === 'create' ? 'Подтвердить создание' : kind === 'edit' ? 'Подтвердить изменения' : 'Подтвердить удаление' }).click();
}

for (const role of ['participant', 'typist', 'organizer', 'unknown', 'Admin']) test(`admin workspace rejects ${role} with no routes/admin traffic`, async ({ page, api }) => {
  api.role = role; await login(page, api, '/staff/routes');
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
  expect(api.count('GET', '/api/v1/routes')).toBe(0);
  expect(api.calls.filter(call => call.path.startsWith(path))).toHaveLength(0); await noOverflow(page);
});

test('admin default login, header/menu navigation, back-forward, Escape and memory-only reload', async ({ page, api }) => {
  api.role = 'admin'; await page.goto('/login'); await signIn(page, api);
  await expect(page).toHaveURL(/\/staff\/routes$/); await expect(page.getByRole('heading', { name: 'Управление маршрутами', exact: true })).toBeVisible();
  await open(page, 'edit'); await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Изменить.*Тестовая лесная тропа/ })).toBeFocused();
  const mainLink = page.getByRole('banner').getByRole('link', { name: 'Майская прогулка — главная' }); await mainLink.click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Город становится');
  if (page.viewportSize()!.width < 768) {
    await page.getByRole('button', { name: 'Открыть меню' }).click(); await page.getByRole('navigation').getByRole('link', { name: 'Управление маршрутами' }).click();
  } else await page.getByRole('banner').getByRole('link', { name: 'Управление маршрутами' }).click();
  await expect(page.getByRole('heading', { name: 'Управление маршрутами', exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByRole('heading', { level: 1 })).toContainText('Город становится');
  await page.goForward(); await expect(page.getByRole('heading', { name: 'Управление маршрутами', exact: true })).toBeVisible();
  await noOverflow(page); await page.reload(); await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('admin creates, edits partial fields and confirms DELETE by keyboard, refreshing public views', async ({ page, api }, info) => {
  api.role = 'admin'; await login(page, api, '/staff/routes');
  await noOverflow(page); await representativeScreenshot(page, info, 'admin-routes');
  await open(page, 'create'); await noOverflow(page); await modalScreenshot(page, info, 'admin-create');
  await send(page, 'create'); await expect(dialog(page).getByRole('heading', { name: 'Создание подтверждено' })).toBeVisible();
  await expect(dialog(page).getByText('Каталог перечитан с сервера.')).toBeVisible(); expect(api.count('POST', path)).toBe(1);
  await dialog(page).getByRole('button', { name: 'Закрыть' }).click();
  await open(page, 'edit'); await dialog(page).getByLabel('Название', { exact: true }).fill('Тестовая лесная тропа');
  await dialog(page).getByLabel('Флаг активности', { exact: true }).uncheck(); await noOverflow(page); await modalScreenshot(page, info, 'admin-edit');
  await send(page, 'edit'); await expect(dialog(page).getByRole('heading', { name: 'Изменение подтверждено' })).toBeVisible();
  await expect(dialog(page).getByText('Каталог перечитан с сервера.')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('list', { name: 'Маршруты из публичного каталога' }).getByRole('link', { name: 'Публичная страница →', exact: true }).first().click();
  await expect(page.getByText('Неактивный маршрут', { exact: true })).toBeVisible(); await page.goBack();
  await open(page, 'delete'); const confirm = dialog(page).getByRole('button', { name: 'Подтвердить удаление' }); await expect(confirm).toBeDisabled();
  await dialog(page).getByLabel('Для подтверждения введите ID 12').fill('12');
  await page.keyboard.press('Enter'); expect(api.count('DELETE', path + '/12')).toBe(0);
  await noOverflow(page); await modalScreenshot(page, info, 'admin-delete-confirmation');
  await confirm.focus(); await page.keyboard.press('Enter');
  await expect(dialog(page).getByRole('heading', { name: 'Сервер подтвердил операцию' })).toBeVisible();
  await expect(dialog(page).getByText('Каталог перечитан с сервера.')).toBeVisible(); expect(api.count('DELETE', path + '/12')).toBe(1);
  await dialog(page).getByRole('button', { name: 'Закрыть' }).click(); await expect(page.getByRole('button', { name: /Изменить.*Тестовая лесная тропа/ })).toHaveCount(0);
  expect(api.calls.filter(call => call.path === '/api/v1/routes').every(call => !call.authenticated)).toBe(true);
});

test('unknown POST 408 preserves form and needs check, risk acknowledgment and fresh review', async ({ page, api }, info) => {
  api.role = 'admin'; api.adminMode = '408'; await login(page, api, '/staff/routes'); await open(page, 'create'); await send(page, 'create');
  await expect(dialog(page).getByText('Исход предыдущей операции неизвестен.')).toBeVisible();
  await expect(dialog(page).getByLabel('Название', { exact: true })).toHaveValue('Тестовый новый путь');
  const review = dialog(page).getByRole('button', { name: 'Проверить данные' }); await expect(review).toBeDisabled();
  await noOverflow(page); await modalScreenshot(page, info, 'admin-unknown-post');
  await dialog(page).getByRole('button', { name: 'Проверить состояние в каталоге' }).click();
  const risk = dialog(page).getByRole('checkbox', { name: /Я сверил ситуацию/ }); await expect(risk).toBeEnabled(); await risk.check();
  api.adminMode = 'success'; await review.click(); expect(api.count('POST', path)).toBe(1);
  await dialog(page).getByRole('button', { name: 'Подтвердить создание' }).dblclick();
  await expect(dialog(page).getByRole('heading', { name: 'Создание подтверждено' })).toBeVisible(); expect(api.count('POST', path)).toBe(2);
});

test('POST indexed field 422 and actual server 403 keep input without fake success', async ({ page, api }) => {
  api.role = 'admin'; api.adminMode = '422'; await login(page, api, '/staff/routes'); await open(page, 'create'); await send(page, 'create');
  await expect(dialog(page).getByLabel('Название', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog(page)).not.toContainText('untrusted admin detail'); api.adminMode = '403'; await send(page, 'create');
  await expect(dialog(page).getByRole('alert')).toContainText('(403)'); await expect(dialog(page)).not.toContainText('Создание подтверждено');
  expect(api.count('POST', path)).toBe(2); await noOverflow(page);
});

test('PUT conflict then field 422 and unknown 408 preserve the edit without blind repeat', async ({ page, api }) => {
  api.role = 'admin'; api.adminMode = '409'; await login(page, api, '/staff/routes'); await open(page, 'edit'); await send(page, 'edit');
  await expect(dialog(page).getByRole('alert')).toContainText('(409)');
  api.adminMode = '422'; await send(page, 'edit'); await expect(dialog(page).getByLabel('Название', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  api.adminMode = '408'; await send(page, 'edit'); await expect(dialog(page).getByText('Исход предыдущей операции неизвестен.')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Проверить данные' })).toBeDisabled(); expect(api.count('PUT', path + '/12')).toBe(3); await noOverflow(page);
});

for (const mode of ['408', 'network'] as const) test(`unknown DELETE ${mode} offers verification only, never direct retry`, async ({ page, api }) => {
  api.role = 'admin'; api.adminMode = mode; await login(page, api, '/staff/routes'); await open(page, 'delete'); await send(page, 'delete');
  await expect(dialog(page).getByText('Исход предыдущей операции неизвестен.')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Подтвердить удаление' })).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Проверить состояние в каталоге' }).click();
  await expect(dialog(page).getByText('Каталог запрошен заново. Сам результат записи по нему не доказан.')).toBeVisible();
  expect(api.count('DELETE', path + '/12')).toBe(1); await noOverflow(page);
});

for (const kind of ['create', 'edit', 'delete'] as const) for (const status of [200, 401]) test(`late admin ${kind} ${status} cannot leak A state or expire admin B`, async ({ page, api }) => {
  api.role = 'admin'; const gate = api.deferAdmin(); await login(page, api, '/staff/routes'); await open(page, kind); await send(page, kind); await gate.seen;
  await dialog(page).getByRole('button', { name: 'Выйти', exact: true }).click(); api.identity = 'B'; await signIn(page, api);
  await expect(page.getByRole('heading', { name: 'Управление маршрутами', exact: true })).toBeVisible();
  gate.release({ status: status === 401 ? 401 : kind === 'create' ? 201 : kind === 'delete' ? 204 : 200, body: { id: 101, name: 'Old admin result', year: 2030, distance: 1, is_active: true } }); await gate.completed;
  await expect(dialog(page)).toHaveCount(0); await expect(page.getByText('Old admin result')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Новый маршрут' })).toBeVisible(); await noOverflow(page);
});

test('confirmed write survives failing catalog refresh; manual retry is GET only', async ({ page, api }) => {
  api.role = 'admin'; api.adminReadFailure = true; await login(page, api, '/staff/routes'); await open(page, 'create'); await send(page, 'create');
  await expect(dialog(page).getByRole('heading', { name: 'Создание подтверждено' })).toBeVisible();
  await expect(dialog(page).getByText('Операция подтверждена, но обновление списка не удалось.')).toBeVisible();
  api.routeMode = 'success'; await dialog(page).getByRole('button', { name: 'Перечитать каталог' }).click(); await expect(dialog(page).getByText('Каталог перечитан с сервера.')).toBeVisible();
  expect(api.count('POST', path)).toBe(1); await noOverflow(page);
});
