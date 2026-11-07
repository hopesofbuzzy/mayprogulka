import { test, expect, login, signIn, logout, familyForm, fillFamily, noOverflow, representativeScreenshot } from './fixtures';
import { otherParticipants } from './data';

const registerPath = '/api/v1/participants/register';
const myPath = '/api/v1/participants/my';
const payPath = '/api/v1/participants/42/pay';
const payPage = '/account/participants/42/pay';

test('public pages: routes, inactive route, API/HTML errors and UI 404', async ({ page, api }, info) => {
  await page.goto('/'); await expect(page.getByRole('heading', { level: 1 })).toContainText(/Город становится\s*ближе/);
  await noOverflow(page); await representativeScreenshot(page, info, 'public');
  await page.goto('/routes');
  await expect(page.getByRole('list', { name: 'Список маршрутов' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Неактивный тестовый маршрут' })).toHaveCount(0);
  await noOverflow(page);
  for (const error of ['500', 'html'] as const) {
    api.routeMode = error; await page.reload();
    await expect(page.getByRole('heading', { name: 'Маршруты пока недоступны' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Список маршрутов' })).toHaveCount(0);
    await noOverflow(page);
  }
  await page.goto('/unknown-test-ui'); await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
  await noOverflow(page);
});

test('private direct URL, UI login with Bearer GET, then logout removes private data', async ({ page, api }) => {
  await login(page, api);
  await expect(page.getByRole('list', { name: 'Мои участники' })).toBeVisible();
  expect(api.count('POST', '/api/v1/auth/login')).toBe(1);
  expect(api.calls.filter(call => call.path === myPath).every(call => call.authenticated)).toBe(true);
  await noOverflow(page);
  await logout(page);
  await expect(page.getByText('Тестов Первый', { exact: true })).toHaveCount(0);
  await page.goto('/account'); await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  expect(api.count('GET', myPath)).toBe(1);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('UI account signup then two participants with distinct routes and individual forms', async ({ page, api }) => {
  api.mine = [];
  await page.goto('/signup');
  await page.getByLabel('Имя пользователя').fill('synthetic-test-account');
  await page.getByLabel('Email', { exact: true }).fill('account@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill(api.password);
  await page.getByLabel('Повторите пароль', { exact: true }).fill(api.password);
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Личный кабинет', exact: true })).toBeVisible();
  expect(api.count('POST', '/api/v1/auth/register')).toBe(1);
  await page.getByRole('link', { name: /Добавить участника/ }).first().click();
  await fillFamily(page);
  const gets = api.count('GET', myPath);
  await page.getByRole('button', { name: 'Зарегистрировать участников', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Регистрация подтверждена', exact: true })).toBeVisible();
  await expect(page.getByText('Номер анкеты: 00042', { exact: true })).toBeVisible();
  await expect(page.getByText('Номер анкеты: 00077', { exact: true })).toBeVisible();
  await expect(page.getByText('Список участников обновлён по данным сервера.', { exact: true })).toBeVisible();
  expect(api.count('POST', registerPath)).toBe(1);
  expect(api.calls.find(call => call.path === registerPath)?.routeIds).toEqual([12, 15]);
  expect(api.count('GET', myPath)).toBe(gets + 1);
  await page.getByRole('link', { name: 'В личный кабинет', exact: true }).click();
  const list = page.getByRole('list', { name: 'Мои участники' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('000777'); await expect(list).toContainText('00042'); await expect(list).toContainText('00077');
  await noOverflow(page);
});

test('indexed 422 and uncertain registration preserve rows and require conscious manual retry', async ({ page, api }) => {
  api.mine = []; api.registrationMode = '422';
  await familyForm(page, api);
  const first = page.getByRole('group', { name: 'Участник 1', exact: true });
  const second = page.getByRole('group', { name: 'Участник 2', exact: true });
  await page.getByRole('button', { name: 'Зарегистрировать участников', exact: true }).click();
  await expect(second.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  await expect(first.getByLabel('Email')).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByText('untrusted fixture detail')).toHaveCount(0);
  api.registrationMode = '408';
  await page.getByRole('button', { name: 'Зарегистрировать участников', exact: true }).click();
  await expect(page.getByText('Результат предыдущей отправки неизвестен.', { exact: true })).toBeVisible();
  await expect(first.getByLabel('Имя', { exact: true })).toHaveValue('Первый');
  await expect(second.getByLabel('Имя', { exact: true })).toHaveValue('Вторая');
  await expect(first.getByLabel('Маршрут', { exact: true })).toHaveValue('12');
  await expect(second.getByLabel('Маршрут', { exact: true })).toHaveValue('15');
  const retry = page.getByRole('button', { name: 'Повторить отправку с риском дублирования', exact: true });
  await expect(retry).toBeDisabled(); expect(api.count('POST', registerPath)).toBe(2);
  await page.getByRole('button', { name: 'Проверить в личном кабинете', exact: true }).click();
  await expect(page.getByText(/Список сейчас пуст. Это не доказывает/)).toBeVisible();
  await expect(retry).toBeDisabled(); expect(api.count('POST', registerPath)).toBe(2);
  await noOverflow(page);
  await page.getByRole('checkbox').check(); await expect(retry).toBeEnabled();
  api.registrationMode = 'success'; await retry.click();
  await expect(page.getByRole('heading', { name: 'Регистрация подтверждена', exact: true })).toBeVisible();
  expect(api.count('POST', registerPath)).toBe(3);
});

test('payment: keyboard method selection, one POST, authoritative GET and null PDF', async ({ page, api }) => {
  await login(page, api, '/account/participants/42');
  await page.getByRole('link', { name: 'Оплата участия', exact: true }).click();
  const radio = page.getByRole('radio', { name: 'СБП', exact: true });
  await expect(radio).toBeEnabled();
  await radio.focus(); await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  expect(await radio.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  const gate = api.deferPayment();
  await page.getByRole('button', { name: 'Продолжить без списания', exact: true }).dblclick(); await gate.seen;
  await expect(page.getByRole('button', { name: 'Выполняем…', exact: true })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'СБП', exact: true })).toBeDisabled();
  expect(api.count('POST', payPath)).toBe(1);
  expect(api.calls.find(call => call.path === payPath)?.paymentMethod).toBe('sbp');
  api.mine = api.mine.map(item => item.id === 42 ? { ...item, payment_status: 'paid' } : item);
  gate.release({ status: 200, body: { status: 'synthetic-status', payment_id: 'synthetic-operation-id', form_pdf_url: null } });
  await expect(page.getByText('Отмечено в системе', { exact: true })).toBeVisible();
  await expect(page.getByText('Анкета для печати пока недоступна', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть анкету для печати' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Проверить статус', exact: true })).toHaveCount(0);
  expect(api.count('POST', payPath)).toBe(1);
  await page.getByRole('link', { name: 'В личный кабинет', exact: true }).click();
  const second = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Тестова Вторая', exact: true }) });
  await expect(second).toContainText('Не отмечено'); await expect(second).not.toContainText('Отмечено в системе');
  await noOverflow(page);
});

for (const mode of ['408', 'network'] as const) test(`uncertain payment ${mode}: GET and back never retry POST`, async ({ page, api }, info) => {
  api.paymentMode = mode;
  await login(page, api, payPage);
  await expect(page.getByRole('button', { name: 'Продолжить без списания', exact: true })).toBeEnabled();
  const gets = api.count('GET', myPath);
  await page.getByRole('button', { name: 'Продолжить без списания', exact: true }).click();
  await expect(page.getByText(/Результат операции неизвестен/)).toBeVisible();
  expect(api.count('POST', payPath)).toBe(1); expect(api.count('GET', myPath)).toBe(gets);
  await page.getByRole('button', { name: 'Проверить статус', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Проверить статус', exact: true })).toBeEnabled();
  expect(api.count('GET', myPath)).toBe(gets + 1); expect(api.count('POST', payPath)).toBe(1);
  await expect(page.getByRole('button', { name: 'Продолжить без списания' })).toHaveCount(0);
  await page.getByRole('link', { name: /К карточке участника/ }).click();
  await expect(page.getByRole('link', { name: 'Оплата участия', exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByText(/Результат операции неизвестен/)).toBeVisible();
  expect(api.count('POST', payPath)).toBe(1); await noOverflow(page);
  if (mode === '408') await representativeScreenshot(page, info, 'payment-408');
});

test('production PDF allowlist stays empty; navigation and reload cannot recreate a PDF or payment', async ({ page, api }) => {
  api.pdfUrl = '/test-approved/forms/00123.pdf';
  await login(page, api, payPage);
  await page.getByRole('button', { name: 'Продолжить без списания', exact: true }).click();
  await expect(page.getByText('Отмечено в системе', { exact: true })).toBeVisible();
  await expect(page.getByText('Анкета пока недоступна: ссылка требует проверки.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть анкету для печати' })).toHaveCount(0);
  await page.getByRole('link', { name: 'В личный кабинет', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Личный кабинет', exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByText('Анкета пока недоступна: ссылка требует проверки.', { exact: true })).toBeVisible();
  await page.goForward(); await expect(page.getByRole('heading', { name: 'Личный кабинет', exact: true })).toBeVisible();
  await page.goBack(); await page.reload();
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  await page.getByLabel('Имя пользователя').fill('synthetic-test-account'); await page.getByLabel('Пароль', { exact: true }).fill(api.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText('Отмечено в системе', { exact: true })).toBeVisible();
  await expect(page.getByText(/Технический номер операции/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Продолжить без списания' })).toHaveCount(0);
  expect(api.count('POST', payPath)).toBe(1); await noOverflow(page);
});

for (const status of [200, 401]) test(`late payment ${status} from A cannot expose data or expire B`, async ({ page, api }) => {
  const gate = api.deferPayment(); await login(page, api, payPage);
  await page.getByRole('button', { name: 'Продолжить без списания', exact: true }).click(); await gate.seen;
  await logout(page); api.identity = 'B';
  // Stay in the same document: a reload would hide epoch-isolation regressions.
  await signIn(page, api);
  await page.getByRole('link', { name: 'Личный кабинет', exact: true }).click();
  await page.getByRole('link', { name: 'Подробнее: Другой Аккаунт', exact: true }).click();
  await page.getByRole('link', { name: 'Оплата участия', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Другой Аккаунт', exact: true })).toBeVisible();
  gate.release({ status, body: { status: 'old-status', payment_id: 'old-operation-id', form_pdf_url: '/test-approved/forms/00123.pdf' } });
  await gate.completed;
  await expect(page.getByRole('heading', { name: 'Другой Аккаунт', exact: true })).toBeVisible();
  await expect(page.getByText(/old-operation-id|Тестов Первый/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Открыть анкету для печати' })).toHaveCount(0);
  expect(api.count('POST', payPath)).toBe(1);
  expect(api.mine[0]?.surname).not.toBe(otherParticipants[0]!.surname);
  await noOverflow(page);
});
