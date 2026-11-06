import { test, expect, login, noOverflow, familyForm } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { contrastOf } from './accessibility-helpers';
test.beforeEach(async ({ page }, info) => { if (info.project.name === 'compact') await page.setViewportSize({ width: 320, height: 800 }); });

async function inventory(page: Page) {
  await noOverflow(page); await expect(page.getByRole('main')).toHaveCount(1); await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const defects = await page.locator('main').evaluate(main => Array.from(main.querySelectorAll('input,select,textarea')).filter(el => el.getAttribute('type') !== 'hidden').flatMap(el => {
    const field = el as HTMLInputElement, ids = (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    return [!field.labels?.length && !el.getAttribute('aria-label') ? 'Unlabelled field' : '', ids.some(id => !document.getElementById(id)) ? 'Missing error/hint target' : ''].filter(Boolean);
  })); expect(defects).toEqual([]);
}
async function shot(page: Page, info: TestInfo, name: string) {
  if (['desktop', 'mobile'].includes(info.project.name) || (info.project.name === 'compact' && ['participants-422', 'checkpoint-delete'].includes(name))) { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: info.outputPath(`a11y-${name}.png`) }); }
}

test('rendered primary CTA, secondary links, fields and validation have readable contrast', async ({ page }, info) => {
  const measurements = [];
  await page.goto('/'); const cta = page.getByRole('region', { name: /Город становится/ }).getByRole('link', { name: /Выбрать маршрут/ });
  measurements.push({ control: 'primary-default', ...await contrastOf(cta) });
  await cta.hover(); measurements.push({ control: 'primary-hover', ...await contrastOf(cta) });
  await page.mouse.move(0, 0); await cta.focus(); measurements.push({ control: 'primary-focus', ...await contrastOf(cta) });
  const guide = page.getByRole('region', { name: /Город становится/ }).getByRole('link', { name: /Как участвовать/ });
  measurements.push({ control: 'hero-secondary', ...await contrastOf(guide) });
  await shot(page, info, 'home-focus');
  await page.goto('/signup'); await expect(page.getByRole('heading', { name: 'Создать аккаунт' })).toBeVisible();
  measurements.push({ control: 'field-normal', ...await contrastOf(page.getByLabel('Email', { exact: true })) });
  const submit = page.getByRole('button', { name: 'Создать аккаунт', exact: true });
  await submit.evaluate(el => { (el as HTMLButtonElement).disabled = true; });
  measurements.push({ control: 'auth-disabled', ...await contrastOf(submit) });
  await submit.evaluate(el => { (el as HTMLButtonElement).disabled = false; });
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  measurements.push({ control: 'field', ...await contrastOf(page.getByLabel('Email', { exact: true })) });
  measurements.push({ control: 'field-error', ...await contrastOf(page.getByText('Введите корректный email.', { exact: true })) });
  await shot(page, info, 'signup-errors');
  await info.attach('rendered-contrast', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  for (const measurement of measurements) expect(measurement.ratio, measurement.control).toBeGreaterThanOrEqual(4.5);
  expect(measurements.find(m => m.control === 'field')!.borderRatio).toBeGreaterThanOrEqual(3);
  expect(measurements.find(m => m.control === 'field-normal')!.borderRatio).toBeGreaterThanOrEqual(3);
});

test('public landmarks, keyboard Back/Forward, reduced motion and compact reflow remain usable', async ({ page, api }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (info.project.name === 'compact') await page.setViewportSize({ width: 320, height: 800 });
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 640, height: 360 });
  for (const path of ['/', '/about', '/routes', '/routes/12', '/how-to', '/faq', '/not-a-page']) {
    await page.goto(path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await inventory(page);
  }
  await page.goto('/about'); await expect(page.getByRole('heading', { name: 'О Майской прогулке' })).toBeVisible(); await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.getByRole('main')).toBeFocused();
  await page.getByRole('main').getByRole('link', { name: /Подготовиться к участию/ }).click(); await expect(page.getByRole('heading', { name: 'Как участвовать', exact: true })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/\/about(?:#main)?$/); await expect(page.getByRole('main')).toBeFocused();
  await page.goForward(); await expect(page).toHaveURL(/\/how-to$/); await expect(page.getByRole('main')).toBeFocused();
  expect(api.calls.every(call => call.method === 'GET' && ['/api/v1/routes','/api/v1/checkpoints'].includes(call.path))).toBe(true);
});

test('authentication 401 and 422 focus readable summaries and retain fields', async ({ page, api }, info) => {
  for (const status of [401,422] as const) {
    api.authStatus = status; await page.goto('/login'); await page.getByLabel('Имя пользователя').fill('synthetic-test-account'); await page.getByLabel('Пароль', { exact: true }).fill(api.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click(); const alert = page.getByRole('alert'); await expect(alert).toBeFocused();
    expect((await contrastOf(alert)).ratio).toBeGreaterThanOrEqual(4.5); await expect(page.getByLabel('Имя пользователя')).toHaveValue('synthetic-test-account'); await inventory(page);
  }
  await shot(page, info, 'login-server-error');
});

test('participant forms and indexed errors stay labelled at 400% equivalent reflow; payment unknown is readable', async ({ page, api }, info) => {
  if (info.project.name === 'compact') await page.setViewportSize({ width: 320, height: 800 });
  await familyForm(page, api); await inventory(page); api.registrationMode = '422';
  await page.getByRole('button', { name: 'Зарегистрировать участников', exact: true }).click();
  await expect(page.getByRole('alert')).toBeFocused(); await inventory(page);
  const row = page.getByRole('group', { name: 'Участник 2', exact: true }); await expect(row.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  expect((await contrastOf(row.getByLabel('Email'))).borderRatio).toBeGreaterThanOrEqual(3);
  await shot(page, info, 'participants-422');
  await login(page, api, '/account'); await inventory(page); await login(page, api, '/account/participants/42'); await inventory(page);
  api.paymentMode = '408'; await login(page, api, '/account/participants/42/pay'); await inventory(page);
  await expect(page.locator('#payment-notice')).toContainText('деньги не списываются'); await page.getByRole('button', { name: 'Продолжить без списания' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Результат операции неизвестен' }); await expect(alert).toBeVisible(); expect((await contrastOf(alert)).ratio).toBeGreaterThanOrEqual(4.5);
  await inventory(page); await shot(page, info, 'payment-unknown'); expect(api.count('POST','/api/v1/participants/42/pay')).toBe(1);
});

test('typist invalid fields, review/back, server errors and successful result move focus without scanner POST', async ({ page, api }, info) => {
  api.role = 'typist'; await login(page, api, '/staff/typist/new'); await page.getByRole('option', { name: /Тестовый городской маршрут/ }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Проверить анкету' }).click(); await expect(page.getByLabel('Фамилия', { exact: true })).toBeFocused(); await inventory(page);
  await login(page, api, '/staff/typist/match'); const form = page.getByLabel('Номер анкеты', { exact: true }), barcode = page.getByLabel('Штрихкод физической карты', { exact: true });
  await page.getByRole('button', { name: 'Проверить пару' }).click(); await expect(form).toBeFocused();
  await form.fill('000F01'); await form.press('Enter'); await expect(barcode).toBeFocused(); await barcode.fill('000001'); await barcode.press('Enter');
  expect(api.count('POST','/api/v1/typist/match')).toBe(0); await page.keyboard.press('Enter'); await expect(page.getByRole('region', { name: 'Проверка пары' })).toBeFocused();
  await page.getByRole('button', { name: 'Вернуться к вводу' }).click(); await expect(form).toBeFocused();
  api.matchMode='422';
  await page.getByRole('button', { name: 'Проверить пару' }).click(); await page.getByRole('button', { name: 'Подтвердить сопоставление' }).click();
  await expect(barcode).toBeFocused(); await expect(barcode).toHaveAttribute('aria-invalid','true'); await expect(form).toHaveValue('000F01');
  api.matchMode='success'; await barcode.fill('000001'); await page.getByRole('button', { name: 'Проверить пару' }).click(); await page.getByRole('button', { name: 'Подтвердить сопоставление' }).click();
  await expect(page.getByRole('heading', { name: 'Ответ сопоставления получен' })).toBeFocused(); await inventory(page); await shot(page, info, 'typist-result');
  await page.getByRole('button', { name: 'Следующая пара' }).click(); await expect(form).toBeFocused();
  await login(page, api, '/staff/typist/unlinked'); await inventory(page);
});

test('admin checkbox errors receive focus; DELETE Enter is safe and modal focus can return', async ({ page, api }, info) => {
  api.role='admin'; api.checkpointWriteMode='422'; api.checkpoint422Field='is_start';
  await login(page, api, '/staff/routes/12/checkpoints'); await page.getByRole('button', { name: 'Создать один КП' }).click();
  const dialog=page.getByRole('dialog'); for(const [name,value] of [['Название КП','Синтетический КП'],['Адрес','Синтетический адрес'],['Координаты','56.83, 60.60'],['Порядок прохождения','1']]) await dialog.getByLabel(name!,{exact:true}).fill(value!);
  await dialog.getByRole('button', {name:'Проверить данные КП'}).click(); await dialog.getByRole('button',{name:'Подтвердить создание КП'}).click();
  const checkbox=dialog.getByLabel('Старт маршрута',{exact:true}); await expect(checkbox).toBeFocused(); await expect(checkbox).toHaveAttribute('aria-invalid','true'); await expect(checkbox).toHaveAccessibleDescription(/Сервер/);
  const pairs=[{control:'admin-secondary',...await contrastOf(dialog.getByRole('button',{name:'Закрыть',exact:true}))}];
  await inventory(page); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await page.getByRole('listitem').filter({hasText:'КП ID 1201 ·'}).getByRole('button',{name:/Удалить КП/}).click();
  const typed=dialog.getByLabel('Введите ID КП 1201'); await typed.fill('1201'); await typed.press('Enter'); expect(api.count('DELETE','/api/v1/admin/checkpoints/1201')).toBe(0);
  const danger=dialog.getByRole('button',{name:'Подтвердить удаление КП'}); pairs.push({control:'danger-default',...await contrastOf(danger)}); await danger.hover();pairs.push({control:'danger-hover',...await contrastOf(danger)});await danger.focus();pairs.push({control:'danger-focus',...await contrastOf(danger)});
  await typed.fill('wrong'); pairs.push({control:'danger-disabled',...await contrastOf(danger)});
  await info.attach('admin-contrast',{body:JSON.stringify(pairs,null,2),contentType:'application/json'});for(const pair of pairs)expect(pair.ratio,pair.control).toBeGreaterThanOrEqual(4.5);
  await shot(page,info,'checkpoint-delete'); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await login(page,api,'/staff/routes'); await page.getByRole('button',{name:'Новый маршрут'}).click();await expect(dialog.getByLabel('Флаг активности', {exact:true})).toHaveAttribute('id',/./);await inventory(page);await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Новый маршрут'})).toBeFocused();
  await login(page,api,'/staff/routes/12/checkpoints'); await page.getByRole('button',{name:'Добавить несколько КП'}).click();await expect(dialog.getByRole('checkbox',{name:'Старт маршрута'}).first()).toHaveAttribute('id',/./);await inventory(page);await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});
