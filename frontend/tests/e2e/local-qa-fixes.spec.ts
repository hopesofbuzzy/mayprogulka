import type { Locator, Page } from '@playwright/test';
import { test, expect, login, logout, signIn, noOverflow } from './fixtures';

async function stableInput(page: Page, input: Locator, text = '1234567890') {
  await input.fill(''); await input.focus();
  await input.pressSequentially(text, { delay: 12 });
  await expect(input).toHaveValue(text); await expect(input).toBeFocused();
  for (let n = 0; n < 5; n++) await page.keyboard.press('Backspace');
  await expect(input).toHaveValue(text.slice(0, -5)); await expect(input).toBeFocused();
  await page.keyboard.insertText('54321');
  await expect(input).toHaveValue(text.slice(0, -5) + '54321'); await expect(input).toBeFocused();
}

test('route focus stays stable before/after validation and 422, with keyboard close and restore', async ({ page, api }, info) => {
  api.role = 'admin'; await login(page, api, '/staff/routes');
  const opener = page.getByRole('button', { name: 'Новый маршрут', exact: true });
  await opener.click(); const modal = page.getByRole('dialog');
  await expect(modal.getByRole('button', { name: /Выйти/ })).toHaveCount(0);
  for (const label of ['Год', 'Название', 'Дистанция, км', 'Описание']) await stableInput(page, modal.getByLabel(label, { exact: true }));
  await modal.getByLabel('Год', { exact: true }).fill('12221');
  await modal.getByRole('button', { name: 'Проверить данные', exact: true }).click();
  await expect(modal.getByLabel('Год', { exact: true })).toBeFocused();
  await expect(modal.getByText('Укажите год от 1900 до 2100')).toBeVisible();
  for (const label of ['Описание', 'Дистанция, км', 'Название', 'Год']) await stableInput(page, modal.getByLabel(label, { exact: true }));
  await modal.getByLabel('Год', { exact: true }).fill('2030'); await modal.getByLabel('Дистанция, км').fill('12');
  await modal.getByRole('button', { name: 'Проверить данные', exact: true }).click();
  api.adminMode = '422'; await modal.getByRole('button', { name: 'Подтвердить создание', exact: true }).click();
  await expect(modal.getByLabel('Название', { exact: true })).toBeFocused();
  await stableInput(page, modal.getByLabel('Описание', { exact: true }), 'ОписаниеКП');
  await modal.getByLabel('Название', { exact: true }).focus(); await page.keyboard.press('Tab');
  await expect(modal.getByLabel('Дистанция, км')).toBeFocused();
  await noOverflow(page); await page.screenshot({ path: info.outputPath('route-focus-validation.png') });
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0); await expect(opener).toBeFocused();
  expect(api.count('POST', '/api/v1/admin/routes')).toBe(1);
});

for (const batch of [false, true]) test(`${batch ? 'batch' : 'single'} checkpoint focus and WGS84 validation preserve typed text and flags`, async ({ page, api }, info) => {
  api.role = 'admin'; await login(page, api, '/staff/routes/12/checkpoints');
  const opener = page.getByRole('button', { name: batch ? 'Добавить несколько КП' : 'Создать один КП', exact: true });
  await opener.click(); const modal = page.getByRole('dialog');
  if (batch) await modal.getByRole('button', { name: 'Удалить строку 2' }).click();
  const check = modal.getByRole('button', { name: batch ? 'Проверить перед отправкой' : 'Проверить данные КП', exact: true });
  await check.click(); await expect(modal.getByLabel('Название КП', { exact: true })).toBeFocused();
  await check.click(); await expect(modal.getByLabel('Название КП', { exact: true })).toBeFocused();
  for (const label of ['Название КП', 'Адрес', 'Координаты', 'Порядок прохождения']) await stableInput(page, modal.getByLabel(label, { exact: true }));
  await modal.getByLabel('Порядок прохождения').fill('0'); await modal.getByLabel('Координаты').fill('91, 60.60');
  await check.click(); await expect(modal.getByLabel('Координаты')).toBeFocused();
  await expect(modal.getByLabel('Координаты')).toHaveAttribute('aria-invalid', 'true');
  const coordinates = '  -56.8300, +060.6000  '; await modal.getByLabel('Координаты').fill(coordinates);
  await modal.getByLabel('Старт маршрута', { exact: true }).check(); await modal.getByLabel('Финиш маршрута', { exact: true }).check();
  await check.click(); await expect(modal.getByRole('region', { name: batch ? 'Проверка партии' : 'Проверка КП', exact: true })).toBeFocused();
  await expect(modal).toContainText(coordinates.trim());
  await noOverflow(page); await page.screenshot({ path: info.outputPath(batch ? 'batch-wgs84-review.png' : 'checkpoint-wgs84-review.png') });
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0); await expect(opener).toBeFocused();
  expect(api.calls.filter(call => call.method !== 'GET' && call.path.includes('checkpoints'))).toHaveLength(0);
});

test('ordinary role changes and incompatible deep-link intent do not produce a login 403', async ({ page, api }, info) => {
  for (const [role, home] of [['participant', '/account'], ['admin', '/staff/routes'], ['participant', '/account'], ['typist', '/staff/typist'], ['organizer', '/']]) {
    api.role = role!; await page.goto('/login');
    const tabs = page.getByRole('navigation', { name: 'Доступ к аккаунту' });
    await tabs.getByRole('link', { name: 'Регистрация', exact: true }).click(); await tabs.getByRole('link', { name: 'Вход', exact: true }).click();
    await signIn(page, api); await expect(page).toHaveURL(new URL(home!, page.url()).href);
    await expect(page.getByRole('heading', { name: 'Нет доступа', exact: true })).toHaveCount(0);
    await logout(page);
  }
  api.role = 'participant'; await page.goto('/staff/routes/12/checkpoints'); await signIn(page, api);
  await expect(page).toHaveURL(/\/account$/); await expect(page.getByRole('heading', { name: 'Нет доступа' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('participant-after-role-cycle.png'), fullPage: true });
});

test('administrative inactive filter keeps history and leaves the source list intact', async ({ page, api }, info) => {
  api.role = 'admin'; await login(page, api, '/staff/routes');
  const filter = page.getByLabel('Показывать маршруты'); await expect(filter).toHaveValue('all');
  await expect(page.getByRole('heading', { name: 'Неактивный тестовый маршрут', exact: true })).toBeVisible();
  await filter.selectOption('active'); await expect(page.getByRole('heading', { name: 'Неактивный тестовый маршрут', exact: true })).toHaveCount(0);
  await filter.selectOption('inactive'); await expect(page.getByRole('heading', { name: 'Неактивный тестовый маршрут', exact: true })).toBeVisible();
  expect(api.publicRoutes).toHaveLength(3); expect(api.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/api/v1/admin'))).toHaveLength(0);
  await noOverflow(page); await page.screenshot({ path: info.outputPath('inactive-route-filter.png'), fullPage: true });
});

test('DELETE followed by authoritative inactive GET explains retained history without repeating the operation', async ({ page, api }, info) => {
  api.role = 'admin'; api.adminDeleteArchives = true; await login(page, api, '/staff/routes');
  await page.getByRole('button', { name: /Удалить.*Тестовая лесная тропа/ }).click();
  const modal = page.getByRole('dialog'); await modal.getByLabel('Для подтверждения введите ID 12').fill('12');
  await modal.getByRole('button', { name: 'Подтвердить удаление', exact: true }).dblclick();
  await expect(modal.getByText(/В обновлённом каталоге маршрут неактивен/)).toBeVisible();
  await expect(modal.getByText(/Удаление подтверждено, но маршрут всё ещё виден/)).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Подтвердить удаление', exact: true })).toHaveCount(0);
  expect(api.count('DELETE', '/api/v1/admin/routes/12')).toBe(1);
  await modal.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByLabel('Показывать маршруты').selectOption('inactive');
  await expect(page.getByRole('heading', { name: 'Тестовая лесная тропа', exact: true })).toBeVisible();
  await noOverflow(page); await page.screenshot({ path: info.outputPath('inactive-after-delete.png'), fullPage: true });
});

test('invalid participant fields block registration and allow shared family contacts after correction', async ({ page, api }, info) => {
  await login(page, api, '/account/participants/new');
  await page.getByRole('option', { name: /Тестовая лесная тропа/ }).waitFor({ state: 'attached' });
  for (const [label, value] of [['Фамилия', '123'], ['Имя', '456'], ['Телефон', 'abc'], ['Дата рождения', '2999-01-01'], ['Email', 'family@example.test']]) await page.getByLabel(label!, { exact: true }).fill(value!);
  await page.getByLabel('Пол', { exact: true }).selectOption('female'); await page.getByLabel('Маршрут', { exact: true }).selectOption('12');
  await page.getByRole('button', { name: 'Зарегистрировать участников', exact: true }).click();
  for (const label of ['Фамилия', 'Имя', 'Телефон', 'Дата рождения']) await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('aria-invalid', 'true');
  expect(api.count('POST', '/api/v1/participants/register')).toBe(0);
  await noOverflow(page); await page.screenshot({ path: info.outputPath('participant-field-errors.png'), fullPage: true });
  for (const [label, value] of [['Фамилия', 'О’Коннор'], ['Имя', 'Анна-Мария'], ['Телефон', '+7 (900) 123-45-67'], ['Дата рождения', '1995-05-20']]) await page.getByLabel(label!, { exact: true }).fill(value!);
  await page.getByRole('button', { name: 'Добавить ещё участника' }).click(); const second = page.getByRole('group', { name: 'Участник 2', exact: true });
  await expect(second.getByLabel('Фамилия', { exact: true })).toBeFocused();
  for (const [label, value] of [['Фамилия', '王'], ['Имя', '小明'], ['Телефон', '+7 (900) 123-45-67'], ['Дата рождения', '2000-02-29'], ['Email', 'family@example.test']]) await second.getByLabel(label!, { exact: true }).fill(value!);
  await second.getByLabel('Пол', { exact: true }).selectOption('male'); await second.getByLabel('Маршрут', { exact: true }).selectOption('15');
  await page.getByRole('button', { name: 'Зарегистрировать участников', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Регистрация подтверждена' })).toBeVisible(); expect(api.count('POST', '/api/v1/participants/register')).toBe(1);
});
