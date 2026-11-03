import { test, expect, login, logout, noOverflow, representativeScreenshot } from './fixtures';

test('public header/footer navigation, direct URLs, refresh and active states remain usable', async ({ page, api }) => {
  const header = page.getByRole('navigation', { name: 'Основная навигация' });
  const footer = page.getByRole('navigation', { name: 'Навигация в футере' });
  const toggle = page.getByRole('button', { name: /^(Открыть|Закрыть) меню$/ });
  await page.goto('/'); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (page.viewportSize()!.width < 768) {
    await toggle.focus(); await page.keyboard.press('Enter');
    await header.getByRole('link', { name: 'О прогулке' }).focus(); await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused(); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
  }
  await header.getByRole('link', { name: 'О прогулке' }).focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/about$/); await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveTitle('О Майской прогулке — Майская прогулка');
  await expect(footer.getByRole('link', { name: 'О прогулке' })).toHaveAttribute('aria-current', 'page');
  if (page.viewportSize()!.width < 768) { await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await toggle.click(); }
  await expect(header.getByRole('link', { name: 'О прогулке' })).toHaveAttribute('aria-current', 'page');
  for (const [name, path, heading] of [['Маршруты', '/routes', 'Маршруты'], ['Как участвовать', '/how-to', 'Как участвовать'], ['Вопросы', '/faq', 'Вопросы и ответы'], ['Главная', '/', 'Город становится']]) {
    await footer.getByRole('link', { name, exact: true }).click(); await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : `${path}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading!); await noOverflow(page);
  }
  for (const path of ['/about', '/routes', '/how-to', '/faq']) {
    await page.goto(path); await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await noOverflow(page);
  }
  expect(api.calls.every(call => call.method === 'GET' && call.path === '/api/v1/routes')).toBe(true);
});

test('home editorial sections lead to existing guides and protected registration without writes', async ({ page, api }) => {
  await page.goto('/'); const main = page.getByRole('main');
  await expect(main.getByRole('region')).toHaveCount(5);
  await expect(main.getByRole('list', { name: 'Коротко об участии' })).toContainText('Если ссылка на файл доступна');
  await main.getByRole('link', { name: 'Инструкция по шагам' }).click(); await expect(page).toHaveURL(/\/how-to$/);
  await page.goBack(); await main.getByRole('link', { name: 'О прогулке', exact: false }).click(); await expect(page).toHaveURL(/\/about$/);
  await main.getByRole('link', { name: 'Подготовиться к участию' }).click(); await expect(page).toHaveURL(/\/how-to$/);
  await page.goto('/'); await main.getByRole('link', { name: 'Остались вопросы?' }).click(); await expect(page).toHaveURL(/\/faq$/);
  await page.goto('/'); await main.getByRole('link', { name: 'К регистрации участников' }).click();
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(await page.evaluate(() => (history.state as { usr?: { returnTo?: string } })?.usr?.returnTo)).toBe('/account/participants/new');
  expect(api.calls).toHaveLength(0);
});

test('public layout has visible decoration after hero actions and supports keyboard/reduced motion', async ({ page, api }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab'); const cta = page.getByRole('region', { name: /Город становится/ }).getByRole('link', { name: 'Выбрать маршрут' });
  await expect(cta).toBeFocused();
  expect(await cta.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  const hero = page.getByRole('region', { name: /Город становится/ });
  const svg = hero.locator('svg:visible').first(); await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute('aria-hidden', 'true'); await expect(svg).toHaveAttribute('focusable', 'false');
  const action = (await cta.boundingBox())!, art = (await svg.boundingBox())!;
  if (page.viewportSize()!.width < 900) expect(art.y).toBeGreaterThan(action.y + action.height);
  await noOverflow(page); await representativeScreenshot(page, info, 'home-public-shell');
  await page.goto('/about'); await page.reload(); await expect(page.getByRole('heading', { name: 'О Майской прогулке' })).toBeVisible();
  await noOverflow(page); await representativeScreenshot(page, info, 'about-public-shell');
  expect(api.calls).toHaveLength(0);
});

test('long server route names keep the catalog and common footer readable without inventing content', async ({ page, api }) => {
  const name = 'СинтетическаяДлиннаяСтрока'.repeat(12); api.publicRoutes[0]!.name = name;
  await page.goto('/routes'); await expect(page.getByRole('main')).toContainText(name); await noOverflow(page);
  await page.getByRole('contentinfo').scrollIntoViewIfNeeded(); await expect(page.getByRole('contentinfo')).toBeVisible();
  expect(api.calls.every(call => call.method === 'GET' && call.path === '/api/v1/routes')).toBe(true);
});

for (const role of ['participant', 'admin', 'typist'] as const) {
  test(`footer does not intrude on ${role} workspace and existing role navigation/logout remain intact`, async ({ page, api }) => {
    api.role = role;
    const destination = role === 'admin' ? '/staff/routes' : role === 'typist' ? '/staff/typist' : '/account';
    await login(page, api, destination); await expect(page.getByRole('contentinfo')).toHaveCount(0);
    const name = role === 'admin' ? 'Управление маршрутами' : role === 'typist' ? 'Рабочее место' : 'Личный кабинет';
    const accountLink = page.getByRole('banner').getByRole('link', { name, exact: true }).filter({ visible: true });
    await expect(accountLink).toHaveAttribute('href', destination);
    await page.getByRole('link', { name: 'Майская прогулка — главная' }).click(); await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(accountLink).toHaveAttribute('href', destination); await noOverflow(page);
    if (page.viewportSize()!.width === 1280) {
      for (const width of [768, 900, 1000, 1100, 1280]) {
        await page.setViewportSize({ width, height: 720 }); await noOverflow(page);
        const overlap = await page.getByRole('banner').evaluate(header => {
          const links = Array.from(header.querySelectorAll('a')).filter(link => link.getBoundingClientRect().width > 0);
          return links.some((link, i) => links.slice(i + 1).some(other => {
            const a = link.getBoundingClientRect(), b = other.getBoundingClientRect();
            return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          }));
        });
        expect(overlap, `Header links do not overlap for ${role} at ${width}`).toBe(false);
      }
    }
    await accountLink.click(); await expect(page.getByRole('contentinfo')).toHaveCount(0);
    await logout(page); await expect(page.getByRole('contentinfo')).toBeVisible();
    expect(api.calls.filter(call => call.method !== 'GET').map(call => call.path)).toEqual(['/api/v1/auth/login']);
  });
}
