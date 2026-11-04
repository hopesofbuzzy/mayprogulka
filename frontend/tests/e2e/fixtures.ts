import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page, Route, TestInfo } from '@playwright/test';
import type { components } from '../../src/shared/api/schema';
import { participants, otherParticipants, registration, routes } from './data';

type Reply = { status: number; body: unknown };
type Call = { method: string; path: string; authenticated: boolean; routeIds?: number[]; routeId?: number; checkpointId?: number; participantId?: number; paymentMethod?: string };
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
  authStatus: 200 | 401 | 422 = 200;
  checkpoint422Field = 'coordinates';
  paperMode: Mode = 'success';
  matchMode: Mode = 'success';
  unlinkedMode: 'success' | '403' | '500' = 'success';
  maps: components['schemas']['UnlinkedMapResponse'][] = [{ id: 1, barcode: '000001', participant_id: null }, { id: 2, barcode: '000002' }];
  private staffGate: ReturnType<typeof deferred<Reply>> | null = null;
  private staffSeen = deferred<void>();
  private staffCompleted = deferred<void>();
  routeMode: 'success' | '500' | 'html' | 'empty' | 'invalid' = 'success';
  publicRoutes: components['schemas']['RouteResponse'][] = structuredClone(routes);
  checkpointMode: 'success' | 'empty' | '500' | '403' | 'network' | 'invalid' | 'foreign' = 'success';
  checkpointWriteMode: 'success' | '422' | '403' | '409' | '408' | 'network' | 'timeout' = 'success';
  checkpointRecords = new Map<number, components['schemas']['CheckpointResponse'][]>();
  checkpointReadFailure = false;
  batchMode: 'full' | 'partial' | 'contradictory' | 'zero' | '422' | '403' | '409' | '408' | '500' | 'network' | 'timeout' | 'malformed' = 'full';
  batchReadFailure = false;
  private batchGate: ReturnType<typeof deferred<Reply>> | null = null;
  private batchSeen = deferred<void>();
  private batchCompleted = deferred<void>();
  private batchNextId = 5000;
  private checkpointGate: ReturnType<typeof deferred<Reply>> | null = null;
  private checkpointSeen = deferred<void>();
  private checkpointCompleted = deferred<void>();
  adminMode: 'success' | '422' | '408' | '409' | '403' | 'network' = 'success';
  adminReadFailure = false;
  private adminGate: ReturnType<typeof deferred<Reply>> | null = null;
  private adminSeen = deferred<void>();
  private adminCompleted = deferred<void>();
  registrationMode: Mode = 'success';
  paymentMode: Mode = 'success';
  pdfUrl: string | null = null;
  mine: components['schemas']['ParticipantListItem'][] = structuredClone(participants);
  private tokens = { A: randomUUID(), B: randomUUID() };
  private paymentGate: ReturnType<typeof deferred<Reply>> | null = null;
  private paymentSeen = deferred<void>();
  private completed = deferred<void>();

  count(method: string, path: string) { return this.calls.filter(call => call.method === method && call.path === path).length; }
  deferBatch() {
    this.batchGate = deferred<Reply>();
    return { seen: this.batchSeen.promise, release: this.batchGate.release, completed: this.batchCompleted.promise };
  }
  deferCheckpoint() {
    this.checkpointGate = deferred<Reply>();
    return { seen: this.checkpointSeen.promise, release: this.checkpointGate.release, completed: this.checkpointCompleted.promise };
  }
  deferAdmin() {
    this.adminGate = deferred<Reply>();
    return { seen: this.adminSeen.promise, release: this.adminGate.release, completed: this.adminCompleted.promise };
  }
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
      expect(url.search).toBe('');
      if (this.routeMode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html>Unexpected SPA fallback</html>' });
      if (this.routeMode === 'invalid') return reply({ routes: [{ name: { unexpected: true } }] });
      return this.routeMode === '500' ? reply({}, 500) : reply({ routes: this.routeMode === 'empty' ? [] : this.publicRoutes });
    }
    if (method === 'GET' && path === '/api/v1/checkpoints') {
      expect(Boolean(token), 'Public checkpoints must not carry credentials').toBe(false);
      const id = Number(url.searchParams.get('route_id'));
      expect(url.search).toBe(`?route_id=${id}`);
      expect(Number.isSafeInteger(id) && this.publicRoutes.some(item => item.id === id), 'Checkpoints require an existing route ID').toBe(true);
      call.routeId = id;
      if (this.checkpointMode === 'network') return route.abort('failed');
      if (this.checkpointMode === '500' || this.checkpointMode === '403') return reply({}, Number(this.checkpointMode));
      if (this.checkpointMode === 'invalid') return reply({ checkpoints: [{ name: { unexpected: true } }] });
      const checkpoints: components['schemas']['CheckpointResponse'][] = [
        { id: id * 100 + 3, route_id: id, name: 'Тестовый финиш', address: 'Синтетический адрес финиша', coordinates: 'opaque: format not agreed', order: 3, is_start: false, is_finish: true },
        { id: id * 100 + 1, route_id: id, name: 'Тестовый старт', address: 'Синтетический адрес старта', coordinates: 'opaque: format not agreed', order: 1, is_start: true, is_finish: false },
        { id: id * 100 + 2, route_id: id, name: 'Тестовый лесной КП', address: 'Синтетический адрес КП', coordinates: 'opaque: format not agreed', order: 2, is_start: false, is_finish: false },
      ];
      if (!this.checkpointRecords.has(id)) this.checkpointRecords.set(id, checkpoints);
      if (this.checkpointMode === 'foreign') return reply({ checkpoints: [{ ...checkpoints[0], route_id: id + 1 }] });
      return reply({ checkpoints: this.checkpointMode === 'empty' ? [] : this.checkpointRecords.get(id) });
    }
    if (method === 'POST' && path === '/api/v1/admin/checkpoints/batch') {
      expect(authenticated && this.role === 'admin', 'Batch requires the current exact synthetic admin').toBe(true);
      expect(url.search).toBe('');
      const body = request.postDataJSON() as components['schemas']['BatchCheckpointCreateRequest'];
      expect(Object.keys(body).sort()).toEqual(['checkpoints', 'route_id']);
      expect(Number.isSafeInteger(body.route_id) && this.publicRoutes.some(route => route.id === body.route_id)).toBe(true);
      expect(Array.isArray(body.checkpoints) && body.checkpoints.length > 0).toBe(true);
      for (const item of body.checkpoints) {
        expect(Object.keys(item).sort()).toEqual(['address', 'coordinates', 'is_finish', 'is_start', 'name', 'order', 'route_id']);
        expect(item.route_id).toBe(body.route_id); expect(Number.isSafeInteger(item.order)).toBe(true);
        for (const field of ['name', 'address', 'coordinates'] as const) expect(typeof item[field] === 'string' && Boolean(item[field].trim())).toBe(true);
        expect(typeof item.is_start).toBe('boolean'); expect(typeof item.is_finish).toBe('boolean');
      }
      call.routeId = body.route_id; call.routeIds = body.checkpoints.map(row => row.route_id); this.batchSeen.release();
      const save = (count: number) => { const existing = this.checkpointRecords.get(body.route_id) ?? []; this.checkpointRecords.set(body.route_id, [...existing, ...body.checkpoints.slice(0, count).map(point => ({ ...point, id: ++this.batchNextId }))]); };
      if (this.batchGate) {
        const delayed = await this.batchGate.promise;
        try { if (delayed.status === 201) save((delayed.body as components['schemas']['BatchCheckpointResponse']).created_count); await reply(delayed.body, delayed.status); } finally { this.batchCompleted.release(); } return;
      }
      if (this.batchMode === 'network' || this.batchMode === 'timeout') return route.abort(this.batchMode === 'timeout' ? 'timedout' : 'failed');
      if (this.batchMode === 'malformed') return route.fulfill({ status: 201, contentType: 'application/json', body: '{' });
      if (this.batchMode === '422') return reply({ detail: [{ loc: ['body', 'checkpoints', 1, 'coordinates'], msg: '<script>untrusted</script>' }] }, 422);
      if (['403', '409', '408', '500'].includes(this.batchMode)) return reply({}, Number(this.batchMode));
      const count = this.batchMode === 'partial' ? 1 : this.batchMode === 'zero' ? 0 : body.checkpoints.length;
      const errors = this.batchMode === 'partial' || this.batchMode === 'contradictory' ? [{ arbitrary: { detail: '<script>synthetic message</script>', url: 'https://example.test/not-a-link' } }] : [];
      save(count); if (this.batchReadFailure) this.checkpointMode = '500';
      return reply({ created_count: count, errors }, 201);
    }
    if ((method === 'POST' && path === '/api/v1/admin/checkpoints') || (['PUT', 'DELETE'].includes(method) && /^\/api\/v1\/admin\/checkpoints\/\d+$/.test(path))) {
      expect(authenticated && this.role === 'admin', 'Checkpoint writes require current exact admin synthetic credentials').toBe(true);
      expect(url.search).toBe('');
      const body = method === 'DELETE' ? {} : request.postDataJSON() as Record<string, unknown>;
      const checkpointId = method === 'POST' ? 1205 : Number(path.split('/').at(-1));
      const baseline = [...this.checkpointRecords.values()].flat().find(point => point.id === checkpointId);
      const routeId = method === 'POST' ? body.route_id as number : baseline?.route_id;
      expect(Number.isSafeInteger(routeId) && this.publicRoutes.some(item => item.id === routeId)).toBe(true);
      const fields = ['name', 'address', 'coordinates', 'order', 'is_start', 'is_finish'];
      if (method === 'POST') expect(Object.keys(body).sort()).toEqual([...fields, 'route_id'].sort());
      if (method === 'PUT') { expect(Object.keys(body).length).toBeGreaterThan(0); expect(Object.keys(body).every(field => fields.includes(field))).toBe(true); }
      if (method === 'DELETE') expect(request.postData()).toBeNull();
      if (method !== 'POST') expect(Boolean(baseline), 'Checkpoint must exist in the selected synthetic list').toBe(true);
      for (const field of ['name', 'address', 'coordinates']) if (Object.hasOwn(body, field)) expect(typeof body[field] === 'string' && Boolean((body[field] as string).trim())).toBe(true);
      if (Object.hasOwn(body, 'order')) expect(Number.isSafeInteger(body.order)).toBe(true);
      for (const field of ['is_start', 'is_finish']) if (Object.hasOwn(body, field)) expect(typeof body[field]).toBe('boolean');
      call.checkpointId = checkpointId; call.routeId = routeId; this.checkpointSeen.release();
      if (this.checkpointGate) {
        const delayed = await this.checkpointGate.promise;
        try { await (delayed.status === 204 ? route.fulfill({ status: 204, body: '' }) : reply(delayed.body, delayed.status)); } finally { this.checkpointCompleted.release(); }
        return;
      }
      if (this.checkpointWriteMode === 'network' || this.checkpointWriteMode === 'timeout') return route.abort(this.checkpointWriteMode === 'timeout' ? 'timedout' : 'failed');
      if (this.checkpointWriteMode === '422') return reply({ detail: [{ loc: ['body', this.checkpoint422Field], msg: '<script>untrusted</script>' }] }, 422);
      if (this.checkpointWriteMode !== 'success') return reply({}, Number(this.checkpointWriteMode));
      if (this.checkpointReadFailure) this.checkpointMode = '500';
      const existing = this.checkpointRecords.get(routeId!) ?? [];
      if (method === 'DELETE') { this.checkpointRecords.set(routeId!, existing.filter(point => point.id !== checkpointId)); return route.fulfill({ status: 204, body: '' }); }
      const result = method === 'POST' ? { ...body, id: checkpointId } as components['schemas']['CheckpointResponse'] : { ...baseline!, ...body };
      this.checkpointRecords.set(routeId!, method === 'POST' ? [...existing, result] : existing.map(point => point.id === checkpointId ? result : point));
      return reply(result, method === 'POST' ? 201 : 200);
    }
    if ((method === 'POST' && path === '/api/v1/admin/routes') || (['PUT', 'DELETE'].includes(method) && /^\/api\/v1\/admin\/routes\/\d+$/.test(path))) {
      expect(authenticated && this.role === 'admin', 'Admin mutations require exact current admin synthetic credentials').toBe(true);
      expect(url.search).toBe('');
      const id = method === 'POST' ? 101 : Number(path.split('/').at(-1));
      if (method !== 'POST') expect(this.publicRoutes.some(item => item.id === id), 'Mutation ID must come from the public fixture list').toBe(true);
      call.routeId = id;
      const body = method === 'DELETE' ? {} : request.postDataJSON() as Record<string, unknown>;
      if (method === 'POST') {
        expect(Object.keys(body).sort()).toEqual(['distance', 'is_active', 'name', 'year', ...(Object.hasOwn(body, 'description') ? ['description'] : [])].sort());
        expect(Number.isSafeInteger(body.year)).toBe(true); expect(typeof body.name).toBe('string');
        expect(typeof body.distance === 'number' && Number.isFinite(body.distance)).toBe(true); expect(typeof body.is_active).toBe('boolean');
      } else if (method === 'PUT') {
        expect(Object.keys(body).length).toBeGreaterThan(0);
        expect(Object.keys(body).every(field => ['name', 'distance', 'description', 'is_active'].includes(field))).toBe(true);
        if (Object.hasOwn(body, 'name')) expect(typeof body.name).toBe('string');
        if (Object.hasOwn(body, 'distance')) expect(typeof body.distance === 'number' && Number.isFinite(body.distance)).toBe(true);
        if (Object.hasOwn(body, 'is_active')) expect(typeof body.is_active).toBe('boolean');
      } else expect(request.postData()).toBeNull();
      if (Object.hasOwn(body, 'description')) expect(body.description === null || typeof body.description === 'string').toBe(true);
      this.adminSeen.release();
      if (this.adminGate) {
        const delayed = await this.adminGate.promise;
        try { await (delayed.status === 204 ? route.fulfill({ status: 204, body: '' }) : reply(delayed.body, delayed.status)); }
        finally { this.adminCompleted.release(); }
        return;
      }
      if (this.adminMode === 'network') return route.abort('failed');
      if (this.adminMode === '422') return reply({ detail: [{ loc: ['body', 'name'], msg: 'untrusted admin detail', input: 'not for rendering' }] }, 422);
      if (this.adminMode !== 'success') return reply({}, Number(this.adminMode));
      if (this.adminReadFailure) this.routeMode = '500';
      if (method === 'DELETE') { this.publicRoutes = this.publicRoutes.filter(item => item.id !== id); return route.fulfill({ status: 204, body: '' }); }
      const result = method === 'POST' ? { ...body, id } as components['schemas']['RouteResponse'] : { ...this.publicRoutes.find(item => item.id === id)!, ...body };
      if (method === 'POST') this.publicRoutes.push(result); else this.publicRoutes = this.publicRoutes.map(item => item.id === id ? result : item);
      return reply(result, method === 'POST' ? 201 : 200);
    }
    if (method === 'POST' && ['/api/v1/auth/login', '/api/v1/auth/register'].includes(path)) {
      expect(Boolean(token), 'Auth request must not carry credentials').toBe(false);
      const body = request.postDataJSON() as Record<string, unknown>;
      const signup = path.endsWith('/register');
      expect(Object.keys(body).sort()).toEqual(signup ? ['email', 'password', 'username'] : ['password', 'username']);
      expect(body.password === this.password, 'Only the generated synthetic password is allowed').toBe(true);
      expect(body.username === 'synthetic-test-account', 'Only the synthetic UI account is allowed').toBe(true);
      if (signup) expect(body.email === 'account@example.test').toBe(true);
        if (this.authStatus !== 200) return reply(this.authStatus === 422 ? { detail: [{ loc: ['body', 'username'], msg: 'Synthetic rejection' }] } : {}, this.authStatus);
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
  // addRow moves focus in requestAnimationFrame; wait before filling row 1 so that
  // the scheduled row-2 focus cannot interrupt the first fill on a slower frame.
  await expect(page.getByRole('group', { name: 'Участник 2', exact: true }).getByLabel('Фамилия', { exact: true })).toBeFocused();
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
