import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/router';
import { sessionStore } from '../../shared/session/store';
import { safeReturnTo } from '../auth/redirect';
import { registerParticipants } from './api';
import { emptyRow, indexedErrors, validDate, validateRows } from './model';

const routes = [
  { id: 12, name: 'Тестовая лесная тропа', distance: 12, year: 2026, is_active: true },
  { id: 15, name: 'Тестовый городской маршрут', distance: 18, year: 2025, is_active: true },
  { id: 17, name: 'Неактивный тестовый', distance: 33, year: 2024, is_active: false },
];
const participants = [
  { id: 101, form_id: '00123', surname: 'Тестов', name: 'Первый', route_name: routes[0]!.name, payment_status: 'pending', has_started: false, has_finished: false, map_barcode: null },
  { id: 102, form_id: '00456', surname: 'Тестова', name: 'Вторая', route_name: routes[1]!.name, payment_status: 'review', has_started: true, has_finished: false, map_barcode: '000314' },
];
const registration = { registration_id: 900, participants: participants.map(({ id, form_id, surname, name, payment_status }) => ({ id, form_id, surname, name, payment_status })) };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const transport = vi.fn<typeof fetch>();
let getMine: () => Promise<Response>;
let getRoutes: () => Promise<Response>;
let post: (request: Request) => Promise<Response>;
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
function login(user = 7) { sessionStore.login({ access_token: `test-only-${user}`, user_id: user, role: 'participant' }, sessionStore.beginAuthentication()); }

beforeEach(() => {
  sessionStore.logout(); login(); transport.mockReset();
  getMine = async () => json({ participants });
  getRoutes = async () => json({ routes });
  post = async () => json(registration, 201);
  transport.mockImplementation(async input => {
    const request = input as Request;
    switch (new URL(request.url).pathname) {
      case '/api/v1/routes': return getRoutes();
      case '/api/v1/participants/my': return getMine();
      case '/api/v1/participants/register': return post(request);
      case '/api/v1/auth/login': return json({ access_token: 'test-login', user_id: 7, role: 'participant' });
      default: throw new Error('Unexpected test endpoint');
    }
  });
  vi.stubGlobal('fetch', transport);
});
afterEach(() => { cleanup(); sessionStore.logout(); clients.splice(0).forEach(client => client.clear()); routers.splice(0).forEach(router => router.dispose()); });

function calls(path: string) { return transport.mock.calls.filter(([input]) => new URL((input as Request).url).pathname === path); }
const postCalls = () => calls('/api/v1/participants/register');
function mount(path = '/account') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  clients.push(client); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router, user: userEvent.setup() };
}
async function form() {
  const mounted = mount('/account/participants/new');
  await screen.findByRole('option', { name: /Тестовая лесная тропа · 2026 · 12 км/ });
  return mounted;
}
function fill(index = 1, route = '12', name = 'Первый') {
  const row = within(screen.getByRole('group', { name: `Участник ${index}` }));
  const data = { surname: 'Тестов', name, middle_name: '', date_of_birth: '1995-05-20', email: 'family@example.test', phone_number: 'местный 123, доб. 2' };
  for (const [label, value] of [['Фамилия', data.surname], ['Имя', data.name], ['Дата рождения', data.date_of_birth], ['Email', data.email], ['Телефон', data.phone_number]]) fireEvent.change(row.getByLabelText(label!, { exact: true }), { target: { value } });
  fireEvent.change(row.getByLabelText('Пол'), { target: { value: index === 1 ? 'male' : 'female' } });
  fireEvent.change(row.getByLabelText('Маршрут'), { target: { value: route } });
  return row;
}

describe('private account and own participant details', () => {
  it('loads the exact unfiltered Bearer URL and displays only server fields/statuses', async () => {
    const { client } = mount();
    const list = await screen.findByRole('list', { name: 'Мои участники' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('00123'); expect(list).toHaveTextContent('000314');
    expect(list).toHaveTextContent('Неизвестный статус: review');
    expect(list).not.toHaveTextContent('Оплачено');
    const request = calls('/api/v1/participants/my')[0]![0] as Request;
    expect(new URL(request.url).search).toBe('');
    expect(request.headers.get('Authorization')).toBe('Bearer test-only-7');
    const query = client.getQueryCache().getAll().find(item => item.queryKey[0] === 'private')!;
    expect(query.meta?.private).toBe(true);
    expect(query.queryKey).toEqual(['private', 'participants', sessionStore.getCredentials()!.epoch]);
    expect(screen.queryByRole('button', { name: /Оплатить|PDF/ })).not.toBeInTheDocument();
  });
  it('shows genuine loading and empty state, then manually refreshes', async () => {
    let resolve!: (response: Response) => void;
    getMine = () => new Promise(done => { resolve = done; });
    const { user } = mount();
    expect(await screen.findByText('Загружаем ваших участников…')).toHaveAttribute('role', 'status');
    await act(async () => { resolve(json({ participants: [] })); });
    expect(await screen.findByRole('heading', { name: 'Вы пока не зарегистрировали участников' })).toBeInTheDocument();
    getMine = async () => json({ participants });
    await user.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(await screen.findByRole('list', { name: 'Мои участники' })).toBeInTheDocument();
    expect(calls('/api/v1/participants/my')).toHaveLength(2);
  });
  it.each([403, 500, 'network'])('handles GET %s, does not turn it into an empty list or logout, and retries manually', async failure => {
    getMine = async () => { if (failure === 'network') throw new TypeError('offline'); return json({}, failure as number); };
    const { user } = mount();
    const error = await screen.findByRole('alert');
    if (failure === 403) expect(error).toHaveTextContent('Нет доступа');
    expect(error).not.toHaveTextContent('маршрутов');
    expect(screen.queryByText('Вы пока не зарегистрировали участников')).not.toBeInTheDocument();
    expect(sessionStore.getSnapshot().session?.userId).toBe(7);
    getMine = async () => json({ participants });
    await user.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    expect(await screen.findByText('Тестов Первый')).toBeInTheDocument();
    expect(calls('/api/v1/participants/my')).toHaveLength(2);
  });
  it('a 401 expires the current session and redirects to login', async () => {
    getMine = async () => json({}, 401);
    mount();
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
    expect(sessionStore.getCredentials()).toBeNull();
    expect(screen.queryByText('Тестов Первый')).not.toBeInTheDocument();
  });
  it('rejects malformed GET data without showing false emptiness', async () => {
    getMine = async () => json({ participants: null }); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('некорректный список');
  });
  it('ignores the deferred response of account A after switching to B and preserves public cache', async () => {
    let resolveOld!: (response: Response) => void;
    const oldEpoch = sessionStore.getCredentials()!.epoch;
    const { client, router, user } = mount();
    await screen.findByText('Тестов Первый');
    client.setQueryData(['routes'], routes);
    getMine = () => new Promise(done => { resolveOld = done; });
    await user.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(calls('/api/v1/participants/my')).toHaveLength(2));
    let resolveNew!: (response: Response) => void;
    getMine = () => new Promise(done => { resolveNew = done; });
    await act(async () => { sessionStore.logout(); login(8); await router.navigate('/account'); });
    await screen.findByText('Загружаем ваших участников…');
    expect(screen.queryByText('Тестов Первый')).not.toBeInTheDocument();
    await act(async () => { resolveNew(json({ participants: [{ ...participants[1], id: 202, surname: 'Тестовый', name: 'Другой' }] })); });
    expect(await screen.findByText('Тестовый Другой')).toBeInTheDocument();
    await act(async () => { resolveOld(json({ participants })); });
    expect(screen.queryByText('Тестов Первый')).not.toBeInTheDocument();
    expect(client.getQueryCache().findAll({ queryKey: ['private', 'participants', oldEpoch] })).toHaveLength(0);
    expect(client.getQueryData(['routes'])).toEqual(routes);
  });
  it('loads direct detail only from my-list and preserves separate string identifiers', async () => {
    mount('/account/participants/102');
    expect(await screen.findByRole('heading', { name: 'Тестова Вторая' })).toBeInTheDocument();
    expect(screen.getByText('000314')).toBeInTheDocument(); expect(screen.getByText('00456')).toBeInTheDocument();
    expect(transport.mock.calls.every(([input]) => new URL((input as Request).url).pathname === '/api/v1/participants/my')).toBe(true);
  });
  it.each(['999', 'invalid', '999999999999999999999999'])('does not expose another record for detail ID %s', async id => {
    mount(`/account/participants/${id}`);
    expect(await screen.findByRole('heading', { name: id === '999' ? 'Участник не найден среди ваших записей' : 'Некорректный номер участника' })).toBeInTheDocument();
    expect(screen.queryByText('Тестов Первый')).not.toBeInTheDocument();
  });
  it('waits for a fresh detail GET before declaring an ID absent from the cached list', async () => {
    const { router } = mount();
    await screen.findByRole('list', { name: 'Мои участники' });
    let resolve!: (response: Response) => void;
    getMine = () => new Promise(done => { resolve = done; });
    await act(() => router.navigate('/account/participants/999'));
    await screen.findByText('Загружаем участника…');
    expect(screen.queryByText('Участник не найден среди ваших записей')).not.toBeInTheDocument();
    await act(async () => { resolve(json({ participants: [{ ...participants[0], id: 999, name: 'Новый' }] })); });
    expect(await screen.findByRole('heading', { name: 'Тестов Новый' })).toBeInTheDocument();
  });
});

describe('multi-participant registration', () => {
  it('starts with one row, preserves stable rows when removing the middle and never calls DELETE', async () => {
    const { user } = await form();
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Убрать участника 1' })).toBeDisabled();
    fill(1);
    await user.click(screen.getByRole('button', { name: 'Добавить ещё участника' })); fill(2, '15', 'Средний');
    await user.click(screen.getByRole('button', { name: 'Добавить ещё участника' })); fill(3, '12', 'Третий');
    const lastId = within(screen.getByRole('group', { name: 'Участник 3' })).getByLabelText('Имя', { exact: true }).id;
    await user.click(screen.getByRole('button', { name: 'Убрать участника 2' }));
    expect(within(screen.getByRole('group', { name: 'Участник 2' })).getByLabelText('Имя', { exact: true })).toHaveValue('Третий');
    expect(within(screen.getByRole('group', { name: 'Участник 2' })).getByLabelText('Имя', { exact: true }).id).toBe(lastId);
    expect(transport.mock.calls.some(([input]) => (input as Request).method === 'DELETE')).toBe(false);
    expect(postCalls()).toHaveLength(0);
  });
  it('sends one exact DTO with two distinct numeric routes, blocks duplicate submit and refreshes GET after 201', async () => {
    let resolve!: (response: Response) => void;
    let body: unknown;
    post = async request => { body = await request.json(); return new Promise(done => { resolve = done; }); };
    const { user } = await form(); fill(1);
    await user.click(screen.getByRole('button', { name: 'Добавить ещё участника' })); fill(2, '15', 'Вторая');
    await user.dblClick(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    expect(postCalls()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Убрать участника 2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Добавить ещё участника' })).toBeDisabled();
    await waitFor(() => expect(body).toBeDefined());
    const records = (body as { participants: Record<string, unknown>[] }).participants;
    expect(records.map(item => item.route_id)).toEqual([12, 15]);
    expect(records.every(item => typeof item.route_id === 'number')).toBe(true);
    expect(Object.keys(records[0]!).sort()).toEqual(['date_of_birth', 'email', 'gender', 'middle_name', 'name', 'phone_number', 'route_id', 'surname']);
    expect(records.map(item => item.gender)).toEqual(['male', 'female']);
    expect(records[0]!.middle_name).toBeNull();
    expect(records[0]!.phone_number).toBe('местный 123, доб. 2');
    expect(records[0]!.email).toBe(records[1]!.email);
    expect((postCalls()[0]![0] as Request).headers.get('Authorization')).toBe('Bearer test-only-7');
    await act(async () => { resolve(json(registration, 201)); });
    expect(await screen.findByRole('heading', { name: 'Регистрация подтверждена' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Номер операции: 900' })).toBeInTheDocument();
    expect(screen.getByText('Номер анкеты: 00123')).toBeInTheDocument(); expect(screen.getByText('Номер анкеты: 00456')).toBeInTheDocument();
    await screen.findByText('Список участников обновлён по данным сервера.');
    expect(calls('/api/v1/participants/my')).toHaveLength(1);
  });
  it('keeps the 201 confirmation when the following GET fails; retry only reloads the list', async () => {
    post = async () => json({ ...registration, participants: registration.participants.slice(0, 1) }, 201);
    getMine = async () => json({}, 500);
    const { user } = await form(); fill();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Создание подтверждено сервером');
    expect(screen.getByRole('heading', { name: 'Регистрация подтверждена' })).toBeInTheDocument();
    getMine = async () => json({ participants });
    await user.click(screen.getByRole('button', { name: 'Повторить загрузку списка' }));
    await screen.findByText('Список участников обновлён по данным сервера.');
    expect(postCalls()).toHaveLength(1);
  });
  it('replaces an in-flight pre-POST review GET with a new post-201 GET and ignores its delayed result', async () => {
    post = async () => { throw new TypeError('lost response'); };
    const { user, client } = await form(); fill();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    await screen.findByText('Результат предыдущей отправки неизвестен.');
    let resolveOld!: (response: Response) => void;
    getMine = () => new Promise(done => { resolveOld = done; });
    await user.click(screen.getByRole('button', { name: 'Проверить в личном кабинете' }));
    await waitFor(() => expect(calls('/api/v1/participants/my')).toHaveLength(1));
    getMine = async () => json({ participants });
    post = async () => json(registration, 201);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Повторить отправку с риском дублирования' }));
    await screen.findByText('Список участников обновлён по данным сервера.');
    expect(calls('/api/v1/participants/my')).toHaveLength(2);
    await act(async () => { resolveOld(json({ participants: [] })); });
    expect(client.getQueryData(['private', 'participants', sessionStore.getCredentials()!.epoch])).toEqual(participants);
  });
  it('maps indexed 422 to the second row and keeps both rows without echoing unsafe details', async () => {
    post = async () => json({ detail: [{ loc: ['body', 'participants', 1, 'email'], msg: '<private-trace>', input: 'secret-test-value', type: 'value_error' }, { loc: ['body', 'participants'], msg: 'array error' }, { loc: ['unknown', 999], msg: 'unknown error' }] }, 422);
    const { user } = await form(); fill(1);
    await user.click(screen.getByRole('button', { name: 'Добавить ещё участника' })); const second = fill(2, '15', 'Вторая');
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('422');
    expect(second.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(within(screen.getByRole('group', { name: 'Участник 1' })).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'false');
    expect(second.getByLabelText('Имя', { exact: true })).toHaveValue('Вторая');
    expect(screen.queryByText(/Результат предыдущей отправки неизвестен/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('private-trace'); expect(document.body).not.toHaveTextContent('secret-test-value');
  });
  it('preserves a 422 error with its stable key when the middle row is removed', async () => {
    post = async () => json({ detail: [{ loc: ['body', 'participants', 2, 'email'] }] }, 422);
    const { user } = await form(); fill();
    await user.click(screen.getByRole('button', { name: 'Добавить ещё участника' })); fill(2, '15', 'Средний');
    await user.click(screen.getByRole('button', { name: 'Добавить ещё участника' })); fill(3, '12', 'Третий');
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' })); await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Убрать участника 2' }));
    const second = within(screen.getByRole('group', { name: 'Участник 2' }));
    expect(second.getByLabelText('Имя', { exact: true })).toHaveValue('Третий');
    expect(second.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });
  it('validates required fields without a POST', async () => {
    const { user } = await form();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте поля');
    expect(screen.getByLabelText('Фамилия')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Дата рождения')).toHaveAttribute('aria-invalid', 'true');
    expect(postCalls()).toHaveLength(0);
  });
  it('never offers inactive routes; a selected route that disappears blocks POST without losing personal fields', async () => {
    const { user } = await form(); fill();
    expect(screen.queryByRole('option', { name: /Неактивный тестовый/ })).not.toBeInTheDocument();
    getRoutes = async () => json({ routes: [routes[1]] });
    await user.click(screen.getByRole('button', { name: 'Обновить маршруты' }));
    await screen.findByText('Выбранный маршрут недоступен. Выберите другой.');
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    expect(screen.getByLabelText('Имя', { exact: true })).toHaveValue('Первый');
    expect(postCalls()).toHaveLength(0);
  });
  it.each(['empty', 'failure'])('blocks registration with routes %s but keeps the editable personal fields', async state => {
    getRoutes = async () => state === 'empty' ? json({ routes: [] }) : json({}, 500);
    mount('/account/participants/new');
    await screen.findByText(state === 'empty' ? 'Доступных маршрутов пока нет. Регистрацию отправить нельзя.' : /Не удалось загрузить маршруты/);
    expect(screen.getByRole('button', { name: 'Зарегистрировать участников' })).toBeDisabled();
    expect(screen.getByLabelText('Фамилия')).not.toBeDisabled();
    expect(postCalls()).toHaveLength(0);
  });
  it.each(['network', 'timeout', 408, 500, 502, 'malformed', 'wrongStatus'])('treats POST %s as unknown, preserves the form and requires an explicit duplicate warning before retry', async failure => {
    post = async () => {
      if (failure === 'network') throw new TypeError('lost response');
      if (failure === 'timeout') throw new DOMException('timed out', 'TimeoutError');
      if (failure === 'wrongStatus') return json(registration, 200);
      return failure === 'malformed' ? json({}, 201) : json({}, failure as number);
    };
    getMine = async () => json({}, 500);
    const { user } = await form(); fill();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    await screen.findByText('Не удалось получить подтверждение. Участники могли быть зарегистрированы.');
    expect(screen.queryByRole('heading', { name: 'Регистрация подтверждена' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Имя', { exact: true })).toHaveValue('Первый');
    expect(screen.getByLabelText('Фамилия')).toHaveValue('Тестов');
    expect(screen.getByLabelText('Дата рождения')).toHaveValue('1995-05-20');
    expect(screen.getByLabelText('Email')).toHaveValue('family@example.test');
    expect(screen.getByLabelText('Телефон')).toHaveValue('местный 123, доб. 2');
    expect(screen.getByLabelText('Пол')).toHaveValue('male');
    expect(screen.getByLabelText('Маршрут')).toHaveValue('12');
    const repeat = screen.getByRole('button', { name: 'Повторить отправку с риском дублирования' });
    expect(repeat).toBeDisabled(); expect(postCalls()).toHaveLength(1);
    await user.click(repeat);
    expect(postCalls()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Проверить в личном кабинете' }));
    await screen.findByText('Участники пока недоступны');
    expect(screen.getByText('Результат предыдущей отправки неизвестен.')).toBeInTheDocument();
    getMine = async () => json({ participants: [] });
    await user.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    await screen.findByText('Список сейчас пуст. Это не доказывает, что предыдущая отправка не сохранилась.');
    expect(repeat).toBeDisabled(); expect(postCalls()).toHaveLength(1);
    await user.click(screen.getByRole('checkbox'));
    await user.click(repeat);
    await waitFor(() => expect(postCalls()).toHaveLength(2));
  });
  it.each([403, 409])('keeps explicit POST %s rejection distinct from an uncertain outcome', async status => {
    post = async () => json({}, status);
    const { user } = await form(); fill();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`(${status})`);
    expect(screen.queryByText('Результат предыдущей отправки неизвестен.')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Зарегистрировать участников' })).toBeEnabled();
    expect(screen.getByLabelText('Маршрут')).toHaveValue('12');
    expect(sessionStore.getSnapshot().session?.userId).toBe(7);
    expect(postCalls()).toHaveLength(1);
  });
  it('expires the current session on POST 401 without offering a retry', async () => {
    post = async () => json({}, 401);
    const { user } = await form(); fill();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
    expect(sessionStore.getCredentials()).toBeNull();
    expect(screen.queryByRole('button', { name: /Повторить отправку/ })).not.toBeInTheDocument();
    expect(postCalls()).toHaveLength(1);
  });
  it.each([0, 1, 3])('prominently warns when 201 returns %s records for two submitted participants', async count => {
    const returned = [...registration.participants, { ...registration.participants[0]!, id: 103, form_id: '00789', name: 'Третий' }].slice(0, count);
    post = async () => json({ ...registration, participants: returned }, 201);
    const { user } = await form(); fill();
    await user.click(screen.getByRole('button', { name: 'Добавить ещё участника' })); fill(2, '15', 'Вторая');
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    expect(await screen.findByRole('heading', { name: 'Регистрация требует проверки' })).toBeInTheDocument();
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent(`Отправлено участников: 2. В подтверждении сервера: ${count}.`);
    expect(warning).toHaveTextContent('Регистрация всего отправленного списка не подтверждена.');
    expect(warning).toHaveTextContent('Не отправляйте форму повторно');
    expect(screen.queryByRole('heading', { name: 'Регистрация подтверждена' })).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Созданные участники' });
    expect(within(list).queryAllByRole('listitem')).toHaveLength(count);
    expect(within(list).queryAllByRole('link')).toHaveLength(count);
    for (const record of returned) {
      expect(within(list).getByText(`ID участника: ${record.id}`)).toBeInTheDocument();
      expect(within(list).getByText(`Номер анкеты: ${record.form_id}`)).toBeInTheDocument();
    }
    await screen.findByText('Список участников обновлён по данным сервера.');
    expect(calls('/api/v1/participants/my')).toHaveLength(1);
    expect(postCalls()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Зарегистрировать|Повторить отправку/ })).not.toBeInTheDocument();
  });
  it('clears form PII immediately when an authenticated account is replaced', async () => {
    await form(); fill();
    await act(async () => { login(9); });
    expect(screen.getByLabelText('Имя', { exact: true })).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });
  it('an old registration response cannot show confirmation or restore form data after an account switch', async () => {
    let resolveOld!: (response: Response) => void;
    post = () => new Promise(done => { resolveOld = done; });
    const { user } = await form(); fill();
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать участников' }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    await act(async () => { sessionStore.logout(); login(9); });
    await act(async () => { resolveOld(json(registration, 201)); });
    expect(screen.queryByRole('heading', { name: 'Регистрация подтверждена' })).not.toBeInTheDocument();
    expect(sessionStore.getSnapshot().session?.userId).toBe(9);
    expect(document.body).not.toHaveTextContent('00123');
  });
});

describe('login return and model boundaries', () => {
  it.each(['/account/participants/new', '/account/participants/101'])('a guest at %s sends no private GET and returns after login', async path => {
    sessionStore.logout(); const { user, router } = mount(path);
    await screen.findByRole('heading', { name: 'Вход' });
    expect(calls('/api/v1/participants/my')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Имя пользователя'), { target: { value: 'test-only' } });
    fireEvent.change(screen.getByLabelText('Пароль', { exact: true }), { target: { value: 'example-pass' } });
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
  });
  it.each(['https://evil.example', '//evil.example', '/account/participants/../staff', '/account/participants/abc', '/account/participants/1/pay', '/account/participants/101%5c', '/account/participants/new?x=%0a', '/account/participants/new?x=%250d', '/account/participants/new?x=%25250a'])('rejects dangerous return %s', value => { expect(safeReturnTo(value)).toBe('/account'); });
  it('preserves numeric internal participant return URLs and benign query/hash', () => { expect(safeReturnTo('/account/participants/101?section=first%20part#details')).toBe('/account/participants/101?section=first%20part#details'); });
  it.each([['2000-02-29', true], ['1900-02-29', false], ['2025-04-31', false], ['0100-01-01', true], ['2500-01-01', true], ['2025-2-01', false]])('validates calendar %s without age assumptions', (value, valid) => { expect(validDate(value as string)).toBe(valid); });
  it('maps unknown 422 paths without crashing or exposing raw values', () => { expect(indexedErrors({ detail: [{ loc: ['body', 'participants', 999, 'email'], msg: 'raw secret' }, { loc: [] }] }, ['one'])).toEqual({}); });
  it('empty rows validate; an empty list can never be sent to the API', async () => {
    expect(validateRows([emptyRow('one')], routes).one?.surname).toBeDefined();
    await expect(registerParticipants([], sessionStore.getCredentials()!.epoch, new AbortController().signal)).rejects.toThrow('Добавьте хотя бы одного участника');
    expect(postCalls()).toHaveLength(0);
  });
});
