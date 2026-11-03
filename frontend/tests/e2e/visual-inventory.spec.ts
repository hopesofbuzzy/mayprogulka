import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, login, noOverflow, familyForm } from './fixtures';

const pages = [
  ['home','/','STATIC'], ['about','/about','STATIC'], ['routes','/routes','TEST_FIXTURE'], ['route','/routes/12','TEST_FIXTURE'],
  ['how-to','/how-to','STATIC'], ['faq','/faq','STATIC'], ['login','/login','STATIC'], ['signup','/signup','STATIC'],
  ['account','/account','participant'], ['registration','/account/participants/new','participant'], ['participant','/account/participants/42','participant'], ['payment','/account/participants/42/pay','participant'],
  ['admin-routes','/staff/routes','admin'], ['admin-checkpoints','/staff/routes/12/checkpoints','admin'],
  ['typist','/staff/typist','typist'], ['paper','/staff/typist/new','typist'], ['match','/staff/typist/match','typist'], ['unlinked','/staff/typist/unlinked','typist'], ['404','/unknown-visual-page','STATIC'],
] as const;
const complex = new Set(['how-to','registration','payment','admin-routes','admin-checkpoints','paper','match','unlinked']);
test('all existing pages have a visual inventory without live traffic or document overflow', async ({ page, api }, info) => {
  test.setTimeout(90_000);
  const phase = process.env.TASK14_CAPTURE_PHASE === 'before' ? 'before' : 'after';
  const output = resolve('../local_docs/task-14-artifacts', phase); await mkdir(output, { recursive: true });
  if (info.project.name === 'compact') await page.setViewportSize({ width: 320, height: 800 });
  for (const [name,path,mode] of pages) {
    if (['compact','tablet'].includes(info.project.name) && !complex.has(name)) continue;
    if (['participant','admin','typist'].includes(mode)) { api.role = mode; await login(page, api, path); }
    else await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: /Загружаем|Загружается/ })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready); await noOverflow(page);
    if (name === 'how-to') {
      const steps = page.getByRole('list', { name: 'Шаги участия' });
      await expect(steps.getByRole('listitem')).toHaveCount(6);
      await expect(steps.locator('li > svg[aria-hidden="true"]')).toHaveCount(6);
      await expect(steps).toContainText('деньги не списываются');
      await expect(steps).toContainText('Если ссылки нет');
      await expect(page.getByRole('main')).toContainText('Номер анкеты и штрихкод физической карты не заменяют друг друга');
    }
    await page.screenshot({ path: resolve(output, `${name}-${page.viewportSize()!.width}.png`), fullPage: true });
  }
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [name,path] of [['home','/'],['about','/about']]) {
      await page.goto(path!); await expect(page.getByRole('heading',{level:1})).toBeVisible(); await page.evaluate(() => document.fonts.ready); await noOverflow(page);
      await page.screenshot({ path: resolve(output,`${name}-1440.png`), fullPage:true });
    }
  }
  expect(api.calls.filter(call => call.method !== 'GET').every(call => call.path === '/api/v1/auth/login')).toBe(true);
});

async function stateShot(page: Page, name: string) {
  const output = resolve('../local_docs/task-14-artifacts/states');
  await mkdir(output, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await noOverflow(page);
  await page.screenshot({ path: resolve(output, `${name}-${page.viewportSize()!.width}.png`), fullPage: name !== 'checkpoint-delete' });
}

test('catalogue presentation distinguishes pending, empty and failed reads without writes', async ({ page, api }, info) => {
  if (info.project.name === 'compact') await page.setViewportSize({ width: 320, height: 800 });
  const gate = api.deferRoutes();
  await page.goto('/routes');
  await expect(page.getByRole('status')).toHaveText('Загружаем маршруты…');
  await stateShot(page, 'routes-loading');
  gate.release({ status: 200, body: { routes: [] } });
  await expect(page.getByRole('heading', { name: 'Маршрутов пока нет' })).toBeVisible();
  await stateShot(page, 'routes-empty');
  api.routeMode = '500'; await page.reload();
  await expect(page.getByRole('alert')).toContainText('Маршруты пока недоступны');
  await stateShot(page, 'routes-error');
  expect(api.calls.every(call => call.method === 'GET' && !call.authenticated)).toBe(true);
});

test('screenbook records indexed errors, uncertain payment, literal card IDs and safe deletion', async ({ page, api }, info) => {
  test.setTimeout(60_000);
  if (info.project.name === 'compact') await page.setViewportSize({ width: 320, height: 800 });
  await familyForm(page, api); api.registrationMode = '422';
  await page.getByRole('button', { name: 'Зарегистрировать участников', exact: true }).click();
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('group', { name: 'Участник 2', exact: true }).getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  await stateShot(page, 'family-422');
  api.paymentMode = '408'; await login(page, api, '/account/participants/42/pay');
  await page.getByRole('button', { name: 'Продолжить без списания', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Результат операции неизвестен');
  await stateShot(page, 'payment-unknown');
  expect(api.count('POST', '/api/v1/participants/42/pay')).toBe(1);
  api.role = 'typist'; await login(page, api, '/staff/typist/match');
  await page.getByLabel('Номер анкеты', { exact: true }).fill('000F01');
  await page.getByLabel('Штрихкод физической карты', { exact: true }).fill('000001');
  await page.getByRole('button', { name: 'Проверить пару', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Проверка пары' })).toBeFocused();
  await stateShot(page, 'match-review');
  expect(api.count('POST', '/api/v1/typist/match')).toBe(0);
  await page.getByRole('button', { name: 'Подтвердить сопоставление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ответ сопоставления получен' })).toBeFocused();
  await expect(page.getByText('000001', { exact: true })).toBeVisible();
  await stateShot(page, 'match-result');
  expect(api.count('POST', '/api/v1/typist/match')).toBe(1);
  api.role = 'admin'; await login(page, api, '/staff/routes/12/checkpoints');
  const list = page.getByRole('list', { name: 'КП выбранного маршрута' });
  await list.getByRole('listitem').filter({ hasText: 'КП ID 1201 ·' }).getByRole('button', { name: /Удалить КП/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Подтвердить удаление КП' })).toBeDisabled();
  await stateShot(page, 'checkpoint-delete');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(api.count('DELETE', '/api/v1/admin/checkpoints/1201')).toBe(0);
  expect(api.calls.some(call => call.path.includes('/scans'))).toBe(false);
});

test('confirmed family registration and individual payment have honest presentation without a PDF', async ({ page, api }, info) => {
  if (info.project.name === 'compact') await page.setViewportSize({ width: 320, height: 800 });
  api.mine = []; await familyForm(page, api);
  await page.getByRole('button', { name: 'Зарегистрировать участников', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Регистрация подтверждена', exact: true })).toBeVisible();
  await expect(page.getByText('Список участников обновлён по данным сервера.', { exact: true })).toBeVisible();
  await stateShot(page, 'family-confirmed');
  expect(api.count('POST', '/api/v1/participants/register')).toBe(1);
  expect(api.calls.find(call => call.path === '/api/v1/participants/register')?.routeIds).toEqual([12,15]);
  await page.getByRole('link', { name: 'В личный кабинет', exact: true }).click();
  await page.getByRole('link', { name: 'Подробнее: Тестов Первый', exact: true }).click();
  await page.getByRole('link', { name: 'Оплата участия', exact: true }).click();
  await page.getByRole('button', { name: 'Продолжить без списания', exact: true }).click();
  await expect(page.getByText('Отмечено в системе', { exact: true })).toBeVisible();
  await expect(page.getByText('Анкета для печати пока недоступна', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть анкету для печати' })).toHaveCount(0);
  await stateShot(page, 'payment-confirmed');
  expect(api.count('POST', '/api/v1/participants/42/pay')).toBe(1);
});
