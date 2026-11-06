import type { Page, TestInfo } from '@playwright/test';
import { test, expect, login, noOverflow } from './fixtures';

const paymentPage = '/account/participants/42/pay', paymentApi = '/api/v1/participants/42/pay';
async function shot(page: Page, info: TestInfo, name: string) {
  await noOverflow(page); const dialog = page.getByRole('dialog');
  if (await dialog.count()) expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: info.outputPath(name + '.png') });
}
async function humanControls(page: Page) {
  const text = await page.getByRole('main').locator('h1,h2,label,button,summary').allTextContents();
  expect(text.join(' ')).not.toMatch(/mock only|\bbeta\b|\bpreview\b|\b(API|GET|POST|PUT|DELETE|DTO)\b|form_id|barcode|route_id/i);
}
test('public guidance is conditional and understandable, with keyboard FAQ and honest 404', async ({ page, api }, info) => {
  await page.goto('/how-to'); await expect(page.getByRole('heading', { name: 'Как участвовать', exact: true })).toBeVisible(); await humanControls(page);
  await expect(page.getByRole('list', { name: 'Шаги участия' })).toContainText('Если вы смогли распечатать анкету'); await expect(page.getByRole('main')).not.toContainText('form_id'); await shot(page, info, 'how-to');
  await page.getByRole('link', { name: 'Вопросы и ответы →' }).click(); await page.getByText('Списываются ли деньги при оплате?', { exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByText(/Действие в личном кабинете меняет отметку участника/)).toBeVisible(); await page.getByText('Как получить и распечатать анкету?', { exact: true }).click(); await humanControls(page); await shot(page, info, 'faq');
  await page.goto('/unknown-product-page'); await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible(); expect(api.calls).toHaveLength(0); await shot(page, info, 'not-found');
});
for (const method of ['card', 'sbp'] as const) test(`payment ${method} has one pre-action notice and distinguishes status from money`, async ({ page, api }, info) => {
  await login(page, api, paymentPage); await expect(page).toHaveTitle('Оплата участия — Майская прогулка'); await humanControls(page);
  const notice = page.locator('#payment-notice'); await expect(notice).toBeVisible(); await expect(notice).toHaveText('Оплата пока не подключена. Этот шаг меняет статус участника — деньги не списываются.');
  const submit = page.getByRole('button', { name: 'Продолжить без списания' }); await expect(page.locator('form')).toHaveAttribute('aria-describedby', 'payment-notice'); expect(await notice.evaluate((node) => Boolean(node.compareDocumentPosition(document.querySelector('button[type="submit"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.getByRole('radio', { name: method === 'card' ? 'Карта' : 'СБП', exact: true }).check(); await expect(notice).toBeVisible(); await shot(page, info, `payment-before-${method}`);
  await submit.click(); await expect(page.getByText('Отмечено в системе', { exact: true })).toBeVisible(); await expect(page.getByText('Анкета для печати пока недоступна', { exact: true })).toBeVisible();
  expect(api.count('POST', paymentApi)).toBe(1); expect(api.calls.find(call => call.path === paymentApi)?.paymentMethod).toBe(method); await expect(page.getByRole('main')).not.toContainText('Оплата прошла');
  const receipt = page.locator('details').filter({ has: page.getByText('Сведения об операции', { exact: true }) }); await expect(receipt).not.toHaveAttribute('open'); await receipt.locator('summary').focus(); await page.keyboard.press('Enter'); await expect(receipt).toHaveAttribute('open', ''); await shot(page, info, `payment-after-${method}`);
});
test('uncertain payment preserves warning and never retries on status refresh', async ({ page, api }, info) => {
  api.paymentMode = '408'; await login(page, api, paymentPage); await page.getByRole('button', { name: 'Продолжить без списания' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Результат операции неизвестен' })).toBeVisible(); await expect(page.getByText(/Даже если отметка не изменилась, операция могла сохраниться/)).toBeVisible();
  await page.getByRole('button', { name: 'Проверить статус', exact: true }).click(); await expect(page.getByRole('button', { name: 'Проверить статус', exact: true })).toBeEnabled();
  expect(api.count('POST', paymentApi)).toBe(1); await expect(page.getByRole('button', { name: 'Продолжить без списания' })).toHaveCount(0); await shot(page, info, 'payment-unknown');
});
test('admin forms keep identification and confirmations without API prose', async ({ page, api }, info) => {
  api.role = 'admin'; await login(page, api, '/staff/routes'); await page.getByRole('button', { name: /Изменить/ }).first().click(); await expect(page.getByRole('dialog')).toBeVisible(); await humanControls(page);
  await expect(page.getByRole('dialog')).toContainText('Год и схему маршрута здесь изменить нельзя'); await shot(page, info, 'admin-route-form'); await page.keyboard.press('Escape');
  await page.getByRole('link', { name: /Контрольные пункты.*Тестовая лесная/ }).click(); await page.getByRole('button', { name: /Удалить КП/ }).first().click(); await expect(page.getByRole('dialog').getByLabel('Введите ID КП 1201')).toBeVisible(); await humanControls(page);
  await page.getByRole('dialog').getByLabel('Введите ID КП 1201').fill('12'); await expect(page.getByRole('button', { name: 'Подтвердить удаление КП' })).toBeDisabled(); await shot(page, info, 'admin-checkpoint-form'); expect(api.count('DELETE', '/api/v1/admin/checkpoints/1201')).toBe(0);
});
test('typist labels preserve two codes and limited-list guidance', async ({ page, api }, info) => {
  api.role = 'typist'; await login(page, api, '/staff/typist/match'); await page.getByLabel('Номер анкеты', { exact: true }).fill('000001'); await page.getByLabel('Номер анкеты', { exact: true }).press('Enter'); await expect(page.getByLabel('Штрихкод физической карты', { exact: true })).toBeFocused();
  await page.getByLabel('Штрихкод физической карты', { exact: true }).fill('000002'); await page.getByLabel('Штрихкод физической карты', { exact: true }).press('Enter'); expect(api.count('POST', '/api/v1/typist/match')).toBe(0); await humanControls(page); await shot(page, info, 'typist-match');
  await page.getByRole('link', { name: 'Непривязанные карты', exact: true }).click(); await expect(page.getByRole('list', { name: 'Выборка непривязанных карт' })).toBeVisible(); await expect(page.getByText(/Показано до 100 непривязанных карт/)).toBeVisible(); await shot(page, info, 'typist-unlinked');
});
test('isolated batch uses product copy yet keeps partial ambiguity and local create lock', async ({ page, api }, info) => {
  api.role = 'admin'; api.batchMode = 'partial'; await login(page, api, '/staff/routes/12/checkpoints'); await page.getByRole('button', { name: 'Добавить несколько КП' }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByText('Партия контрольных пунктов', { exact: true })).toBeVisible(); await humanControls(page);
  for (const index of [0, 1]) { const row = dialog.getByRole('group').nth(index); for (const [label, value] of [['Название КП', `Синтетический КП ${index + 1}`], ['Адрес', 'Синтетический адрес'], ['Координаты', ' 56.8300, 060.6000 '], ['Порядок прохождения', String(index)]]) await row.getByLabel(label!, { exact: true }).fill(value!); }
  await dialog.getByRole('button', { name: 'Проверить перед отправкой' }).click(); await expect(dialog.getByRole('region', { name: 'Проверка партии', exact: true })).toBeFocused(); await dialog.getByLabel('Введите ID маршрута 12').fill('12'); await dialog.getByRole('checkbox', { name: /Понимаю риск/ }).check(); await dialog.getByRole('button', { name: 'Создать 2 КП' }).click();
  await expect(dialog.getByText(/Частичный или противоречивый результат/)).toBeVisible(); await expect(dialog.getByText(/Из этого ответа нельзя узнать номера созданных КП/)).toBeVisible(); await expect(dialog.getByText(/Список КП обновлён/)).toBeVisible(); await shot(page, info, 'batch-partial');
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Создать один КП' })).toBeDisabled(); expect(api.count('POST', '/api/v1/admin/checkpoints/batch')).toBe(1);
});
