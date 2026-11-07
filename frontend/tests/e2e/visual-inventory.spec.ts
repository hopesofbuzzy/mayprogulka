import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, login, noOverflow, familyForm } from './fixtures';

// A later corrective task can keep its captures separate from the accepted baseline.
const artifactRoot = resolve(process.env.E2E_VISUAL_ARTIFACT_DIR ?? '../local_docs/task-14-artifacts');

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
  const output = resolve(artifactRoot, phase); await mkdir(output, { recursive: true });
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
  const output = resolve(artifactRoot, 'states');
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

// Unlike scrollWidth, text ranges detect a word split inside a shrinking control.
async function verifyParticipantLayout(page: Page, info: TestInfo, state: string) {
  await page.evaluate(() => document.fonts.ready);
  const buttons = page.getByRole('button', { name: /^Убрать участника \d+$/ });
  const { rows: measurements, actions } = await buttons.evaluateAll(elements => {
    const rect = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
    const lines = (range: Range) => new Set(Array.from(range.getClientRects()).filter(r => r.width > 0).map(r => Math.round(r.top * 10))).size;
    const wordLines = (element: Element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), result: number[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of node.textContent!.matchAll(/\S+/g)) {
          const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length); result.push(lines(range));
        }
      }
      return result;
    };
    const rows = elements.map(button => {
      const header = button.parentElement!, label = header.querySelector('p')!, range = document.createRange(); range.selectNodeContents(button);
      return { name: button.getAttribute('aria-label'), disabled: button.matches(':disabled'), button: rect(button.getBoundingClientRect()),
        header: rect(header.getBoundingClientRect()), label: rect(label.getBoundingClientRect()), text: rect(range.getBoundingClientRect()), lines: lines(range), labelWordLines: wordLines(label) };
    });
    // Other actions must stay on screen; removal also has strict header bounds below.
    const form = elements[0]!.closest('form')!, bounds = { left: 0, right: innerWidth };
    const actions = Array.from(form.querySelectorAll('button')).map(button => {
      const range = document.createRange(); range.selectNodeContents(button);
      return { text: button.textContent, box: rect(button.getBoundingClientRect()), textBox: rect(range.getBoundingClientRect()), wordLines: wordLines(button), bounds };
    });
    return { rows, actions };
  });
  const form = page.getByRole('main').locator('form');
  const collisions = await form.locator('input,select,button').evaluateAll(elements => {
    const visible = elements.map(el => ({ tag: el.tagName, box: el.getBoundingClientRect() })).filter(item => item.box.width > 0 && item.box.height > 0);
    return visible.flatMap((a, i) => visible.slice(i + 1).filter(b => Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > .5 && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > .5).map(b => `${a.tag}/${b.tag}`));
  });
  const phase = process.env.TASK1401_CAPTURE_PHASE === 'before' ? 'before' : 'after';
  const output = resolve('../local_docs/task-14.01-artifacts', phase, info.project.name); await mkdir(output, { recursive: true });
  const name = `${state}-${page.viewportSize()!.width}`;
  await writeFile(resolve(output, `${name}.json`), JSON.stringify({ viewport: page.viewportSize(), state, measurements, actions, collisions }, null, 2));
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  await noOverflow(page);
  expect.soft(collisions, `${state}: form controls do not intersect`).toEqual([]);
  for (const action of actions) {
    expect.soft(action.wordLines.every(count => count === 1), `${state}: action words remain intact`).toBe(true);
    expect.soft(action.box.height).toBeGreaterThanOrEqual(44);
    expect.soft(action.box.left).toBeGreaterThanOrEqual(action.bounds.left - .5);
    expect.soft(action.box.right).toBeLessThanOrEqual(action.bounds.right + .5);
    expect.soft(action.textBox.left).toBeGreaterThanOrEqual(action.box.left);
    expect.soft(action.textBox.right).toBeLessThanOrEqual(action.box.right);
  }
  for (const value of measurements) {
    expect.soft(value.lines, `${state}: ${value.name} stays on one line`).toBe(1);
    expect.soft(value.button.height, `${state}: touch height`).toBeGreaterThanOrEqual(44);
    expect.soft(value.button.left).toBeGreaterThanOrEqual(value.header.left - .5);
    expect.soft(value.button.right).toBeLessThanOrEqual(value.header.right + .5);
    expect.soft(value.text.left).toBeGreaterThanOrEqual(value.button.left);
    expect.soft(value.text.right).toBeLessThanOrEqual(value.button.right);
    expect.soft(value.text.top).toBeGreaterThanOrEqual(value.button.top);
    expect.soft(value.text.bottom).toBeLessThanOrEqual(value.button.bottom);
    const overlap = Math.min(value.button.right, value.label.right) - Math.max(value.button.left, value.label.left) > .5 && Math.min(value.button.bottom, value.label.bottom) - Math.max(value.button.top, value.label.top) > .5;
    expect.soft(overlap, `${state}: header copy and action do not overlap`).toBe(false);
    expect.soft(value.labelWordLines.every(count => count === 1), `${state}: header words remain intact`).toBe(true);
  }
}

test('participant removal stays intact, labelled and keyboard operable with long rows and errors', async ({ page, api }, info) => {
  test.setTimeout(60_000);
  if (info.project.name === 'compact') await page.setViewportSize({ width: 320, height: 800 });
  api.publicRoutes[0]!.name += ' — синтетическое длинное название маршрута для проверки узкой формы';
  await login(page, api, '/account/participants/new');
  await page.getByRole('option', { name: /Тестовая лесная тропа/ }).waitFor({ state: 'attached' });
  const row = (index: number) => page.getByRole('group', { name: `Участник ${index}`, exact: true });
  const remove = (index: number) => page.getByRole('button', { name: `Убрать участника ${index}`, exact: true });
  const add = page.getByRole('button', { name: 'Добавить ещё участника', exact: true });
  await expect(remove(1)).toBeDisabled(); await verifyParticipantLayout(page, info, 'one-disabled');
  await page.getByRole('button', { name: 'Обновить маршруты', exact: true }).focus(); await page.keyboard.press('Tab');
  await expect(row(1).getByLabel('Фамилия', { exact: true })).toBeFocused();
  await row(1).getByLabel('Фамилия', { exact: true }).fill('Синтетический-Первый-Длинная-Фамилия');
  await add.focus(); await page.keyboard.press('Space');
  await expect(row(2).getByLabel('Фамилия', { exact: true })).toBeFocused();
  await row(2).getByLabel('Фамилия', { exact: true }).fill('Синтетическая-Удаляемая-Строка');
  await row(1).getByLabel('Фамилия', { exact: true }).focus(); await page.keyboard.press('Shift+Tab');
  await expect(remove(1)).toBeFocused();
  expect(await remove(1).evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await verifyParticipantLayout(page, info, 'two-focus');
  await add.click(); await expect(row(3).getByLabel('Фамилия', { exact: true })).toBeFocused();
  await row(3).getByLabel('Фамилия', { exact: true }).fill('Синтетический-Третий-Сохраняется');
  await verifyParticipantLayout(page, info, 'three');
  await remove(2).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: /^Участник \d+$/ })).toHaveCount(2);
  await expect(row(1).getByLabel('Фамилия', { exact: true })).toHaveValue('Синтетический-Первый-Длинная-Фамилия');
  await expect(row(2).getByLabel('Фамилия', { exact: true })).toHaveValue('Синтетический-Третий-Сохраняется');
  await expect(row(1).getByLabel('Фамилия', { exact: true })).toBeFocused();
  const submit = page.getByRole('button', { name: 'Зарегистрировать участников', exact: true });
  await submit.click(); await expect(page.getByRole('alert')).toContainText('Проверьте поля участников');
  await verifyParticipantLayout(page, info, 'validation-after-removal');
  for (const index of [1, 2]) {
    for (const [label, value] of [['Имя','Синтетическое Длинное Имя'],['Дата рождения','1995-05-20'],['Email',`synthetic.long.family.contact.${index}@example.test`],['Телефон','+7 (900) 123-45-67 доб. 123456']]) await row(index).getByLabel(label!, { exact: true }).fill(value!);
    await row(index).getByLabel('Пол', { exact: true }).selectOption(index === 1 ? 'male' : 'female');
    await row(index).getByLabel('Маршрут', { exact: true }).selectOption(index === 1 ? '12' : '15');
  }
  api.registrationMode = '422'; await submit.click();
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(row(2).getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  await verifyParticipantLayout(page, info, 'indexed-422');
  // Delay, then fall through to the existing strict DTO/auth fixture; no response bypass.
  let release!: () => void, seen!: () => void;
  const gate = new Promise<void>(done => { release = done; }), sent = new Promise<void>(done => { seen = done; });
  await page.route('**/api/v1/participants/register', async route => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON().participants[1].surname).toBe('Синтетический-Третий-Сохраняется');
      seen(); await gate;
    }
    await route.fallback();
  });
  await submit.click(); await sent;
  try {
    await expect(page.getByRole('status')).toContainText('Ждём подтверждение регистрации');
    await expect(remove(1)).toBeDisabled(); await expect(remove(2)).toBeDisabled(); await expect(add).toBeDisabled();
    await verifyParticipantLayout(page, info, 'pending');
  } finally { release(); }
  await expect(page.getByRole('alert')).toBeFocused();
  expect(api.count('POST', '/api/v1/participants/register')).toBe(2);
  await remove(1).focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('group', { name: /^Участник \d+$/ })).toHaveCount(1);
  await expect(remove(1)).toBeDisabled();
  await expect(row(1).getByLabel('Фамилия', { exact: true })).toHaveValue('Синтетический-Третий-Сохраняется');
  await expect(row(1).getByLabel('Фамилия', { exact: true })).toBeFocused();
  await verifyParticipantLayout(page, info, 'one-after-keyboard-removal');
});

test('participant headers reflow at intermediate widths and with doubled form text', async ({ page, api }, info) => {
  test.setTimeout(60_000);
  for (const width of [360, 375, 320, 390]) {
    await page.setViewportSize({ width, height: 844 }); await login(page, api, '/account/participants/new');
    await page.getByRole('button', { name: 'Добавить ещё участника', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Участник 2', exact: true }).getByLabel('Фамилия', { exact: true })).toBeFocused();
    if (width === 320 || width === 390) {
      // Text-only enlargement of the complete form, not CSS zoom or a native browser zoom claim.
      await page.locator('main form').evaluate(form => {
        const sizes = [form, ...Array.from(form.querySelectorAll<HTMLElement>('*'))].map(el => ({ el: el as HTMLElement, size: parseFloat(getComputedStyle(el).fontSize) }));
        for (const { el, size } of sizes) el.style.fontSize = `${size * 2}px`;
      });
    }
    await verifyParticipantLayout(page, info, width === 320 || width === 390 ? 'two-text200' : 'two-intermediate');
    await page.getByRole('group', { name: 'Участник 1', exact: true }).getByLabel('Фамилия', { exact: true }).focus();
    await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: 'Убрать участника 1', exact: true })).toBeFocused();
  }
  expect(api.calls.filter(call => call.method !== 'GET').every(call => call.path === '/api/v1/auth/login')).toBe(true);
});
