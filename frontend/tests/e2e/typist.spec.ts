import { test, expect, login, signIn, logout, noOverflow, representativeScreenshot } from './fixtures';
import type { Page } from '@playwright/test';

const urls = ['/staff/typist', '/staff/typist/new', '/staff/typist/match', '/staff/typist/unlinked'];
const paperPath = '/api/v1/typist/paper-form', matchPath = '/api/v1/typist/match', unlinkedPath = '/api/v1/typist/unlinked';
async function fillPaper(page: Page) {
  await page.getByRole('option', { name: /Тестовый городской маршрут/ }).waitFor({ state: 'attached' });
  for (const [label, value] of [['Фамилия', 'Тестов'], ['Имя', 'Бумажный'], ['Дата рождения', '1995-05-20'], ['Email', 'paper@example.test'], ['Телефон', 'местный 123']]) await page.getByLabel(label!, { exact: true }).fill(value!);
  await page.getByLabel('Пол', { exact: true }).selectOption('male'); await page.getByLabel('Маршрут', { exact: true }).selectOption('15');
}
async function fillMatch(page: Page, form = '000F01') {
  await page.getByLabel('Номер анкеты', { exact: true }).fill(form);
  await page.getByLabel('Штрихкод физической карты', { exact: true }).fill('000001');
}
async function sendPaper(page: Page) {
  await page.getByRole('button', { name: 'Проверить анкету', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить создание анкеты', exact: true }).click();
}
async function sendMatch(page: Page) {
  await page.getByRole('button', { name: 'Проверить пару', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить сопоставление', exact: true }).click();
}

for (const [index, path] of urls.entries()) test(`staff direct URL ${path}: guest login, exact return and viewport`, async ({ page, api }, info) => {
  api.role = 'typist'; await login(page, api, path);
  await expect(page.getByRole('link', { name: 'Рабочее место', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Рабочее место наборщика', 'Бумажная анкета', 'Сопоставление с картой', 'Непривязанные карты'][index]!);
  if (index === 1) await page.getByRole('option', { name: /Тестовый городской маршрут/ }).waitFor({ state: 'attached' });
  if (index === 3) await expect(page.getByRole('list', { name: 'Выборка непривязанных карт' })).toBeVisible();
  expect(api.count('POST', paperPath) + api.count('POST', matchPath)).toBe(0);
  await noOverflow(page); await representativeScreenshot(page, info, ['staff-home', 'paper-form', 'match-form', 'unlinked'][index]!);
  if (page.viewportSize()!.width < 768) {
    await page.getByRole('button', { name: 'Открыть меню' }).click(); await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeHidden();
  }
});

for (const role of ['participant', 'organizer', 'admin', 'checkpoint', 'unknown']) test(`staff rejects ${role} without a service request`, async ({ page, api }) => {
  api.role = role; await login(page, api, urls[3]);
  await expect(page.getByRole('heading', { name: 'Нет доступа', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Рабочее место', exact: true })).toHaveCount(0);
  expect(api.calls.filter(call => call.path.startsWith('/api/v1/typist/'))).toHaveLength(0);
  await noOverflow(page);
});

test('typist default login goes to the workspace, with online and paper choices', async ({ page, api }) => {
  api.role = 'typist'; await page.goto('/login'); await signIn(page, api);
  await expect(page).toHaveURL(/\/staff\/typist$/);
  await expect(page.getByRole('link', { name: 'Сопоставить с картой', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Создать бумажную запись', exact: true })).toBeVisible();
  expect(api.calls.filter(call => call.path.startsWith('/api/v1/typist/'))).toHaveLength(0);
});

test('paper review creates one record, manually reuses server form ID and refreshes unlinked after match', async ({ page, api }) => {
  api.role = 'typist'; await login(page, api, urls[3]);
  await expect(page.getByText('000001', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Бумажная анкета', exact: true }).click(); await fillPaper(page);
  expect(api.count('POST', paperPath)).toBe(0);
  await page.getByRole('button', { name: 'Проверить анкету', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Проверка бумажной анкеты' })).toBeVisible();
  expect(api.count('POST', paperPath)).toBe(0);
  await page.getByRole('button', { name: 'Подтвердить создание анкеты', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: 'Ответ по бумажной анкете получен' })).toBeVisible();
  await expect(page.getByText('000P01', { exact: true })).toBeVisible(); await expect(page.getByText('paid', { exact: true })).toBeVisible();
  await expect(page.getByText('Отметка оплаты в системе не подтверждает получение денег.', { exact: true })).toBeVisible();
  expect(api.count('POST', paperPath)).toBe(1); expect(api.count('POST', matchPath)).toBe(0);
  await page.getByRole('link', { name: 'Перейти к сопоставлению', exact: true }).click();
  await expect(page.getByLabel('Номер анкеты')).toHaveValue('');
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => JSON.stringify(history.state).includes('000P01'))).toBe(false);
  await fillMatch(page, '000P01'); await sendMatch(page);
  await expect(page.getByRole('heading', { name: 'Ответ сопоставления получен' })).toBeVisible();
  expect(api.count('POST', matchPath)).toBe(1);
  await page.getByRole('link', { name: 'Непривязанные карты', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Выборка непривязанных карт' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('000001', { exact: true })).toHaveCount(0); await noOverflow(page);
});

test('online form uses match only, preserves zeros, requires review and ignores scanner Enter', async ({ page, api }, info) => {
  api.role = 'typist'; await login(page, api, urls[2]); await fillMatch(page);
  await page.getByLabel('Номер анкеты').focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Штрихкод физической карты')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name: 'Проверить пару', exact: true })).toBeFocused();
  expect(api.count('POST', matchPath)).toBe(0);
  await page.getByRole('button', { name: 'Проверить пару', exact: true }).click();
  const review = page.getByRole('region', { name: 'Проверка пары', exact: true });
  await expect(review).toBeVisible(); await expect(review).toBeFocused();
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await expect(review).toBeVisible();
  expect(api.count('POST', matchPath)).toBe(0); expect(api.count('POST', paperPath)).toBe(0);
  await noOverflow(page); await representativeScreenshot(page, info, 'match-review');
  await page.getByRole('button', { name: 'Подтвердить сопоставление', exact: true }).dblclick();
  await expect(page.getByText('synthetic-match-status', { exact: true })).toBeVisible();
  expect(api.count('POST', matchPath)).toBe(1); expect(api.count('POST', paperPath)).toBe(0);
  await page.getByRole('button', { name: 'Следующая пара', exact: true }).click(); await fillMatch(page);
  await page.getByRole('button', { name: 'Очистить ввод', exact: true }).click();
  await expect(page.getByLabel('Номер анкеты')).toHaveValue(''); expect(api.count('POST', matchPath)).toBe(1);
});

test('match 422 then 408 preserves pair and requires renewed risk confirmation after navigation', async ({ page, api }) => {
  api.role = 'typist'; api.matchMode = '422'; await login(page, api, urls[2]); await fillMatch(page); await sendMatch(page);
  await expect(page.getByLabel('Штрихкод физической карты')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Номер анкеты')).toHaveValue('000F01');
  api.matchMode = '408'; await sendMatch(page); await expect(page.getByText(/Результат неизвестен/)).toBeVisible();
  expect(api.count('POST', matchPath)).toBe(2);
  await page.getByRole('link', { name: 'Непривязанные карты', exact: true }).click();
  await expect(page.getByText(/Отсутствие штрихкода в выборке не подтверждает/)).toBeVisible();
  await page.getByRole('link', { name: 'Сопоставление', exact: true }).click();
  await expect(page.getByLabel('Штрихкод физической карты')).toHaveValue('000001');
  await expect(page.getByRole('button', { name: 'Проверить пару', exact: true })).toBeDisabled();
  await page.getByRole('checkbox').check(); api.matchMode = 'success';
  await page.getByRole('button', { name: 'Проверить пару', exact: true }).click(); expect(api.count('POST', matchPath)).toBe(2);
  await page.getByRole('button', { name: 'Подтвердить сопоставление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ответ сопоставления получен' })).toBeVisible(); expect(api.count('POST', matchPath)).toBe(3);
});

test('paper 422 and network interruption keep fields and route through back navigation', async ({ page, api }) => {
  api.role = 'typist'; api.paperMode = '422'; await login(page, api, urls[1]); await fillPaper(page); await sendPaper(page);
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  api.paperMode = 'network'; await sendPaper(page); await expect(page.getByText(/Результат неизвестен/)).toBeVisible();
  await page.getByRole('link', { name: 'Сценарии работы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Рабочее место наборщика', exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Бумажный');
  await expect(page.getByLabel('Маршрут', { exact: true })).toHaveValue('15');
  await expect(page.getByRole('button', { name: 'Проверить анкету', exact: true })).toBeDisabled();
  expect(api.count('POST', paperPath)).toBe(2); await noOverflow(page);
});

test('unlinked 403/500 remain errors for typist, retry is GET only', async ({ page, api }) => {
  api.role = 'typist'; api.unlinkedMode = '403'; await login(page, api, urls[3]);
  await expect(page.getByRole('alert')).toContainText('(403)');
  await expect(page.getByRole('list', { name: 'Выборка непривязанных карт' })).toHaveCount(0);
  api.unlinkedMode = '500'; await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('(500)'); api.unlinkedMode = 'success';
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Выборка непривязанных карт' })).toBeVisible();
  expect(api.count('GET', unlinkedPath)).toBe(3); expect(api.count('POST', matchPath) + api.count('POST', paperPath)).toBe(0);
});

for (const status of [200, 401]) test(`old staff POST ${status} cannot expose A result or expire typist B`, async ({ page, api }) => {
  api.role = 'typist'; const gate = api.deferStaff(); await login(page, api, urls[2]); await fillMatch(page); await sendMatch(page); await gate.seen;
  await logout(page); api.identity = 'B'; await signIn(page, api);
  await page.getByRole('link', { name: 'Рабочее место', exact: true }).click();
  await page.getByRole('link', { name: 'Сопоставить с картой', exact: true }).click();
  await expect(page.getByLabel('Номер анкеты')).toHaveValue('');
  gate.release({ status, body: { status: 'old-status', barcode: '000001', participant_id: 1, participant_name: 'Old private name', message: 'Old private result' } });
  await gate.completed;
  await expect(page.getByText(/Old private name|Old private result/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Рабочее место', exact: true })).toBeVisible();
  expect(api.count('POST', matchPath)).toBe(1); expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
