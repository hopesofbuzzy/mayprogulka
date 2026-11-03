import { test, expect, login } from './fixtures';

test('batch flag off hides entry while existing single CRUD stays available', async ({ page, api }) => {
  api.role = 'admin'; await login(page, api, '/staff/routes/12/checkpoints'); await expect(page.getByRole('heading', { name: 'КП маршрута', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить несколько КП' })).toHaveCount(0); await page.getByRole('button', { name: 'Создать один КП' }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); expect(api.count('POST', '/api/v1/admin/checkpoints/batch')).toBe(0);
});
