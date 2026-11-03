import type { Page, TestInfo } from '@playwright/test';
import { test, expect, login, signIn, noOverflow, representativeScreenshot } from './fixtures';

const ui = '/staff/routes/12/checkpoints', endpoint = '/api/v1/admin/checkpoints';
const dialog = (page: Page) => page.getByRole('dialog');
async function shot(page: Page, info: TestInfo, name: string) { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: false }); }
async function open(page: Page, kind: 'create' | 'edit' | 'delete') {
  const list = page.getByRole('list', { name: 'КП выбранного маршрута' }); await expect(list).toBeVisible();
  if (kind === 'create') await page.getByRole('button', { name: 'Создать один КП' }).click();
  else await list.getByRole('listitem').filter({ hasText: 'Checkpoint ID 1201 ·' }).getByRole('button', { name: kind === 'edit' ? /Изменить КП/ : /Удалить КП/ }).click();
  await expect(dialog(page)).toBeVisible();
  if (kind === 'create') for (const [label, value] of [['Название КП', 'Синтетический новый КП'], ['Адрес', 'Синтетический адрес'], ['Координаты (строка)', '  synthetic opaque;000  '], ['Порядок', '0005']]) await dialog(page).getByLabel(label!, { exact: true }).fill(value!);
  if (kind === 'edit') await dialog(page).getByLabel('Название КП', { exact: true }).fill('Изменённый старт');
}
async function send(page: Page, kind: 'create' | 'edit' | 'delete') {
  if (kind === 'delete') await dialog(page).getByLabel('Введите checkpoint ID 1201').fill('1201');
  else { await dialog(page).getByRole('button', { name: 'Проверить данные КП' }).click(); await expect(dialog(page).getByRole('region', { name: 'Проверка КП' })).toBeFocused(); }
  await dialog(page).getByRole('button', { name: kind === 'create' ? 'Подтвердить создание КП' : kind === 'edit' ? 'Подтвердить изменения КП' : 'Подтвердить удаление КП' }).click();
}

for (const role of ['participant', 'typist', 'organizer', 'unknown', 'Admin']) test(`checkpoint page denies ${role} without public or admin reads`, async ({ page, api }) => {
  api.role = role; await login(page, api, ui); await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
  expect(api.calls.filter(call => call.path === '/api/v1/routes' || call.path.includes('checkpoints'))).toHaveLength(0); await noOverflow(page);
});

test('checkpoint URL login, route navigation, back-forward, reload and public read isolation', async ({ page, api }) => {
  api.role = 'admin'; await login(page, api, ui); await expect(page.getByRole('heading', { name: 'КП маршрута', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Контрольные пункты маршрута — Майская прогулка');
  await page.getByRole('link', { name: '← Управление маршрутами' }).click();
  await page.getByRole('link', { name: /Контрольные пункты.*Тестовый городской маршрут/ }).click();
  await expect(page).toHaveURL(/\/staff\/routes\/15\/checkpoints$/); await expect(page.getByRole('list', { name: 'КП выбранного маршрута' })).toContainText('route_id 15');
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Управление маршрутами', exact: true })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/\/staff\/routes\/12\/checkpoints$/); await expect(page.getByRole('list', { name: 'КП выбранного маршрута' })).not.toContainText('route_id 15');
  await page.goForward(); await expect(page).toHaveURL(/\/staff\/routes$/);
  expect(api.calls.filter(call => call.method === 'GET').every(call => !call.authenticated)).toBe(true);
  await page.goBack(); await page.reload(); await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible(); await noOverflow(page);
});

test('single checkpoint CRUD preserves opaque coordinates, partial false and shared public detail', async ({ page, api }, info) => {
  api.role = 'admin'; await login(page, api, ui); await expect(page.getByRole('list', { name: 'КП выбранного маршрута' })).toBeVisible();
  await noOverflow(page); await representativeScreenshot(page, info, 'cp-list');
  await open(page, 'create'); await noOverflow(page); await shot(page, info, 'cp-create');
  await dialog(page).getByLabel('Порядок', { exact: true }).press('Enter'); expect(api.count('POST', endpoint)).toBe(0);
  await dialog(page).getByRole('button', { name: 'Проверить данные КП' }).click(); await expect(dialog(page).getByRole('region', { name: 'Проверка КП' })).toBeFocused();
  await page.keyboard.press('Enter'); expect(api.count('POST', endpoint)).toBe(0); await dialog(page).getByRole('button', { name: 'Подтвердить создание КП' }).dblclick();
  await expect(dialog(page).getByRole('heading', { name: 'Создание КП подтверждено' })).toBeVisible(); await expect(dialog(page).getByText('Список КП перечитан с сервера.')).toBeVisible();
  expect(api.count('POST', endpoint)).toBe(1); const created = api.checkpointRecords.get(12)!.find(point => point.id === 1205)!; expect(created.coordinates).toBe('  synthetic opaque;000  '); expect(created.order).toBe(5); expect(created.is_start || created.is_finish).toBe(false);
  await dialog(page).getByRole('button', { name: 'Закрыть', exact: true }).click(); await open(page, 'edit'); await dialog(page).getByLabel('Флаг начального КП', { exact: true }).uncheck();
  await noOverflow(page); await shot(page, info, 'cp-edit'); await send(page, 'edit'); await expect(dialog(page).getByRole('heading', { name: 'Изменение КП подтверждено' })).toBeVisible(); await expect(dialog(page).getByText('Список КП перечитан с сервера.')).toBeVisible();
  expect(api.checkpointRecords.get(12)!.find(point => point.id === 1201)!.is_start).toBe(false);
  await dialog(page).getByRole('button', { name: 'Закрыть', exact: true }).click(); await page.getByRole('link', { name: 'Публичный маршрут →' }).click();
  await expect(page.getByRole('list', { name: 'Контрольные пункты маршрута' })).toContainText('Изменённый старт'); await page.goBack(); await open(page, 'delete');
  const confirm = dialog(page).getByRole('button', { name: 'Подтвердить удаление КП' }); await dialog(page).getByLabel('Введите checkpoint ID 1201').fill('12'); await expect(confirm).toBeDisabled();
  await dialog(page).getByLabel('Введите checkpoint ID 1201').fill('1201'); await page.keyboard.press('Enter'); expect(api.count('DELETE', endpoint + '/1201')).toBe(0);
  await noOverflow(page); await shot(page, info, 'cp-delete-confirmation'); await confirm.focus(); await page.keyboard.press('Enter');
  await expect(dialog(page).getByRole('heading', { name: 'Операция удаления КП подтверждена' })).toBeVisible(); await expect(dialog(page).getByText('Список КП перечитан с сервера.')).toBeVisible(); expect(api.count('DELETE', endpoint + '/1201')).toBe(1);
});

test('unknown DELETE can be deferred and never replayed for that ID after navigation', async ({ page, api }, info) => {
  api.role = 'admin'; api.checkpointWriteMode = '408'; await login(page, api, ui); await open(page, 'delete'); await send(page, 'delete');
  await expect(dialog(page).getByText('Исход операции неизвестен', { exact: true })).toBeVisible(); await noOverflow(page); await shot(page, info, 'cp-unknown-delete');
  await dialog(page).getByRole('button', { name: 'Закрыть и разобраться позже' }).click(); await expect(dialog(page)).toHaveCount(0); await expect(page.getByRole('main')).toBeFocused();
  const locked = page.getByRole('listitem').filter({ hasText: 'Checkpoint ID 1201 ·' }).getByRole('button', { name: /Удалить КП/ }); await expect(locked).toBeDisabled();
  await noOverflow(page); await representativeScreenshot(page, info, 'cp-deferred-delete');
  await page.getByRole('link', { name: '← Управление маршрутами' }).click(); await expect(page.getByRole('heading', { name: 'Управление маршрутами', exact: true })).toBeVisible(); await page.goBack(); await expect(locked).toBeDisabled();
  await page.getByRole('button', { name: 'Открыть проверку отложенной операции 1' }).click(); await expect(dialog(page).getByRole('button', { name: 'Подтвердить удаление КП' })).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Проверить список КП' }).click(); await expect(dialog(page).getByText('Просмотреть перечитанный список')).toBeVisible(); expect(api.count('DELETE', endpoint + '/1201')).toBe(1);
});

test('POST timeout is unknown, keeps draft and needs responsible check plus fresh confirmation', async ({ page, api }) => {
  api.role = 'admin'; api.checkpointWriteMode = 'timeout'; await login(page, api, ui); await open(page, 'create'); await send(page, 'create');
  await expect(dialog(page).getByText('Исход операции неизвестен', { exact: true })).toBeVisible(); await expect(dialog(page).getByLabel('Координаты (строка)')).toHaveValue('  synthetic opaque;000  ');
  await expect(dialog(page).getByRole('button', { name: 'Проверить данные КП' })).toBeDisabled(); await dialog(page).getByRole('button', { name: 'Проверить список КП' }).click();
  const risk = dialog(page).getByRole('checkbox', { name: /Я проверил с ответственным/ }); await expect(risk).toBeEnabled(); await risk.check(); api.checkpointWriteMode = 'success';
  await dialog(page).getByRole('button', { name: 'Проверить данные КП' }).click(); expect(api.count('POST', endpoint)).toBe(1);
  await dialog(page).getByRole('button', { name: 'Подтвердить создание КП' }).click(); await expect(dialog(page).getByRole('heading', { name: 'Создание КП подтверждено' })).toBeVisible(); expect(api.count('POST', endpoint)).toBe(2); await noOverflow(page);
});

test('PUT 409/422 preserves values, escapes error details and is never a false success', async ({ page, api }) => {
  api.role = 'admin'; api.checkpointWriteMode = '409'; await login(page, api, ui); await open(page, 'edit'); await send(page, 'edit');
  await expect(dialog(page).getByRole('alert')).toContainText('(409)'); api.checkpointWriteMode = '422'; await send(page, 'edit');
  await expect(dialog(page).getByLabel('Координаты (строка)')).toHaveAttribute('aria-invalid', 'true'); await expect(dialog(page)).not.toContainText('<script>untrusted</script>');
  await expect(dialog(page).getByLabel('Название КП')).toHaveValue('Изменённый старт'); expect(api.count('PUT', endpoint + '/1201')).toBe(2); await noOverflow(page);
});

test('stale checkpoint baseline requires refresh and explicit adoption without overwriting unrelated address', async ({ page, api }) => {
  api.role = 'admin'; await login(page, api, ui); await open(page, 'edit');
  api.checkpointRecords.set(12, api.checkpointRecords.get(12)!.map(point => point.id === 1201 ? { ...point, address: 'Синтетическая конкурентная правка' } : point));
  await dialog(page).getByRole('button', { name: 'Перечитать КП перед действием' }).click();
  await expect(dialog(page).getByText(/Исходная запись изменилась/)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Принять перечитанную основу, сохранив мои изменения' }).click(); await send(page, 'edit');
  await expect(dialog(page).getByRole('heading', { name: 'Изменение КП подтверждено' })).toBeVisible(); expect(api.checkpointRecords.get(12)!.find(point => point.id === 1201)!.address).toBe('Синтетическая конкурентная правка'); await noOverflow(page);
});

for (const kind of ['create', 'edit', 'delete'] as const) for (const status of [200, 401]) test(`late checkpoint ${kind} ${status} from A cannot affect admin B`, async ({ page, api }) => {
  api.role = 'admin'; const gate = api.deferCheckpoint(); await login(page, api, ui); await open(page, kind); await send(page, kind); await gate.seen;
  await dialog(page).getByRole('button', { name: 'Выйти', exact: true }).click(); api.identity = 'B'; await signIn(page, api); await expect(page.getByRole('heading', { name: 'КП маршрута', exact: true })).toBeVisible();
  gate.release({ status: status === 401 ? 401 : kind === 'create' ? 201 : kind === 'delete' ? 204 : 200, body: { id: 1201, route_id: 12, name: 'Old checkpoint response', address: 'Synthetic', coordinates: 'opaque', order: 1, is_start: false, is_finish: false } }); await gate.completed;
  await expect(dialog(page)).toHaveCount(0); await expect(page.getByText('Old checkpoint response')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Создать один КП' })).toBeVisible(); await noOverflow(page);
});

test('confirmed checkpoint write survives failed GET; manual retry is only selected checkpoint GET', async ({ page, api }) => {
  api.role = 'admin'; api.checkpointReadFailure = true; await login(page, api, ui); await open(page, 'create'); await send(page, 'create');
  await expect(dialog(page).getByRole('heading', { name: 'Создание КП подтверждено' })).toBeVisible(); await expect(dialog(page).getByText('Операция с КП подтверждена, но перечитать список не удалось.')).toBeVisible();
  const routesReads = api.count('GET', '/api/v1/routes'); api.checkpointMode = 'success'; await dialog(page).getByRole('button', { name: 'Повторить только GET КП' }).click();
  await expect(dialog(page).getByText('Список КП перечитан с сервера.')).toBeVisible(); expect(api.count('POST', endpoint)).toBe(1); expect(api.count('GET', '/api/v1/routes')).toBe(routesReads);
});

test('checkpoint invalid/foreign GET and empty responses stay honest and recover with GET retry', async ({ page, api }) => {
  api.role = 'admin'; api.checkpointMode = 'foreign'; await login(page, api, ui); await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('list', { name: 'КП выбранного маршрута' })).toHaveCount(0);
  api.checkpointMode = 'empty'; await page.getByRole('button', { name: 'Повторить GET КП' }).click(); await expect(page.getByText('В публичном списке этого маршрута КП пока нет.')).toBeVisible();
  api.checkpointMode = 'success'; await page.getByRole('button', { name: 'Обновить КП' }).click(); await expect(page.getByRole('list', { name: 'КП выбранного маршрута' }).getByRole('listitem')).toHaveCount(3); await noOverflow(page);
});
