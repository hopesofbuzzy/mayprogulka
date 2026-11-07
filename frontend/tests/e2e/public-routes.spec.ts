import { test, expect, login, noOverflow, representativeScreenshot } from './fixtures';

const cpPath = '/api/v1/checkpoints';
const routesPath = '/api/v1/routes';
const routeName = 'Тестовая лесная тропа';
const cpList = 'Контрольные пункты маршрута';

test('catalog → details → back/forward uses one list query, ordered checkpoints and the actual route', async ({ page, api }, info) => {
  api.publicRoutes[0]!.description = 'Описание из синтетического API. Только фактические сведения.';
  await page.goto('/routes');
  await expect(page.getByRole('list', { name: 'Список маршрутов' })).toBeVisible();
  await noOverflow(page); await representativeScreenshot(page, info, 'public-catalog');
  await page.getByRole('link', { name: /Подробнее о маршруте.*Тестовая лесная тропа/ }).click();
  await expect(page).toHaveURL(/\/routes\/12$/);
  await expect(page.getByRole('heading', { name: routeName, exact: true })).toBeVisible();
  const points = page.getByRole('list', { name: cpList }).getByRole('listitem');
  await expect(points).toHaveCount(3);
  await expect(points.nth(0)).toContainText('Тестовый старт'); await expect(points.nth(2)).toContainText('Тестовый финиш');
  await expect(page.getByText('Схема маршрута пока недоступна.', { exact: true })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('opaque:');
  expect(api.calls.filter(call => call.path === cpPath).map(call => call.routeId)).toEqual([12]);
  expect(api.count('GET', routesPath)).toBe(1);
  await noOverflow(page); await representativeScreenshot(page, info, 'route-details');
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Маршруты', exact: true })).toBeVisible();
  await page.goForward(); await expect(page.getByRole('list', { name: cpList })).toBeVisible();
  expect(api.count('GET', routesPath)).toBe(1); expect(api.count('GET', cpPath)).toBe(1);
  await page.getByRole('link', { name: '← Все маршруты' }).click(); await expect(page).toHaveURL(/\/routes$/);
});

test('direct route URL and reload work; route activity is not a registration promise', async ({ page, api }) => {
  await page.goto('/routes/17');
  await expect(page.getByRole('heading', { name: 'Неактивный тестовый маршрут', exact: true })).toBeVisible();
  await expect(page.getByText('Неактивный маршрут', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: cpList })).toBeVisible();
  await page.reload(); await expect(page.getByRole('list', { name: cpList })).toBeVisible();
  expect(api.calls.filter(call => call.path === cpPath).every(call => call.routeId === 17)).toBe(true);
  expect(api.count('GET', routesPath)).toBe(2); await noOverflow(page);
  await page.getByRole('link', { name: 'Зарегистрировать участников', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Регистрация', exact: true })).toHaveAttribute('href', '/signup');
});

test('invalid IDs never request API; absent routes and empty list never request checkpoints', async ({ page, api }) => {
  for (const id of ['wrong', '1.2', '1e2', '-12', '9007199254740992', '12%0A']) {
    await page.goto(`/routes/${id}`);
    await expect(page.getByRole('heading', { name: 'Некорректный номер маршрута' })).toBeVisible();
    await noOverflow(page);
  }
  expect(api.calls).toHaveLength(0);
  await page.goto('/routes/999'); await expect(page.getByRole('heading', { name: 'Маршрут не найден' })).toBeVisible();
  api.routeMode = 'empty'; await page.reload(); await expect(page.getByText('Маршруты пока не опубликованы.')).toBeVisible();
  expect(api.count('GET', cpPath)).toBe(0);
});

test('route API/HTML/structure failures remain distinct from missing route; explicit retry recovers', async ({ page, api }) => {
  for (const mode of ['500', 'html', 'invalid'] as const) {
    api.routeMode = mode; await page.goto('/routes/12');
    await expect(page.getByRole('heading', { name: 'Маршрут пока недоступен', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Маршрут не найден' })).toHaveCount(0);
    expect(api.count('GET', cpPath)).toBe(0); await noOverflow(page);
  }
  api.routeMode = 'success'; await page.getByRole('button', { name: 'Повторить загрузку маршрутов' }).click();
  await expect(page.getByRole('list', { name: cpList })).toBeVisible();
});

test('empty checkpoints has no invented pins or start; route remains usable', async ({ page, api }, info) => {
  api.checkpointMode = 'empty'; await page.goto('/routes/12');
  await expect(page.getByText('Контрольные пункты пока не опубликованы.')).toBeVisible();
  await expect(page.getByRole('heading', { name: routeName, exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: cpList })).toHaveCount(0);
  await expect(page.locator('main iframe, main canvas, main img')).toHaveCount(0);
  await noOverflow(page); await representativeScreenshot(page, info, 'route-empty-checkpoints');
});

test('checkpoint HTTP/network/malformed errors preserve route and retry only the failed GET', async ({ page, api }, info) => {
  for (const mode of ['500', '403', 'network', 'invalid'] as const) {
    api.checkpointMode = mode; await page.goto('/routes/12');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('heading', { name: routeName, exact: true })).toBeVisible();
    expect(api.count('GET', routesPath)).toBe(api.count('GET', cpPath)); await noOverflow(page);
  }
  await representativeScreenshot(page, info, 'route-checkpoints-error');
  const gets = api.count('GET', routesPath), cps = api.count('GET', cpPath);
  api.checkpointMode = 'success'; await page.getByRole('button', { name: 'Повторить загрузку КП' }).click();
  await expect(page.getByRole('list', { name: cpList })).toBeVisible();
  expect(api.count('GET', routesPath)).toBe(gets); expect(api.count('GET', cpPath)).toBe(cps + 1);
});

test('same-origin scheme opens in a new tab; forbidden and absent map links stay unavailable', async ({ page, context, api, baseURL }) => {
  api.publicRoutes[0]!.map_url = '/test-assets/task07-route.svg';
  // Exact synthetic static resource, not a wildcard API fallback.
  await context.route(new URL('/test-assets/task07-route.svg', baseURL!).href, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><text x="10" y="40">Synthetic test scheme</text></svg>' }));
  await page.goto('/routes/12'); const link = page.getByRole('link', { name: /Открыть схему маршрута/ });
  await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const popupPromise = page.waitForEvent('popup'); await link.click(); const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/test-assets\/task07-route\.svg$/); await popup.close();
  for (const value of ['https://unapproved.example.test/map', 'javascript:alert(1)', null]) {
    api.publicRoutes[0]!.map_url = value; await page.reload();
    await expect(page.getByText('Схема маршрута пока недоступна.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Открыть схему маршрута/ })).toHaveCount(0);
  }
  await noOverflow(page);
});

test('how-to and FAQ support hero links, direct/reload and keyboard navigation in compact menu', async ({ page, api }, info) => {
  await page.goto('/'); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await noOverflow(page); await representativeScreenshot(page, info, 'public-home');
  await page.getByRole('region', { name: /Город становится/ }).getByRole('link', { name: /Как участвовать/ }).click();
  await expect(page.getByRole('heading', { name: 'Как участвовать', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Шаги участия' })).toContainText('деньги не списываются');
  await expect(page.getByRole('main')).toContainText('Порядок выдачи и оформления на вашем старте уточните у организаторов');
  await noOverflow(page); await representativeScreenshot(page, info, 'how-to');
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  const toggle = page.getByRole('button', { name: /^(Открыть|Закрыть) меню$/ });
  if (page.viewportSize()!.width < 768) {
    await toggle.focus(); await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await nav.getByRole('link', { name: 'Вопросы', exact: true }).focus();
    await noOverflow(page); await representativeScreenshot(page, info, 'public-mobile-menu');
    await page.keyboard.press('Escape'); await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await nav.getByRole('link', { name: 'Вопросы', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/faq$/); await expect(page.getByRole('heading', { name: 'Вопросы и ответы' })).toBeVisible();
  await expect(page.getByRole('main')).toBeFocused();
  const question = page.getByText('Списываются ли деньги при оплате?', { exact: true });
  await question.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('details[open]')).toContainText('деньги не списываются');
  await noOverflow(page); await representativeScreenshot(page, info, 'faq');
  await page.reload(); await expect(page.getByRole('heading', { name: 'Вопросы и ответы' })).toBeVisible();
  await page.goto('/how-to'); await page.reload(); await expect(page.getByRole('heading', { name: 'Как участвовать', exact: true })).toBeVisible();
  expect(api.calls).toHaveLength(0);
});

test('authenticated public reads omit Bearer; route text is escaped and does not execute', async ({ page, api }) => {
  await login(page, api);
  api.publicRoutes[0]!.description = '<img src=x onerror="window.task07Injected=true"><script>throw 1</script>';
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Маршруты', exact: true }).click();
  await page.getByRole('link', { name: /Подробнее о маршруте.*Тестовая лесная тропа/ }).click();
  await expect(page.getByRole('list', { name: cpList })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('<img src=x');
  await expect(page.locator('main img, main script')).toHaveCount(0);
  expect(api.calls.filter(call => call.path === cpPath || call.path === routesPath).every(call => !call.authenticated)).toBe(true);
  await noOverflow(page);
});
