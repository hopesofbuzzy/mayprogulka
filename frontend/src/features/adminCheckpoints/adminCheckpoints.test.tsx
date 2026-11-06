import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/router';
import { sessionStore } from '../../shared/session/store';
import { safeReturnTo } from '../auth/redirect';
import type { Checkpoint } from '../routes/model';
import { mutateCheckpoint } from './api';
import { createBody, emptyFields, pointFields, updateBody, validate } from './model';

const route = { id: 71, year: 2025, name: 'Тестовый маршрут', distance: 12, is_active: true };
const point: Checkpoint = { id: 201, route_id: 71, name: 'Исходный КП', address: 'Адрес из API', coordinates: '  opaque; 0000  ', order: 0, is_start: true, is_finish: true };
const other = { ...point, id: 203, name: 'Другой КП' };
const created = { ...point, id: 205, name: '  Новый КП  ', order: 5, is_start: false, is_finish: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const transport = vi.fn<typeof fetch>();
const clients: QueryClient[] = [], routers: ReturnType<typeof createMemoryRouter>[] = [];
let points: Checkpoint[], getRoutes: () => Promise<Response>, getPoints: (request: Request) => Promise<Response>, mutate: (request: Request) => Promise<Response>;
const login = (role = 'admin', user = 7) => sessionStore.login({ access_token: `synthetic-${user}`, user_id: user, role }, sessionStore.beginAuthentication());
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
beforeEach(() => {
  sessionStore.logout(); login(); transport.mockReset(); points = [structuredClone(other), structuredClone(point)];
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  getRoutes = async () => json({ routes: [route, { ...route, id: 92, name: 'Маршрут Б' }] });
  getPoints = async request => json({ checkpoints: new URL(request.url).searchParams.get('route_id') === '92' ? [{ ...point, id: 300, route_id: 92, name: 'КП маршрута Б' }] : points });
  mutate = async request => {
    if (request.method === 'POST') { points.push(created); return json(created, 201); }
    if (request.method === 'PUT') { const body = await request.clone().json(); points = points.map(item => item.id === 201 ? { ...item, ...body } : item); return json(points.find(item => item.id === 201)); }
    points = points.filter(item => item.id !== 201); return new Response(null, { status: 204 });
  };
  transport.mockImplementation(async input => {
    const request = input as Request, url = new URL(request.url);
    expect(request.credentials).toBe('omit');
    if (request.method === 'GET') {
      expect(request.headers.has('Authorization')).toBe(false);
      if (url.pathname === '/api/v1/routes') { expect(url.search).toBe(''); return getRoutes(); }
      expect(url.pathname).toBe('/api/v1/checkpoints'); expect(['?route_id=71', '?route_id=92']).toContain(url.search); return getPoints(request);
    }
    if (url.pathname === '/api/v1/auth/login') return json({ access_token: 'synthetic-7', user_id: 7, role: 'admin' });
    expect(['/api/v1/admin/checkpoints', '/api/v1/admin/checkpoints/201']).toContain(url.pathname);
    expect(request.headers.get('Authorization')).toBe(`Bearer synthetic-${sessionStore.getSnapshot().session?.userId}`);
    return mutate(request);
  });
  vi.stubGlobal('fetch', transport);
});
afterEach(() => { cleanup(); sessionStore.logout(); clients.splice(0).forEach(client => client.clear()); routers.splice(0).forEach(router => router.dispose()); if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); });
function mount(path = '/staff/routes/71/checkpoints') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); const router = createMemoryRouter(appRoutes, { initialEntries: [path] }); clients.push(client); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); return { client, router, user: userEvent.setup() };
}
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const calls = (method: string) => transport.mock.calls.map(call => call[0] as Request).filter(request => request.method === method && new URL(request.url).pathname.startsWith('/api/v1/admin/checkpoints'));
const cpReads = () => transport.mock.calls.filter(([input]) => new URL((input as Request).url).pathname === '/api/v1/checkpoints');
async function start(kind: 'create' | 'edit' | 'delete', user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('list', { name: 'КП выбранного маршрута' });
  await user.click(screen.getByRole('button', { name: kind === 'create' ? 'Создать один КП' : kind === 'edit' ? /Изменить КП.*Исходный КП/ : /Удалить КП.*Исходный КП/ }));
  await screen.findByRole('dialog');
  if (kind === 'create') { change('Название КП', '  Новый КП  '); change('Адрес', '  Адрес;000  '); change('Координаты', '  56.8300, 060.6000  '); change('Порядок прохождения', '0005'); }
  if (kind === 'edit') change('Название КП', 'Изменённый КП');
  if (kind === 'delete') change('Введите ID КП 201', '201');
  else { await user.click(screen.getByRole('button', { name: 'Проверить данные КП' })); await screen.findByRole('region', { name: 'Проверка КП' }); }
}
const confirm = (kind: 'create' | 'edit' | 'delete') => screen.getByRole('button', { name: kind === 'create' ? 'Подтвердить создание КП' : kind === 'edit' ? 'Подтвердить изменения КП' : 'Подтвердить удаление КП' });

describe('checkpoint identity and access', () => {
  it.each(['participant', 'typist', 'organizer', 'unknown', 'Admin'])('denies role %s without HTTP', async role => {
    login(role); mount(); await screen.findByRole('heading', { name: 'Нет доступа' }); expect(transport).not.toHaveBeenCalled();
    await expect(mutateCheckpoint('delete', {}, 71, 201, sessionStore.getCredentials()!.epoch, new AbortController().signal)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  });
  it('guest returns to exact checkpoint path after login', async () => {
    sessionStore.logout(); const { user, router } = mount(); await screen.findByRole('heading', { name: 'Вход' }); expect(router.state.location.state).toMatchObject({ returnTo: '/staff/routes/71/checkpoints' });
    change('Имя пользователя', 'synthetic'); change('Пароль', 'synthetic-password'); await user.click(screen.getByRole('button', { name: 'Войти' })); await screen.findByRole('heading', { name: 'КП маршрута' });
  });
  it.each(['abc', '071', '-1', '1.2', '1e2', '9007199254740992', '%37%31', '71%0A'])('invalid canonical ID %s has no API reads', async id => {
    mount(`/staff/routes/${id}/checkpoints`); await screen.findByRole('heading', { name: 'Некорректный номер маршрута' }); expect(transport).not.toHaveBeenCalled();
  });
  it.each(['/staff/routes/071/checkpoints', '/staff/routes/71/checkpoints?x=1', '/staff/routes/71/checkpoints#x', '/x/../staff/routes/71/checkpoints', '/staff/routes/%37%31/checkpoints', '/staff%2Froutes/71/checkpoints', '/staff/routes/71/checkpoints/', '//staff/routes/71/checkpoints', '/staff/routes/71/other', '/staff/routes/71\\checkpoints', '/staff/routes/9007199254740992/checkpoints'])('rejects unsafe checkpoint returnTo %s', value => expect(safeReturnTo(value)).toBe('/account'));
  it('accepts only exact supported checkpoint returnTo', () => expect(safeReturnTo('/staff/routes/71/checkpoints')).toBe('/staff/routes/71/checkpoints'));
  it('absent route is not physical absence and never triggers checkpoints', async () => {
    getRoutes = async () => json({ routes: [] }); mount(); await screen.findByRole('heading', { name: 'Маршрут недоступен в публичном каталоге' }); expect(cpReads()).toHaveLength(0);
  });
  it('routes error retries only routes, then loads matching points', async () => {
    getRoutes = async () => json({}, 500); const { user } = mount(); await screen.findByRole('alert'); expect(cpReads()).toHaveLength(0);
    getRoutes = async () => json({ routes: [route] }); await user.click(screen.getByRole('button', { name: 'Повторить загрузку маршрутов' })); await screen.findByRole('list', { name: 'КП выбранного маршрута' });
  });
});

describe('public checkpoint read contract', () => {
  it('stable equal orders retain actual zero, flags and opaque coordinates without geometry', async () => {
    const { client } = mount(); const list = await screen.findByRole('list', { name: 'КП выбранного маршрута' }); const cards = within(list).getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent(other.name); expect(cards[1]).toHaveTextContent(point.name); expect(cards[0]).toHaveTextContent('порядок 0');
    expect(client.getQueryData(['checkpoints', 71])).toEqual(points); expect(document.querySelector('iframe, img, canvas')).toBeNull();
    expect(cards[1]).toHaveTextContent('opaque; 0000'); expect(cards[1]).toHaveTextContent('Начальный КП'); expect(cards[1]).toHaveTextContent('Конечный КП');
  });
  it('loading then empty never invents a point', async () => {
    let release!: (response: Response) => void; getPoints = () => new Promise(resolve => { release = resolve; }); mount(); await screen.findByText('Загружаем КП маршрута…');
    await act(async () => release(json({ checkpoints: [] }))); await screen.findByText('В публичном списке этого маршрута КП пока нет.');
  });
  it.each(['422', '500', 'network', 'timeout', 'bad-json', 'foreign', 'bad-dto'])('read %s remains a separate error and manual GET only', async mode => {
    getPoints = async () => {
      if (mode === 'network' || mode === 'timeout') throw mode === 'network' ? new TypeError('offline') : new DOMException('timeout', 'TimeoutError');
      return mode === 'bad-json' ? new Response('{', { headers: { 'Content-Type': 'application/json' } }) : mode === 'foreign' ? json({ checkpoints: [{ ...point, route_id: 92 }] }) : mode === 'bad-dto' ? json({ checkpoints: [{}] }) : json({}, Number(mode));
    };
    const { user } = mount(); await screen.findByRole('alert'); expect(screen.getByRole('heading', { name: 'КП маршрута' })).toBeInTheDocument();
    getPoints = async () => json({ checkpoints: points }); await user.click(screen.getByRole('button', { name: 'Повторить загрузку КП' })); await screen.findByRole('list', { name: 'КП выбранного маршрута' });
    expect(cpReads()).toHaveLength(2); expect(transport.mock.calls.filter(([input]) => new URL((input as Request).url).pathname === '/api/v1/routes')).toHaveLength(1);
  });
  it('route switch cancels and isolates a late GET from the previous route', async () => {
    let release!: (response: Response) => void; let signal!: AbortSignal;
    getPoints = request => { if (new URL(request.url).searchParams.get('route_id') === '71') { signal = request.signal; return new Promise(resolve => { release = resolve; }); } return Promise.resolve(json({ checkpoints: [{ ...point, route_id: 92, name: 'КП Б' }] })); };
    const { router, client } = mount(); await screen.findByText('Загружаем КП маршрута…'); await act(() => router.navigate('/staff/routes/92/checkpoints'));
    await screen.findByText('КП Б'); expect(signal.aborted).toBe(true); await act(async () => release(json({ checkpoints: points })));
    expect(screen.queryByText(other.name)).not.toBeInTheDocument(); expect(client.getQueryData(['checkpoints', 71])).toBeUndefined();
  });
});

describe('single CRUD and fields', () => {
  it.each(['', '1.5', 'NaN', 'Infinity', '1e2', '9007199254740992', '1\n'])('invalid order %s cannot be serialized by the form', value => expect(validate({ ...pointFields(point), order: value }, 'create').order).toBeDefined());
  it('zero, negative, padded order and independent flags have no invented restrictions', () => {
    expect(emptyFields().order).toBe('');
    for (const order of ['0', '-5', '0005']) expect(validate({ ...pointFields(point), coordinates: '56.83, 60.60', order }, 'create')).toEqual({});
    const body = createBody({ ...pointFields(point), order: '0005' }, 71); expect(body.order).toBe(5); expect(body.coordinates).toBe(point.coordinates); expect(body.is_start && body.is_finish).toBe(true);
  });
  it.each(['name', 'address', 'coordinates'] as const)('rejects blank %s locally; never sends null', field => expect(validate({ ...pointFields(point), [field]: '  \n ' }, 'edit')[field]).toBeDefined());
  it('POST review, double click, exact DTO and shared public cache refresh', async () => {
    const { user, client, router } = mount(); await start('create', user); expect(calls('POST')).toHaveLength(0); await user.dblClick(confirm('create'));
    await screen.findByRole('heading', { name: 'Создание КП подтверждено' }); await screen.findByText('Список КП обновлён.'); expect(calls('POST')).toHaveLength(1);
    expect(await calls('POST')[0]!.json()).toEqual({ route_id: 71, name: '  Новый КП  ', address: '  Адрес;000  ', coordinates: '  56.8300, 060.6000  ', order: 5, is_start: false, is_finish: false });
    expect(client.getQueryData(['checkpoints', 71])).toEqual(points); await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await act(() => router.navigate('/routes/71')); expect(await screen.findByRole('list', { name: 'Контрольные пункты маршрута' })).toHaveTextContent(created.name.trim());
  });
  it('PUT sends changed-only fields including false, no route_id or null', async () => {
    const { user } = mount(); await start('edit', user); await user.click(screen.getByRole('button', { name: 'Вернуться к полям КП' }));
    change('Название КП', point.name); await user.click(screen.getByLabelText('Старт маршрута')); change('Координаты', ' -56.83, +60.60 ');
    await user.click(screen.getByRole('button', { name: 'Проверить данные КП' })); await user.click(confirm('edit')); await screen.findByRole('heading', { name: 'Изменение КП подтверждено' });
    expect(await calls('PUT')[0]!.json()).toEqual({ is_start: false, coordinates: ' -56.83, +60.60 ' });
  });
  it('no diff means no PUT; textual order 0000 equals zero', async () => {
    const { user } = mount(); await start('edit', user); await user.click(screen.getByRole('button', { name: 'Вернуться к полям КП' })); change('Название КП', point.name); change('Порядок прохождения', '0000');
    await user.click(screen.getByRole('button', { name: 'Проверить данные КП' })); await screen.findByText('Нет изменений для отправки.'); expect(calls('PUT')).toHaveLength(0); expect(updateBody(pointFields(point), point)).toEqual({});
  });
  it('DELETE requires ID КП rather than route ID; 204 has no body or optimistic remove', async () => {
    const { user, client } = mount(); await start('delete', user); change('Введите ID КП 201', '71'); expect(confirm('delete')).toBeDisabled(); expect(client.getQueryData(['checkpoints', 71])).toEqual(points);
    change('Введите ID КП 201', '201'); await user.dblClick(confirm('delete')); await screen.findByRole('heading', { name: 'Операция удаления КП подтверждена' }); await screen.findByText('Список КП обновлён.');
    expect(calls('DELETE')).toHaveLength(1); expect(await calls('DELETE')[0]!.text()).toBe('');
  });
  it('stale baseline blocks PUT until manual GET and explicit rebase preserves only intended changes', async () => {
    const { user, client } = mount(); await start('edit', user); points = points.map(item => item.id === 201 ? { ...item, address: 'Чужая правка адреса' } : item);
    await act(async () => { client.setQueryData(['checkpoints', 71], points); }); await waitFor(() => expect(confirm('edit')).toBeDisabled());
    const accept = screen.getByRole('button', { name: 'Использовать обновлённые данные, сохранив мою правку' }); expect(accept).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Перечитать КП перед действием' })); await waitFor(() => expect(accept).toBeEnabled()); await user.click(accept);
    await user.click(screen.getByRole('button', { name: 'Проверить данные КП' })); await user.click(confirm('edit')); await screen.findByRole('heading', { name: 'Изменение КП подтверждено' });
    expect(await calls('PUT')[0]!.json()).toEqual({ name: 'Изменённый КП' }); expect(points.find(item => item.id === 201)!.address).toBe('Чужая правка адреса');
  });
  it.each(['create', 'edit', 'delete'] as const)('%s success is preserved when control GET fails', async kind => {
    mutate = async () => { getPoints = async () => json({}, 500); return kind === 'delete' ? new Response(null, { status: 204 }) : json(kind === 'create' ? created : point, kind === 'create' ? 201 : 200); };
    const { user } = mount(); await start(kind, user); await user.click(confirm(kind)); await screen.findByText('Операция с КП подтверждена, но перечитать список не удалось.');
    getPoints = async () => json({ checkpoints: points }); await user.click(screen.getByRole('button', { name: 'Повторить обновление списка КП' })); await screen.findByText('Список КП обновлён.');
  });
});

describe('refusals, unknown writes and deferred operations', () => {
  it('typing different fields keeps focus and opaque text in the intended control', async () => {
    const { user } = mount(); await screen.findByRole('list', { name: 'КП выбранного маршрута' }); await user.click(screen.getByRole('button', { name: 'Создать один КП' }));
    await user.type(screen.getByLabelText('Название КП'), 'Название'); await user.type(screen.getByLabelText('Адрес'), 'Адрес с пробелом');
    expect(screen.getByLabelText('Адрес')).toHaveValue('Адрес с пробелом'); expect(screen.getByLabelText('Адрес')).toHaveFocus();
    await user.type(screen.getByLabelText('Координаты'), 'opaque: x;000'); expect(screen.getByLabelText('Координаты')).toHaveValue('opaque: x;000');
  });
  it.each(['edit', 'delete'] as const)('closing pending %s aborts only local waiting and keeps a deferred marker', async kind => {
    mutate = () => new Promise(() => {}); const { user } = mount(); await start(kind, user); await user.click(confirm(kind));
    const method = kind === 'edit' ? 'PUT' : 'DELETE', request = calls(method)[0]!;
    await user.click(screen.getByRole('button', { name: 'Закрыть и разобраться позже' })); expect(request.signal.aborted).toBe(true); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Удалить КП.*Исходный КП/ })).toBeDisabled(); expect(calls(method)).toHaveLength(1);
  });
  it('late public GET after account switch to participant cannot refill the old cache', async () => {
    let release!: (response: Response) => void; let signal!: AbortSignal; getPoints = request => { signal = request.signal; return new Promise(resolve => { release = resolve; }); };
    const { client } = mount(); await screen.findByText('Загружаем КП маршрута…'); await act(async () => { sessionStore.logout(); login('participant', 9); });
    await screen.findByRole('heading', { name: 'Нет доступа' }); expect(signal.aborted).toBe(true); await act(async () => release(json({ checkpoints: points })));
    expect(client.getQueryData(['checkpoints', 71])).toBeUndefined(); expect(client.getQueryCache().findAll({ queryKey: ['private', 'adminCheckpoints'] })).toHaveLength(0);
  });
  it('absence after uncertain DELETE does not clear the marker or license another DELETE', async () => {
    mutate = async () => json({}, 408); const { user } = mount(); await start('delete', user); await user.click(confirm('delete')); await screen.findByText('Исход операции неизвестен'); await user.click(screen.getByRole('button', { name: 'Закрыть и разобраться позже' }));
    points = [other]; await user.click(screen.getByRole('button', { name: 'Обновить КП' })); await waitFor(() => expect(screen.queryByRole('button', { name: /Удалить КП.*Исходный КП/ })).not.toBeInTheDocument());
    expect(screen.getByText(/Отложена операция с неизвестным исходом/)).toBeInTheDocument(); points = [other, point]; await user.click(screen.getByRole('button', { name: 'Обновить КП' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Удалить КП.*Исходный КП/ })).toBeDisabled()); expect(calls('DELETE')).toHaveLength(1);
  });
  it('confirmed POST keeps the old public points until the control GET actually completes', async () => {
    let release!: (response: Response) => void; mutate = async () => { getPoints = () => new Promise(resolve => { release = resolve; }); return json(created, 201); };
    const { user, client } = mount(); await start('create', user); await user.click(confirm('create')); await screen.findByText('Перечитываем КП маршрута…');
    expect(client.getQueryData(['checkpoints', 71])).toEqual(points); expect(client.getQueryData(['routes'])).toBeDefined();
    await act(async () => release(json({ checkpoints: [...points, created] }))); await screen.findByText('Список КП обновлён.');
    expect(client.getQueryData(['checkpoints', 71])).toEqual([...points, created]);
  });
  for (const kind of ['create', 'edit', 'delete'] as const) {
    it.each([400, 403, 404, 409, 422])(`${kind} HTTP %i keeps input and never removes a record`, async status => {
      mutate = async () => json({ detail: [{ loc: ['body', 'coordinates'], msg: '<script>private</script>', input: 'secret' }] }, status);
      const { user, client } = mount(); await start(kind, user); await user.click(confirm(kind)); expect(await screen.findByRole('alert')).toHaveTextContent(`(${status})`);
      expect(screen.queryByText(/<script>/)).not.toBeInTheDocument(); expect(client.getQueryData(['checkpoints', 71])).toEqual(points);
      if (kind !== 'delete' && status === 422) expect(screen.getByLabelText('Координаты')).toHaveAttribute('aria-invalid', 'true');
    });
    it.each(['408', '500', 'network', 'timeout', 'abort', 'bad-json', 'wrong-status', 'foreign'])(`${kind} %s stays uncertain without auto retry`, async mode => {
      mutate = async () => {
        if (mode === 'network') throw new TypeError('network');
        if (mode === 'timeout' || mode === 'abort') throw new DOMException('interruption', mode === 'timeout' ? 'TimeoutError' : 'AbortError');
        if (mode === 'bad-json') return new Response('{', { status: kind === 'create' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
        if (mode === 'foreign') return json({ ...point, route_id: 92 }, kind === 'create' ? 201 : 200);
        return json({}, mode === 'wrong-status' ? kind === 'create' ? 200 : 201 : Number(mode));
      };
      const { user, client } = mount(); await start(kind, user); await user.click(confirm(kind)); await screen.findByText('Исход операции неизвестен');
      const method = kind === 'create' ? 'POST' : kind === 'edit' ? 'PUT' : 'DELETE'; expect(calls(method)).toHaveLength(1); expect(client.getQueryData(['checkpoints', 71])).toEqual(points);
      window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus'));
      await user.click(screen.getByRole('button', { name: 'Проверить список КП' })); await waitFor(() => expect(cpReads()).toHaveLength(2));
      expect(calls(method)).toHaveLength(1); if (kind === 'delete') expect(screen.queryByRole('button', { name: 'Подтвердить удаление КП' })).not.toBeInTheDocument();
      else expect(screen.getByRole('button', { name: 'Проверить данные КП' })).toBeDisabled();
    });
    it(`${kind} current 401 clears only the current private session`, async () => {
      mutate = async () => json({}, 401); const { user, client } = mount(); await start(kind, user); await user.click(confirm(kind)); await screen.findByRole('heading', { name: 'Вход' });
      expect(sessionStore.getSnapshot().session).toBeNull(); expect(client.getQueryCache().findAll({ queryKey: ['private', 'adminCheckpoints'] })).toHaveLength(0);
    });
    it.each([200, 401])(`${kind} late %i from A cannot expose result or expire B`, async status => {
      let release!: (response: Response) => void; mutate = () => new Promise(resolve => { release = resolve; });
      const { user, client } = mount(); await start(kind, user); await user.click(confirm(kind)); await act(async () => { sessionStore.logout(); login('admin', 9); }); await screen.findByRole('button', { name: 'Создать один КП' });
      await act(async () => release(status === 401 ? json({}, 401) : kind === 'delete' ? new Response(null, { status: 204 }) : json(created, kind === 'create' ? 201 : 200)));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(sessionStore.getSnapshot().session?.userId).toBe(9);
      expect(client.getQueryCache().findAll({ queryKey: ['private', 'adminCheckpoints'] }).some(query => JSON.stringify(query.state.data).includes('Новый КП'))).toBe(false);
    });
  }
  it('unknown DELETE can close, stays blocked across navigation and cannot be replayed after resume', async () => {
    mutate = async () => json({}, 408); const { user, router } = mount(); await start('delete', user); await user.click(confirm('delete')); await screen.findByText('Исход операции неизвестен');
    await user.click(screen.getByRole('button', { name: 'Закрыть и разобраться позже' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Удалить КП.*Исходный КП/ })).toBeDisabled(); expect(screen.getByRole('button', { name: /Удалить КП.*Другой КП/ })).toBeEnabled();
    await act(() => router.navigate('/staff/routes/92/checkpoints')); await screen.findByRole('list', { name: 'КП выбранного маршрута' }); await act(() => router.navigate('/staff/routes/71/checkpoints'));
    await screen.findByRole('button', { name: /Открыть проверку отложенной операции/ }); expect(screen.getByRole('button', { name: /Удалить КП.*Исходный КП/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Открыть проверку отложенной операции/ })); expect(screen.queryByRole('button', { name: 'Подтвердить удаление КП' })).not.toBeInTheDocument(); expect(calls('DELETE')).toHaveLength(1);
  });
  it('closing pending POST aborts local wait and preserves draft without locking modal', async () => {
    mutate = () => new Promise(() => {}); const { user } = mount(); await start('create', user); await user.click(confirm('create')); const request = calls('POST')[0]!;
    await user.click(screen.getByRole('button', { name: 'Закрыть и разобраться позже' })); expect(request.signal.aborted).toBe(true); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать один КП' })).toBeDisabled(); await user.click(screen.getByRole('button', { name: /Открыть проверку отложенной операции/ }));
    expect(await screen.findByLabelText('Название КП')).toHaveValue('  Новый КП  '); expect(calls('POST')).toHaveLength(1);
  });
  it('unknown POST requires responsible check, renewed acknowledgment and review', async () => {
    mutate = async () => json({}, 408); const { user } = mount(); await start('create', user); await user.click(confirm('create')); await screen.findByText('Исход операции неизвестен');
    const risk = screen.getByRole('checkbox', { name: /Я проверил с ответственным/ }); expect(risk).toBeDisabled(); await user.click(screen.getByRole('button', { name: 'Проверить список КП' })); await waitFor(() => expect(risk).toBeEnabled()); await user.click(risk);
    change('Адрес', 'Новый адрес'); expect(risk).not.toBeChecked(); await user.click(screen.getByRole('button', { name: 'Проверить список КП' })); await waitFor(() => expect(risk).toBeEnabled()); await user.click(risk);
    await user.click(screen.getByRole('button', { name: 'Проверить данные КП' })); expect(calls('POST')).toHaveLength(1); mutate = async () => json(created, 201); await user.click(confirm('create')); await screen.findByRole('heading', { name: 'Создание КП подтверждено' }); expect(calls('POST')).toHaveLength(2);
  });
  it('leaving while PUT pending records uncertainty and ignores late data', async () => {
    let release!: (response: Response) => void; mutate = () => new Promise(resolve => { release = resolve; }); const { user, router } = mount(); await start('edit', user); await user.click(confirm('edit'));
    await act(() => router.navigate('/staff/routes/92/checkpoints')); expect(calls('PUT')[0]!.signal.aborted).toBe(true); await act(async () => release(json({ ...point, name: 'Поздняя запись' })));
    await act(() => router.navigate('/staff/routes/71/checkpoints')); await screen.findByText('Исход операции неизвестен'); expect(screen.getByLabelText('Название КП')).toHaveValue('Изменённый КП');
  });
  it('PUT foreign ID КП is not a success', async () => {
    mutate = async () => json({ ...point, id: 999 }); const { user } = mount(); await start('edit', user); await user.click(confirm('edit')); await screen.findByText('Исход операции неизвестен');
  });
  it('API-controlled checkpoint strings render as text rather than executing', async () => {
    points = [{ ...point, name: '<script>bad()</script>', address: '<img src=x onerror=bad()>', coordinates: '<iframe>opaque</iframe>' }]; mount(); const list = await screen.findByRole('list', { name: 'КП выбранного маршрута' }); expect(list).toHaveTextContent('<script>bad()</script>'); expect(document.querySelector('script, img, iframe')).toBeNull();
  });
});
