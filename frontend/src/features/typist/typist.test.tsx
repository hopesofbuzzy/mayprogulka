import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/router';
import { sessionStore } from '../../shared/session/store';
import { safeReturnTo } from '../auth/redirect';
import { createPaper, matchMap, unlinkedOptions } from './api';

const paths = ['/staff/typist', '/staff/typist/new', '/staff/typist/match', '/staff/typist/unlinked'];
const routes = [{ id: 12, name: 'Тестовый лесной', year: 2026, distance: 12, is_active: true }, { id: 15, name: 'Тестовый городской', year: 2025, distance: 18, is_active: true }];
const maps = [{ id: 1, barcode: '000001', participant_id: null }, { id: 2, barcode: '000002', participant_id: 42 }];
const paper = { participant_id: 101, form_id: '000P01', payment_status: 'paid' };
const matched = { status: 'arbitrary-status', barcode: '000001', participant_id: 42, participant_name: 'Тестов Первый', message: '<b>Ответ как текст</b>' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const transport = vi.fn<typeof fetch>();
let getMaps: () => Promise<Response>;
let getRoutes: () => Promise<Response>;
let postPaper: () => Promise<Response>;
let postMatch: () => Promise<Response>;
let loginRole: string;
const clients: QueryClient[] = [], routers: ReturnType<typeof createMemoryRouter>[] = [];
function login(role = 'typist', user = 7) { sessionStore.login({ access_token: `synthetic-${user}`, user_id: user, role }, sessionStore.beginAuthentication()); }
beforeEach(() => {
  sessionStore.logout(); login(); transport.mockReset(); loginRole = 'typist';
  getMaps = async () => json({ maps }); getRoutes = async () => json({ routes });
  postPaper = async () => json(paper, 201); postMatch = async () => json(matched);
  transport.mockImplementation(async input => {
    const path = new URL((input as Request).url).pathname;
    if (path === '/api/v1/routes') return getRoutes();
    if (path === '/api/v1/typist/unlinked') return getMaps();
    if (path === '/api/v1/typist/paper-form') return postPaper();
    if (path === '/api/v1/typist/match') return postMatch();
    if (path === '/api/v1/auth/login') return json({ access_token: 'synthetic-login', user_id: 7, role: loginRole });
    if (path === '/api/v1/participants/my') return json({ participants: [] });
    throw new Error('Unexpected test endpoint');
  });
  vi.stubGlobal('fetch', transport);
});
afterEach(() => { cleanup(); sessionStore.logout(); clients.splice(0).forEach(client => client.clear()); routers.splice(0).forEach(router => router.dispose()); });
function mount(path = '/staff/typist') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] }); clients.push(client); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router, user: userEvent.setup() };
}
const calls = (path: string) => transport.mock.calls.filter(([input]) => new URL((input as Request).url).pathname === path);
const paperCalls = () => calls('/api/v1/typist/paper-form');
const matchCalls = () => calls('/api/v1/typist/match');
const staffCalls = () => transport.mock.calls.filter(([input]) => new URL((input as Request).url).pathname.startsWith('/api/v1/typist/'));
async function signIn(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText('Имя пользователя'), { target: { value: 'synthetic-only' } });
  fireEvent.change(screen.getByLabelText('Пароль', { exact: true }), { target: { value: 'synthetic-password' } });
  await user.click(screen.getByRole('button', { name: 'Войти' }));
}
async function fillPaper() {
  await screen.findByRole('option', { name: /Тестовый городской/ });
  for (const [label, value] of [['Фамилия', 'Тестов'], ['Имя', 'Бумажный'], ['Дата рождения', '1995-05-20'], ['Email', 'paper@example.test'], ['Телефон', 'местный 123']]) fireEvent.change(screen.getByLabelText(label!, { exact: true }), { target: { value } });
  fireEvent.change(screen.getByLabelText('Пол'), { target: { value: 'male' } });
  fireEvent.change(screen.getByLabelText('Маршрут'), { target: { value: '15' } });
}
async function fillMatch(form = '000F01', barcode = '000001') {
  await screen.findByLabelText('Номер анкеты (form_id)');
  fireEvent.change(screen.getByLabelText('Номер анкеты (form_id)'), { target: { value: form } });
  fireEvent.change(screen.getByLabelText('Штрихкод физической карты (barcode)'), { target: { value: barcode } });
}
async function submit(kind: 'paper' | 'match') {
  const context = mount(kind === 'paper' ? paths[1] : paths[2]);
  if (kind === 'paper') await fillPaper(); else await fillMatch();
  await context.user.click(screen.getByRole('button', { name: kind === 'paper' ? 'Проверить анкету' : 'Проверить пару' }));
  await context.user.click(screen.getByRole('button', { name: kind === 'paper' ? 'Подтвердить создание анкеты' : 'Подтвердить сопоставление' }));
  return context;
}

describe('typist access and login return', () => {
  it.each(paths)('protects direct guest URL %s and returns after typist login', async path => {
    sessionStore.logout(); const { router, user } = mount(path);
    await screen.findByRole('heading', { name: 'Вход' }); expect(staffCalls()).toHaveLength(0);
    await signIn(user); await waitFor(() => expect(router.state.location.pathname).toBe(path));
    expect(screen.queryByRole('heading', { name: 'Нет доступа' })).not.toBeInTheDocument();
  });
  it.each(['participant', 'organizer', 'admin', 'checkpoint', 'Typist', 'unknown'].flatMap(role => paths.map(path => [role, path])))('denies role %s at %s without any service reads/writes', async (role, path) => {
    login(role); mount(path);
    await screen.findByRole('heading', { name: 'Нет доступа' });
    expect(transport).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Рабочее место' })).not.toBeInTheDocument();
  });
  it('defaults to the typist landing on ordinary login without a saved returnTo', async () => {
    sessionStore.logout(); const { user } = mount('/login'); await screen.findByRole('heading', { name: 'Вход' });
    await signIn(user); await screen.findByRole('heading', { name: 'Рабочее место наборщика' });
  });
  it('preserves an explicit supported account destination for a typist', async () => {
    sessionStore.logout(); const { user } = mount('/account'); await screen.findByRole('heading', { name: 'Вход' });
    await signIn(user); await screen.findByRole('heading', { name: 'Личный кабинет' });
  });
  it.each(['//evil.example/staff/typist', 'https://evil.example', '/staff/typist/match/again', '/staff/other', '/staff/typist?form_id=0001', '/staff/typist#barcode', '/staff/x/../typist', '/staff/typist/%2e%2e/match', '/staff/typist%5c', '/staff/typist?x=%250a'])('rejects unsafe/nonexact staff return %s', value => expect(safeReturnTo(value)).toBe('/account'));
});

describe('one paper form', () => {
  it('reviews before one exact DTO POST, guards double clicks and shows real separate identifiers/status', async () => {
    let resolve!: (reply: Response) => void; postPaper = () => new Promise(done => { resolve = done; });
    const { user, router } = mount(paths[1]); await fillPaper(); expect(paperCalls()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Проверить анкету' }));
    expect(paperCalls()).toHaveLength(0); expect(screen.getByRole('region', { name: 'Проверка бумажной анкеты' })).toHaveTextContent('Тестовый городской');
    await user.dblClick(screen.getByRole('button', { name: 'Подтвердить создание анкеты' }));
    expect(paperCalls()).toHaveLength(1);
    expect(screen.getByLabelText('Имя', { exact: true })).toBeDisabled();
    const request = paperCalls()[0]![0] as Request;
    expect(await request.clone().json()).toEqual({ surname: 'Тестов', name: 'Бумажный', middle_name: null, date_of_birth: '1995-05-20', gender: 'male', email: 'paper@example.test', phone_number: 'местный 123', route_id: 15 });
    expect(request.headers.get('Authorization') === 'Bearer synthetic-7').toBe(true);
    await act(async () => { resolve(json(paper, 201)); });
    await screen.findByRole('heading', { name: 'Ответ по бумажной анкете получен' });
    expect(screen.getByText('000P01')).toBeInTheDocument(); expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('paid', { exact: true })).toBeInTheDocument(); expect(screen.queryByText('Оплачено', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('Отметка оплаты в системе не подтверждает получение денег.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Перейти к сопоставлению' }));
    expect(screen.getByLabelText('Номер анкеты (form_id)')).toHaveValue('');
    expect(router.state.location.pathname).toBe('/staff/typist/match'); expect(router.state.location.state).toBeNull();
    expect(matchCalls()).toHaveLength(0);
  });
  it('requires valid calendar/email/nonempty fields and an active loaded route, not a guessed year', async () => {
    const { user } = mount(paths[1]); await screen.findByRole('option', { name: /Тестовый городской/ });
    await user.click(screen.getByRole('button', { name: 'Проверить анкету' }));
    expect(screen.getByLabelText('Фамилия')).toHaveAttribute('aria-invalid', 'true'); expect(paperCalls()).toHaveLength(0);
    await fillPaper(); getRoutes = async () => json({ routes: [routes[0]] });
    await user.click(screen.getByRole('button', { name: 'Обновить маршруты' }));
    await screen.findByRole('option', { name: 'Выбранный маршрут недоступен' });
    await user.click(screen.getByRole('button', { name: 'Проверить анкету' }));
    expect(screen.getByLabelText('Маршрут')).toHaveAttribute('aria-invalid', 'true'); expect(paperCalls()).toHaveLength(0);
  });
  it('maps paper 422 by field and preserves values without echoing raw details', async () => {
    postPaper = async () => json({ detail: [{ loc: ['body', 'email'], msg: '<unsafe>', input: 'do-not-echo' }, { loc: ['body', 'unknown'], msg: 'raw' }] }, 422);
    await submit('paper'); await screen.findByRole('alert');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Имя', { exact: true })).toHaveValue('Бумажный');
    expect(screen.getByLabelText('Маршрут')).toHaveValue('15'); expect(document.body).not.toHaveTextContent('do-not-echo');
  });
});

describe('online match review and literal string codes', () => {
  it('never creates paper, preserves zeroes/whitespace and does not submit on repeated Enter before explicit confirmation', async () => {
    const literal = ' 000Ab-01 ';
    postMatch = async () => json({ ...matched, barcode: literal });
    const { user } = mount(paths[2]); await fillMatch('000F01', literal);
    screen.getByLabelText('Номер анкеты (form_id)').focus(); await user.keyboard('{Enter}{Enter}{Enter}{Enter}');
    expect(matchCalls()).toHaveLength(0); expect(paperCalls()).toHaveLength(0);
    if (screen.queryByRole('button', { name: 'Проверить пару' })) await user.click(screen.getByRole('button', { name: 'Проверить пару' }));
    expect(screen.getByRole('region', { name: 'Проверка пары' })).toBeInTheDocument();
    await user.dblClick(screen.getByRole('button', { name: 'Подтвердить сопоставление' }));
    await screen.findByRole('heading', { name: 'Ответ сопоставления получен' });
    expect(matchCalls()).toHaveLength(1);
    expect(await (matchCalls()[0]![0] as Request).clone().json()).toEqual({ form_id: '000F01', barcode: literal });
    expect(screen.getByText('arbitrary-status')).toBeInTheDocument(); expect(screen.getByText('<b>Ответ как текст</b>')).toBeInTheDocument();
    expect(document.querySelector('dd b')).toBeNull(); expect(localStorage.length + sessionStorage.length).toBe(0);
  });
  it('clears only unsent input without an unlink/DELETE operation', async () => {
    const { user } = mount(paths[2]); await fillMatch();
    await user.click(screen.getByRole('button', { name: 'Очистить ввод' }));
    expect(screen.getByLabelText('Номер анкеты (form_id)')).toHaveValue(''); expect(staffCalls()).toHaveLength(0);
  });
  it('maps match 422 to barcode only and allows field correction without changing the other code', async () => {
    postMatch = async () => json({ detail: [{ loc: ['body', 'barcode'], msg: 'raw-private' }] }, 422);
    await submit('match'); await screen.findByRole('alert');
    expect(screen.getByLabelText('Штрихкод физической карты (barcode)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Номер анкеты (form_id)')).toHaveValue('000F01'); expect(document.body).not.toHaveTextContent('raw-private');
  });
  it('invalidates only this epoch unlinked query without optimistic deletion', async () => {
    const { user, router, client } = mount(paths[3]); await screen.findByRole('list', { name: 'Выборка непривязанных карт' });
    const key = unlinkedOptions(sessionStore.getCredentials()!.epoch).queryKey;
    await act(() => router.navigate(paths[2]!)); await fillMatch();
    await user.click(screen.getByRole('button', { name: 'Проверить пару' })); await user.click(screen.getByRole('button', { name: 'Подтвердить сопоставление' }));
    await screen.findByRole('heading', { name: 'Ответ сопоставления получен' });
    await waitFor(() => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
    expect(client.getQueryData(key)).toEqual(maps);
    getMaps = async () => json({ maps: [] }); await act(() => router.navigate(paths[3]!));
    await screen.findByText('В выборке нет карт. Это не является проверкой конкретной пары.');
    expect(calls('/api/v1/typist/unlinked')).toHaveLength(2);
  });
});

describe.each(['paper', 'match'] as const)('%s failures and lifecycle', kind => {
  const postCalls = () => kind === 'paper' ? paperCalls() : matchCalls();
  function setPost(fn: () => Promise<Response>) { if (kind === 'paper') postPaper = fn; else postMatch = fn; }
  it.each([400, 403, 404, 409])('handles explicit HTTP %s without false success/logout or raw body', async status => {
    setPost(async () => json({ detail: 'private-html' }, status)); await submit(kind); await screen.findByRole('alert');
    expect(document.body).toHaveTextContent(`(${status})`); expect(document.body).not.toHaveTextContent('private-html');
    expect(sessionStore.getSnapshot().session?.role).toBe('typist'); expect(postCalls()).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: /Ответ .* получен/ })).not.toBeInTheDocument();
  });
  it.each([408, 500, 502, 'network', 'timeout', 'abort', 'malformed', 'wrongStatus', 'invalidJson'])('treats %s as uncertain and keeps input across navigation; retry requires a fresh risk confirmation', async failure => {
    setPost(async () => {
      if (failure === 'network') throw new TypeError('offline');
      if (failure === 'timeout' || failure === 'abort') throw new DOMException('interrupted', failure === 'timeout' ? 'TimeoutError' : 'AbortError');
      if (failure === 'malformed') return json(kind === 'paper' ? { participant_id: 1 } : { ...matched, barcode: 'wrong' }, kind === 'paper' ? 201 : 200);
      if (failure === 'wrongStatus') return json(kind === 'paper' ? paper : matched, kind === 'paper' ? 200 : 201);
      if (failure === 'invalidJson') return new Response('{', { status: kind === 'paper' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
      return json({}, failure as number);
    });
    const { user, router } = await submit(kind); await screen.findByText(/Результат неизвестен/);
    expect(screen.getByRole('button', { name: kind === 'paper' ? 'Проверить анкету' : 'Проверить пару' })).toBeDisabled();
    await act(() => router.navigate(paths[0]!)); await screen.findByRole('heading', { name: 'Рабочее место наборщика' });
    await act(() => router.navigate(kind === 'paper' ? paths[1]! : paths[2]!));
    expect(screen.getByLabelText(kind === 'paper' ? 'Имя' : 'Номер анкеты (form_id)', { exact: true })).toHaveValue(kind === 'paper' ? 'Бумажный' : '000F01');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await act(async () => { fireEvent(window, new Event('online')); fireEvent(window, new Event('focus')); });
    expect(postCalls()).toHaveLength(1);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: kind === 'paper' ? 'Проверить анкету' : 'Проверить пару' }));
    expect(postCalls()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: kind === 'paper' ? 'Подтвердить создание анкеты' : 'Подтвердить сопоставление' }));
    await waitFor(() => expect(postCalls()).toHaveLength(2));
  });
  it('expires only the current session on 401', async () => {
    setPost(async () => json({}, 401)); await submit(kind); await screen.findByRole('heading', { name: 'Вход' });
    expect(sessionStore.getCredentials()).toBeNull(); expect(postCalls()).toHaveLength(1);
  });
  it.each([200, 401])('old response %s cannot expose PII or end B session', async status => {
    let resolve!: (reply: Response) => void; setPost(() => new Promise(done => { resolve = done; }));
    const { client } = await submit(kind);
    await act(async () => { sessionStore.logout(); login('typist', 9); });
    expect(screen.getByLabelText(kind === 'paper' ? 'Имя' : 'Номер анкеты (form_id)', { exact: true })).toHaveValue('');
    await act(async () => { resolve(json(kind === 'paper' ? paper : matched, status === 401 ? 401 : kind === 'paper' ? 201 : 200)); });
    expect(document.body).not.toHaveTextContent('000P01'); expect(document.body).not.toHaveTextContent('Тестов Первый');
    expect(sessionStore.getSnapshot().session?.userId).toBe(9);
    expect(client.getQueryCache().getAll().every(query => query.queryKey[0] !== 'private' || query.queryKey[2] === sessionStore.getCredentials()!.epoch)).toBe(true);
  });
  it('leaving pending aborts locally and preserves an uncertainty marker on return, ignoring late success', async () => {
    let resolve!: (reply: Response) => void; setPost(() => new Promise(done => { resolve = done; }));
    const { router } = await submit(kind);
    const request = postCalls()[0]![0] as Request;
    await act(() => router.navigate(paths[0]!)); expect(request.signal.aborted).toBe(true);
    await act(() => router.navigate(kind === 'paper' ? paths[1]! : paths[2]!));
    await screen.findByText(/Запрос прерван на устройстве/);
    await act(async () => { resolve(json(kind === 'paper' ? paper : matched, kind === 'paper' ? 201 : 200)); });
    expect(screen.queryByRole('heading', { name: /Ответ .* получен/ })).not.toBeInTheDocument();
    expect(postCalls()).toHaveLength(1);
  });
});

describe('unlinked private limited selection', () => {
  it('uses limit=100, private epoch key, string barcode and optional participant ID without claiming a total', async () => {
    const { client } = mount(paths[3]); const list = await screen.findByRole('list', { name: 'Выборка непривязанных карт' });
    expect(list).toHaveTextContent('000001'); expect(list).toHaveTextContent('000002');
    expect(screen.getAllByText(/ID участника в ответе/)).toHaveLength(1);
    const request = calls('/api/v1/typist/unlinked')[0]![0] as Request;
    expect(new URL(request.url).search).toBe('?limit=100'); expect(request.headers.get('Authorization') === 'Bearer synthetic-7').toBe(true);
    const query = client.getQueryCache().getAll().find(query => query.queryKey[3] === 'unlinked')!;
    expect(query.queryKey).toEqual(['private', 'typist', sessionStore.getCredentials()!.epoch, 'unlinked', 100]); expect(query.meta?.private).toBe(true);
    expect(screen.getByText(/сервер не предоставляет общее количество/)).toBeInTheDocument();
  });
  it('shows loading, then empty without claiming all maps are linked', async () => {
    let resolve!: (reply: Response) => void; getMaps = () => new Promise(done => { resolve = done; }); mount(paths[3]);
    await screen.findByText('Загружаем выборку карт…'); await act(async () => { resolve(json({ maps: [] })); });
    await screen.findByText('В выборке нет карт. Это не является проверкой конкретной пары.');
  });
  it.each([403, 500, 'malformed', 'network'])('does not disguise GET %s as empty and retries manually', async failure => {
    getMaps = async () => { if (failure === 'network') throw new TypeError('offline'); return failure === 'malformed' ? json({ maps: [{ id: 1, barcode: 123 }] }) : json({}, failure as number); };
    const { user } = mount(paths[3]); await screen.findByRole('alert');
    expect(screen.queryByText('В выборке нет карт. Это не является проверкой конкретной пары.')).not.toBeInTheDocument();
    expect(sessionStore.getSnapshot().session?.role).toBe('typist'); getMaps = async () => json({ maps });
    await user.click(screen.getByRole('button', { name: 'Повторить загрузку' })); await screen.findByRole('list', { name: 'Выборка непривязанных карт' });
    expect(calls('/api/v1/typist/unlinked')).toHaveLength(2);
  });
  it('shows exactly 100 returned records as a selection, not a complete catalog', async () => {
    getMaps = async () => json({ maps: Array.from({ length: 100 }, (_, index) => ({ id: index, barcode: String(index).padStart(6, '0') })) });
    mount(paths[3]); const list = await screen.findByRole('list', { name: 'Выборка непривязанных карт' });
    expect(list.children).toHaveLength(100); expect(screen.getByText('Получено в выборке: 100.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Следующая страница/ })).not.toBeInTheDocument();
  });
  it('a delayed GET from A cannot repopulate B cache or show old barcodes', async () => {
    let resolve!: (reply: Response) => void; getMaps = () => new Promise(done => { resolve = done; });
    const { client } = mount(paths[3]); await waitFor(() => expect(calls('/api/v1/typist/unlinked')).toHaveLength(1));
    getMaps = async () => json({ maps: [{ id: 9, barcode: 'B-only' }] }); await act(async () => { login('typist', 9); });
    await screen.findByText('B-only'); await act(async () => { resolve(json({ maps })); });
    expect(screen.queryByText('000001')).not.toBeInTheDocument(); expect(client.getQueryData(unlinkedOptions(sessionStore.getCredentials()!.epoch).queryKey)).toEqual([{ id: 9, barcode: 'B-only' }]);
  });
  it('removes an already displayed A selection immediately while B is still loading', async () => {
    let resolveA!: (reply: Response) => void, resolveB!: (reply: Response) => void;
    const { user, client } = mount(paths[3]); await screen.findByText('000001');
    getMaps = () => new Promise(done => { resolveA = done; });
    await user.click(screen.getByRole('button', { name: 'Обновить выборку' }));
    await waitFor(() => expect(calls('/api/v1/typist/unlinked')).toHaveLength(2));
    getMaps = () => new Promise(done => { resolveB = done; });
    await act(async () => { login('typist', 9); });
    expect(screen.queryByText('000001')).not.toBeInTheDocument();
    await act(async () => { resolveB(json({ maps: [{ id: 9, barcode: 'B-only' }] })); resolveA(json({ maps })); });
    await screen.findByText('B-only'); expect(client.getQueryData(unlinkedOptions(sessionStore.getCredentials()!.epoch).queryKey)).toEqual([{ id: 9, barcode: 'B-only' }]);
  });
  it('an actual protected unlinked 401 clears the session and returns to login', async () => {
    getMaps = async () => json({}, 401); mount(paths[3]); await screen.findByRole('heading', { name: 'Вход' });
    expect(sessionStore.getCredentials()).toBeNull(); expect(calls('/api/v1/typist/unlinked')).toHaveLength(1);
  });
});

describe('POST response completeness', () => {
  it.each(['status', 'barcode', 'participant_id', 'participant_name', 'message'])('match missing %s is uncertain, never a confirmed result', async field => {
    const partial: Record<string, unknown> = { ...matched }; delete partial[field]; postMatch = async () => json(partial);
    await expect(matchMap({ form_id: '000F01', barcode: '000001' }, sessionStore.getCredentials()!.epoch, new AbortController().signal)).rejects.toMatchObject({ uncertain: true });
    expect(matchCalls()).toHaveLength(1);
  });
  it.each(['participant_id', 'form_id', 'payment_status'])('paper missing %s is uncertain, never a confirmed result', async field => {
    const partial: Record<string, unknown> = { ...paper }; delete partial[field]; postPaper = async () => json(partial, 201);
    await expect(createPaper({ route_id: 15, surname: 'Тестов', name: 'Бумажный', date_of_birth: '1995-05-20', gender: 'male', email: 'paper@example.test', phone_number: '123' }, sessionStore.getCredentials()!.epoch, new AbortController().signal)).rejects.toMatchObject({ uncertain: true });
    expect(paperCalls()).toHaveLength(1);
  });
});
