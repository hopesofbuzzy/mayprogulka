import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page, Route, TestInfo } from '@playwright/test';
import type { components } from '../../src/shared/api/schema';
import { participants, otherParticipants, registration, routes } from './data';

type Reply = { status: number; body: unknown };
type Call = { method: string; path: string; authenticated: boolean; routeIds?: number[]; participantId?: number; paymentMethod?: string };
type Mode = 'success' | '422' | '408' | 'network';
function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => { release = resolve; });
  return { promise, release };
}

export class MockApi {
  readonly violations: string[] = [];
  readonly errors: string[] = [];
  readonly calls: Call[] = [];
  readonly password = randomUUID(); // Generated per test; never logged or persisted.
  identity: 'A' | 'B' = 'A';
  role = 'participant';
  paperMode: Mode = 'success';
  matchMode: Mode = 'success';
  unlinkedMode: 'success' | '403' | '500' = 'success';
  maps: components['schemas']['UnlinkedMapResponse'][] = [{ id: 1, barcode: '000001', participant_id: null }, { id: 2, barcode: '000002' }];
  private staffGate: ReturnType<typeof deferred<Reply>> | null = null;
  private staffSeen = deferred<void>();
  private staffCompleted = deferred<void>();
  routeMode: 'success' | '500' | 'html' = 'success';
  registrationMode: Mode = 'success';
  paymentMode: Mode = 'success';
  pdfUrl: string | null = null;
  mine: components['schemas']['ParticipantListItem'][] = structuredClone(participants);
  private tokens = { A: randomUUID(), B: randomUUID() };
  private paymentGate: ReturnType<typeof deferred<Reply>> | null = null;
  private paymentSeen = deferred<void>();
  private completed = deferred<void>();

  count(method: string, path: string) { return this.calls.filter(call => call.method === method && call.path === path).length; }
  deferPayment() {
    this.paymentGate = deferred<Reply>();
    return { seen: this.paymentSeen.promise, release: this.paymentGate.release, completed: this.completed.promise };
  }
  deferStaff() {
    this.staffGate = deferred<Reply>();
    return { seen: this.staffSeen.promise, release: this.staffGate.release, completed: this.staffCompleted.promise };
  }
  async install(context: BrowserContext, origin: string) {
    context.on('page', page => page.on('pageerror', () => this.errors.push('Uncaught browser JavaScript error')));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) {
        this.violations.push('Blocked non-test origin'); await route.abort('blockedbyclient'); return;
      }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      try { await this.handle(route, url); }
      catch {
        this.violations.push('Fixture request/DTO validation failed');
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
  }
  private async handle(route: Route, url: URL) {
    const request = route.request(), method = request.method(), path = url.pathname;
    const token = request.headers().authorization;
    const authenticated = token === `Bearer ${this.tokens[this.identity]}`;
    const call: Call = { method, path, authenticated };
    this.calls.push(call);
    const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (method === 'GET' && path === '/api/v1/routes') {
      expect(Boolean(token), 'Public routes must not carry credentials').toBe(false);
      if (this.routeMode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html>Unexpected SPA fallback</html>' });
      return this.routeMode === '500' ? reply({}, 500) : reply({ routes });
    }
    if (method === 'POST' && ['/api/v1/auth/login', '/api/v1/auth/register'].includes(path)) {
      expect(Boolean(token), 'Auth request must not carry credentials').toBe(false);
      const body = request.postDataJSON() as Record<string, unknown>;
      const signup = path.endsWith('/register');
      expect(Object.keys(body).sort()).toEqual(signup ? ['email', 'password', 'username'] : ['password', 'username']);
      expect(body.password === this.password, 'Only the generated synthetic password is allowed').toBe(true);
      expect(body.username === 'synthetic-test-account', 'Only the synthetic UI account is allowed').toBe(true);
      if (signup) expect(body.email === 'account@example.test').toBe(true);
      return reply({ access_token: this.tokens[this.identity], user_id: this.identity === 'A' ? 7 : 9, role: this.role }, signup ? 201 : 200);
    }
    if (method === 'GET' && path === '/api/v1/participants/my') {
      expect(authenticated, 'Private GET must use only the current synthetic credentials').toBe(true);
      expect(url.search).toBe('');
      return reply({ participants: this.identity === 'A' ? this.mine : otherParticipants });
    }
    if (method === 'POST' && path === '/api/v1/participants/register') {
      expect(authenticated, 'Participant registration must carry the current synthetic Bearer').toBe(true);
      const body = request.postDataJSON() as { participants: components['schemas']['ParticipantData'][] };
      expect(Object.keys(body)).toEqual(['participants']); expect(body.participants.length).toBe(2);
      for (const item of body.participants) {
        expect(Object.keys(item).sort()).toEqual(['date_of_birth', 'email', 'gender', 'middle_name', 'name', 'phone_number', 'route_id', 'surname']);
        expect(typeof item.route_id).toBe('number'); expect(item.email.endsWith('@example.test')).toBe(true);
        expect(item.middle_name).toBeNull(); expect(['male', 'female'].includes(item.gender)).toBe(true);
      }
      call.routeIds = body.participants.map(item => item.route_id);
      expect(call.routeIds).toEqual([12, 15]);
      if (this.registrationMode === 'network') return route.abort('failed');
      if (this.registrationMode === '422') return reply({ detail: [{ loc: ['body', 'participants', 1, 'email'], type: 'value_error', msg: 'untrusted fixture detail' }] }, 422);
      if (this.registrationMode === '408') return reply({}, 408);
      this.mine = structuredClone(participants); return reply(registration, 201);
    }
    if (method === 'POST' && path === '/api/v1/participants/42/pay') {
      expect(authenticated, 'Payment must carry current synthetic credentials').toBe(true);
      const body = request.postDataJSON() as { payment_method: string };
      expect(Object.keys(body)).toEqual(['payment_method']); expect(['card', 'sbp'].includes(body.payment_method)).toBe(true);
      call.participantId = 42; call.paymentMethod = body.payment_method;
      this.paymentSeen.release();
      if (this.paymentGate) {
        const delayed = await this.paymentGate.promise;
        try { await reply(delayed.body, delayed.status); }
        finally { this.completed.release(); }
        return;
      }
      if (this.paymentMode === 'network') return route.abort('failed');
      if (this.paymentMode === '408') return reply({}, 408);
      this.mine = this.mine.map(item => item.id === 42 ? { ...item, payment_status: 'paid' } : item);
      return reply({ status: 'synthetic-operation-status', payment_id: 'synthetic-operation-id', form_pdf_url: this.pdfUrl });
    }
    if (method === 'GET' && path === '/api/v1/typist/unlinked') {
      expect(authenticated && this.role === 'typist', 'Staff GET requires exact typist synthetic session').toBe(true);
      expect(url.search).toBe('?limit=100');
      return this.unlinkedMode !== 'success' ? reply({}, Number(this.unlinkedMode)) : reply({ maps: this.maps });
    }
    if (method === 'POST' && (path === '/api/v1/typist/paper-form' || path === '/api/v1/typist/match')) {
      expect(authenticated && this.role === 'typist', 'Staff mutation requires exact typist synthetic session').toBe(true);
      const paper = path.endsWith('/paper-form');
      const body = request.postDataJSON() as Record<string, unknown>;
      if (paper) {
        expect(Object.keys(body).sort()).toEqual(['date_of_birth', 'email', 'gender', 'middle_name', 'name', 'phone_number', 'route_id', 'surname']);
        expect(body.route_id).toBe(15); expect(body.email === 'paper@example.test').toBe(true); expect(body.middle_name).toBeNull();
      } else {
        expect(Object.keys(body).sort()).toEqual(['barcode', 'form_id']);
        expect(body.barcode === '000001', 'Synthetic barcode must retain its zeros exactly').toBe(true);
        expect(typeof body.form_id === 'string' && body.form_id.startsWith('000'), 'Synthetic form ID remains a string with leading zeros').toBe(true);
      }
      this.staffSeen.release();
      if (this.staffGate) {
        const delayed = await this.staffGate.promise;
        try { await reply(delayed.body, delayed.status); } finally { this.staffCompleted.release(); }
        return;
      }
      const mode = paper ? this.paperMode : this.matchMode;
      if (mode === 'network') return route.abort('failed');
      if (mode === '408') return reply({}, 408);
      if (mode === '422') return reply({ detail: [{ loc: ['body', paper ? 'email' : 'barcode'], msg: 'untrusted staff detail' }] }, 422);
      if (paper) return reply({ participant_id: 101, form_id: '000P01', payment_status: 'paid' } satisfies components['schemas']['PaperFormResponse'], 201);
      this.maps = this.maps.filter(map => map.barcode !== body.barcode);
      return reply({ status: 'synthetic-match-status', barcode: '000001', participant_id: 101, participant_name: 'Тестов Бумажный', message: 'Синтетический ответ сервера' } satisfies components['schemas']['MatchResponse']);
    }
    // No fallback/continue/fetch: even a mistaken mutating request cannot reach FastAPI.
    this.violations.push('Unexpected API method/path blocked');
    await route.abort('blockedbyclient');
  }
}

export const test = base.extend<{ api: MockApi }>({
  api: [async ({ context, baseURL }, use) => {
    const api = new MockApi(); await api.install(context, new URL(baseURL!).origin);
    await use(api);
    expect(api.violations, 'Unexpected API traffic must fail the test').toEqual([]);
    expect(api.errors, 'Browser JavaScript errors must fail the test').toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function login(page: Page, api: MockApi, destination = '/account') {
  await page.goto(destination);
  await signIn(page, api);
  await expect(page).toHaveURL(new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
}
export async function signIn(page: Page, api: MockApi) {
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  await page.getByLabel('Имя пользователя').fill('synthetic-test-account');
  await page.getByLabel('Пароль', { exact: true }).fill(api.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toHaveCount(0);
}
export async function logout(page: Page) {
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
}
export async function familyForm(page: Page, api: MockApi) {
  await login(page, api, '/account/participants/new');
  await fillFamily(page);
}
export async function fillFamily(page: Page) {
  await page.getByRole('option', { name: /Тестовая лесная тропа/ }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Добавить ещё участника' }).click();
  for (const index of [1, 2]) {
    const row = page.getByRole('group', { name: `Участник ${index}`, exact: true });
    for (const [label, value] of [['Фамилия', index === 1 ? 'Тестов' : 'Тестова'], ['Имя', index === 1 ? 'Первый' : 'Вторая'], ['Дата рождения', '1995-05-20'], ['Email', 'family@example.test'], ['Телефон', 'местный 123']]) await row.getByLabel(label!, { exact: true }).fill(value!);
    await row.getByLabel('Пол', { exact: true }).selectOption(index === 1 ? 'male' : 'female');
    await row.getByLabel('Маршрут', { exact: true }).selectOption(index === 1 ? '12' : '15');
  }
}
export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at the configured viewport').toBe(true);
}
export async function representativeScreenshot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
}
