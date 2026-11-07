import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/router';
import { sessionStore } from '../../shared/session/store';
import { safeReturnTo, returnToFromState } from '../auth/redirect';
import { mutateRoute } from './api';
import { createBody, emptyFields, routeFields, updateBody, validate } from './model';
import type { PublicRoute } from '../routes/model';

const route: PublicRoute = { id: 12, year: 2025, name: 'Тестовая тропа', distance: 12, description: 'Исходное описание', is_active: true, map_url: '/test-assets/map.pdf' };
const created: PublicRoute = { ...route, id: 101, year: 2030, name: '  Новый путь  ', distance: 12.5 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn<typeof fetch>();
const routers: ReturnType<typeof createMemoryRouter>[] = [], clients: QueryClient[] = [];
let list: PublicRoute[];
let get: () => Promise<Response>, mutation: (request: Request) => Promise<Response>;
const login = (role = 'admin', user = 7) => sessionStore.login({ access_token: `synthetic-${user}`, user_id: user, role }, sessionStore.beginAuthentication());
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
beforeEach(() => {
  sessionStore.logout(); login(); fetchMock.mockReset(); list = [structuredClone(route)];
  // Native modal semantics/focus trapping are covered in real Chromium; jsdom needs the opening primitive.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  get = async () => json({ routes: list });
  mutation = async request => {
    if (request.method === 'POST') { list.push(created); return json(created, 201); }
    if (request.method === 'PUT') { const body = await request.clone().json(); list = list.map(item => item.id === 12 ? { ...item, ...body } : item); return json(list[0]); }
    list = []; return new Response(null, { status: 204 });
  };
  fetchMock.mockImplementation(async input => {
    const request = input as Request, url = new URL(request.url);
    expect(request.credentials).toBe('omit'); expect(url.search).toBe('');
    if (request.method === 'GET' && url.pathname === '/api/v1/routes') { expect(request.headers.has('Authorization')).toBe(false); return get(); }
    if (request.method === 'POST' && url.pathname === '/api/v1/auth/login') return json({ access_token: 'synthetic-login', user_id: 7, role: 'admin' });
    expect(['/api/v1/admin/routes', '/api/v1/admin/routes/12']).toContain(url.pathname);
    expect(request.headers.get('Authorization')).toBe(`Bearer synthetic-${sessionStore.getSnapshot().session?.userId}`);
    return mutation(request);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); sessionStore.logout(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()); if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); vi.restoreAllMocks(); });
function mount(path = '/staff/routes', state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(appRoutes, { initialEntries: [{ pathname: path, state }] }); clients.push(client); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router, user: userEvent.setup() };
}
const calls = (method: string) => fetchMock.mock.calls.map(call => call[0] as Request).filter(request => request.method === method && new URL(request.url).pathname.startsWith('/api/v1/admin/routes'));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function start(kind: 'create' | 'edit' | 'archive', user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('list', { name: 'Маршруты из публичного каталога' });
  await user.click(screen.getByRole('button', { name: kind === 'create' ? 'Новый маршрут' : kind === 'edit' ? /Изменить.*Тестовая тропа/ : /Архивировать.*Тестовая тропа/ }));
  await screen.findByRole('dialog');
  if (kind === 'create') { change('Год', '2030'); change('Название', '  Новый путь  '); change('Дистанция, км', '12,5'); }
  if (kind === 'edit') change('Название', 'Новое название');
  if (kind !== 'archive') { await user.click(screen.getByRole('button', { name: 'Проверить данные' })); await screen.findByRole('region', { name: 'Проверка маршрута' }); }

}
const confirmation = (kind: 'create' | 'edit' | 'archive') => screen.getByRole('button', { name: kind === 'create' ? 'Подтвердить создание' : kind === 'edit' ? 'Подтвердить изменения' : 'Подтвердить архивацию' });

describe('admin access and shared public list', () => {
  it.each(['participant', 'typist', 'organizer', 'unknown', 'Admin', ''])('rejects exact non-admin role %s before all reads and writes', async role => {
    login(role); mount(); expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled();
    await expect(mutateRoute('edit', {}, 12, sessionStore.getCredentials()!.epoch, new AbortController().signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('guest returns safely to admin after UI login; ordinary admin login defaults to workspace', async () => {
    sessionStore.logout(); const { user, router } = mount();
    await screen.findByRole('heading', { name: 'Вход' }); expect(router.state.location.state).toMatchObject({ returnTo: '/staff/routes' });
    change('Имя пользователя', 'synthetic'); change('Пароль', 'test-only-password'); await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('heading', { name: 'Управление маршрутами' })).toBeInTheDocument();
    expect(returnToFromState(null, 'admin')).toBe('/staff/routes'); expect(returnToFromState(null, 'typist')).toBe('/staff/typist'); expect(returnToFromState(null, 'participant')).toBe('/account');
    expect(returnToFromState({ returnTo: '/account' }, 'admin')).toBe('/account');
  });
  it.each(['/staff/routes?x=1', '/staff/routes#x', '//staff/routes', '/staff/routes/../routes', '/staff%2Froutes', '/staff/routes/new', '/staff\\routes', 'https://example.test/staff/routes', '/x/../staff/routes', '/%2573taff/routes'])('rejects unsafe admin returnTo %s', value => expect(safeReturnTo(value)).toBe('/account'));
  it('accepts only exact new staff path and does not expand arbitrary staff access', () => expect(safeReturnTo('/staff/routes')).toBe('/staff/routes'));
  it('uses public query and explicitly labels activity, optional scheme and list incompleteness', async () => {
    const { client } = mount(); expect(await screen.findByText('Активный маршрут')).toBeInTheDocument();
    expect(screen.getByText(/Архив сохраняет историю/)).toBeInTheDocument();
    expect(client.getQueryData(['routes'])).toEqual(list); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /Открыть схему/ })).toHaveAttribute('target', '_blank');
  });
  it.each(['empty', 'invalid', 'error'])('handles %s list without record actions and can retry reads', async mode => {
    get = async () => mode === 'empty' ? json({ routes: [] }) : mode === 'invalid' ? json({ routes: [null] }) : json({}, 500);
    const { user } = mount(); await screen.findByRole(mode === 'empty' ? 'status' : 'alert');
    expect(screen.queryByRole('button', { name: /Изменить.*Тестовая/ })).not.toBeInTheDocument();
    if (mode !== 'empty') { get = async () => json({ routes: list }); await user.click(screen.getByRole('button', { name: 'Повторить загрузку каталога' })); await screen.findByText(route.name); }
  });
  it('loading does not enable action against an unknown record', async () => {
    get = () => new Promise(() => {}); mount(); expect(await screen.findByText('Загружаем маршруты…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Изменить/ })).not.toBeInTheDocument();
  });
});

describe('route forms and confirmed operations', () => {
  it('blocks the ambiguous physical DELETE even for admin before any HTTP call', async () => {
    await expect(mutateRoute('delete', {}, 12, sessionStore.getCredentials()!.epoch, new AbortController().signal)).rejects.toThrow('Безопасное физическое удаление');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('archives and restores with exact partial PUT, refreshes both views and leaves participants/checkpoints untouched', async () => {
    const { user, client, router } = mount(); await screen.findByRole('heading', { name: route.name });
    const epoch = sessionStore.getCredentials()!.epoch;
    client.setQueryData(['checkpoints', 12], [{ id: 1, route_id: 12 }]);
    client.setQueryData(['private', 'participants', epoch], [{ id: 77, route_name: route.name }]);
    await user.dblClick(screen.getByRole('button', { name: /Архивировать.*Тестовая тропа/ }));
    expect(screen.queryByRole('button', { name: /Удалить/ })).not.toBeInTheDocument();
    expect(calls('PUT')).toHaveLength(0);
    await user.dblClick(screen.getByRole('button', { name: 'Подтвердить архивацию' }));
    await screen.findByRole('heading', { name: 'Маршрут перемещён в архив' });
    expect(await calls('PUT')[0]!.clone().json()).toEqual({ is_active: false });
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.getByText('В архиве')).toBeInTheDocument();
    await act(() => router.navigate('/routes')); await screen.findByRole('heading', { name: 'Маршрутов пока нет' });
    expect(screen.queryByRole('heading', { name: route.name })).not.toBeInTheDocument();
    await act(() => router.navigate('/staff/routes'));
    await user.click(await screen.findByRole('button', { name: /Восстановить.*Тестовая тропа/ }));
    await user.dblClick(screen.getByRole('button', { name: 'Подтвердить восстановление' }));
    await screen.findByRole('heading', { name: 'Маршрут восстановлен' });
    expect(await calls('PUT')[1]!.clone().json()).toEqual({ is_active: true });
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await act(() => router.navigate('/routes')); expect(await screen.findByRole('heading', { name: route.name })).toBeInTheDocument();
    expect(client.getQueryData(['checkpoints', 12])).toEqual([{ id: 1, route_id: 12 }]);
    expect(client.getQueryData(['private', 'participants', epoch])).toEqual([{ id: 77, route_name: route.name }]);
    expect(calls('PUT')).toHaveLength(2); expect(calls('DELETE')).toHaveLength(0);
  });
  it('reconciles an unknown archive through explicit fresh GET and acknowledgment without another PUT', async () => {
    mutation = async () => { list = [{ ...route, is_active: false }]; throw new TypeError('Synthetic lost response'); };
    const { user } = mount(); await start('archive', user); await user.click(confirmation('archive'));
    await screen.findByText('Исход предыдущей операции неизвестен.');
    await user.click(screen.getByRole('button', { name: 'Проверить состояние в каталоге' }));
    const reconcile = await screen.findByRole('button', { name: 'Завершить сверку статуса' }); expect(reconcile).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Я сверил ситуацию/ })); await user.click(reconcile);
    await screen.findByRole('heading', { name: 'Маршрут перемещён в архив' });
    expect(screen.getByText(/Исход прежнего запроса остаётся неизвестным/)).toBeInTheDocument();
    expect(calls('PUT')).toHaveLength(1); expect(calls('DELETE')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Закрыть' })); expect(screen.getByRole('button', { name: /Восстановить.*Тестовая тропа/ })).toBeEnabled();
  });
  it('defers an interrupted archive and blocks new writes across navigation without a replay', async () => {
    mutation = () => new Promise(() => {});
    const { user, router } = mount(); await start('archive', user); await user.click(confirmation('archive'));
    await user.click(screen.getByRole('button', { name: 'Закрыть и проверить позже' }));
    await screen.findByText(/Отложена операция с неизвестным исходом/);
    expect(calls('PUT')[0]!.signal.aborted).toBe(true);
    expect(screen.getByRole('button', { name: /Архивировать.*Тестовая тропа/ })).toBeDisabled();
    await act(() => router.navigate('/routes')); await act(() => router.navigate('/staff/routes'));
    await user.click(await screen.findByRole('button', { name: 'Открыть проверку отложенной операции 1' }));
    await screen.findByText('Исход предыдущей операции неизвестен.'); expect(calls('PUT')).toHaveLength(1);
  });
  it.each(['wrong-response', 'stale-get', 'missing-get'])('does not claim archive success for %s', async mode => {
    mutation = async () => {
      if (mode === 'missing-get') list = [];
      return json({ ...route, is_active: mode === 'wrong-response' });
    };
    const { user } = mount(); await start('archive', user); await user.click(confirmation('archive'));
    await screen.findByText(mode === 'wrong-response' ? 'Исход предыдущей операции неизвестен.' : /Полученный каталог не подтверждает/);
    expect(screen.queryByRole('heading', { name: 'Маршрут перемещён в архив' })).not.toBeInTheDocument(); expect(calls('PUT')).toHaveLength(1);
  });
  it('keeps focus while typing, deleting, pasting and tabbing after validation and server 422', async () => {
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Новый маршрут' }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).queryByRole('button', { name: /Выйти/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Проверить данные' }));
    expect(screen.getByLabelText('Год')).toHaveFocus();
    for (const label of ['Год', 'Название', 'Дистанция, км', 'Описание']) {
      const input = screen.getByLabelText(label);
      await user.click(input); await user.type(input, '1234567890');
      expect(input).toHaveFocus(); expect(input).toHaveValue('1234567890');
      await user.keyboard('{Backspace>5/}'); expect(input).toHaveFocus(); expect(input).toHaveValue('12345');
      await user.paste('67890'); expect(input).toHaveValue('1234567890'); expect(input).toHaveFocus();
    }
    change('Год', '2030'); change('Дистанция, км', '12');
    await user.click(screen.getByRole('button', { name: 'Проверить данные' }));
    mutation = async () => json({ detail: [{ loc: ['body', 'name'] }, { loc: ['body', 'description'] }] }, 422);
    await user.click(confirmation('create'));
    await waitFor(() => expect(screen.getByLabelText('Название')).toHaveFocus());
    await user.click(screen.getByLabelText('Описание')); await user.type(screen.getByLabelText('Описание'), 'ещёописание');
    expect(screen.getByLabelText('Описание')).toHaveFocus();
    expect(screen.getByLabelText('Название')).toHaveAttribute('aria-invalid', 'true');
    await user.tab({ shift: true }); expect(screen.getByLabelText('Дистанция, км')).toHaveFocus();
    expect(calls('POST')).toHaveLength(1);
  });
  it('retains inactive routes in the administrative list and filters without a write or public policy change', async () => {
    list.push({ ...route, id: 13, name: 'Архивный синтетический маршрут', is_active: false });
    const { user, client } = mount();
    await screen.findByText('Архивный синтетический маршрут');
    expect(screen.getByLabelText('Показывать маршруты')).toHaveValue('all');
    await user.selectOptions(screen.getByLabelText('Показывать маршруты'), 'active');
    expect(screen.queryByText('Архивный синтетический маршрут')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Показывать маршруты'), 'inactive');
    expect(screen.getByText('Архивный синтетический маршрут')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: route.name })).not.toBeInTheDocument();
    expect(client.getQueryData(['routes'])).toEqual(list); expect(calls('PUT')).toHaveLength(0); expect(calls('DELETE')).toHaveLength(0);
  });
  it.each(['', 'Infinity', 'NaN', '1e999', '0x12', '1\n'])('rejects invalid distance %s', value => expect(validate({ ...emptyFields(), year: '2030', name: 'Имя', distance: value }, 'create').distance).toBeDefined());
  it.each(['', '1.2', '9007199254740992', '2030\n'])('rejects invalid year %s', value => expect(validate({ ...routeFields(route), year: value }, 'create').year).toBeDefined());
  it('preserves names/spaces and distance without inventing additional limits; year follows the agreed range', () => {
    expect(emptyFields().year).toBe(''); const fields = { ...routeFields(route), name: '  Кириллица  ', year: '-12', distance: '-1,5' };
    expect(validate(fields, 'create')).toEqual({ year: 'Укажите год от 1900 до 2100' }); expect(createBody({ ...fields, year: '2030' })).toMatchObject({ year: 2030, distance: -1.5, name: '  Кириллица  ' });
    expect(validate({ ...fields, name: ' \n ' }, 'create').name).toBeDefined();
  });
  it('POST exact body, review, double click and server list refresh without optimistic records', async () => {
    const { user, client, router } = mount(); await start('create', user); expect(calls('POST')).toHaveLength(0);
    await user.dblClick(confirmation('create'));
    expect(await screen.findByRole('heading', { name: 'Создание подтверждено' })).toBeInTheDocument();
    await screen.findByText('Каталог перечитан с сервера.'); expect(calls('POST')).toHaveLength(1);
    expect(await calls('POST')[0]!.json()).toEqual({ year: 2030, name: '  Новый путь  ', distance: 12.5, is_active: true });
    expect(client.getQueryData(['routes'])).toEqual(list);
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await act(() => router.navigate('/routes/101')); expect(await screen.findByRole('heading', { name: 'Новый путь' })).toBeInTheDocument();
  });
  it('PUT contains only changed fields including false and deliberate description null; year/map remain untouched', async () => {
    const { user } = mount(); await start('edit', user); await user.click(screen.getByRole('button', { name: 'Вернуться к вводу' }));
    change('Название', route.name); change('Описание', '');
    expect(screen.queryByLabelText('Год')).not.toBeInTheDocument(); expect(screen.queryByLabelText('map_url')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Проверить данные' }));
    expect(screen.getByRole('region', { name: 'Проверка маршрута' })).toHaveTextContent('Было:');
    await user.click(confirmation('edit')); await screen.findByRole('heading', { name: 'Изменение подтверждено' });
    expect(await calls('PUT')[0]!.json()).toEqual({ description: null });
    expect(list[0]!.year).toBe(route.year); expect(list[0]!.map_url).toBe(route.map_url);
  });
  it('untouched values and equivalent distance representation produce no PUT', async () => {
    const { user } = mount(); await start('edit', user); await user.click(screen.getByRole('button', { name: 'Вернуться к вводу' }));
    change('Название', route.name); change('Дистанция, км', '12,0'); await user.click(screen.getByRole('button', { name: 'Проверить данные' }));
    expect(await screen.findByText('Нет изменений для отправки.')).toBeInTheDocument(); expect(calls('PUT')).toHaveLength(0);
    expect(updateBody(routeFields(route), route)).toEqual({});
  });

  it.each(['create', 'edit', 'archive'] as const)('%s confirmed result remains confirmed when subsequent GET fails', async kind => {
    mutation = async () => { get = async () => json({}, 500); return json(kind === 'create' ? created : { ...route, is_active: kind !== 'archive' }, kind === 'create' ? 201 : 200); };
    const { user } = mount(); await start(kind, user); await user.click(confirmation(kind));
    expect(await screen.findByText('Операция подтверждена, но обновление списка не удалось.')).toBeInTheDocument();
    expect(screen.queryByText('Исход предыдущей операции неизвестен.')).not.toBeInTheDocument();
    get = async () => json({ routes: list }); await user.click(screen.getByRole('button', { name: 'Перечитать каталог' }));
    await screen.findByText('Каталог перечитан с сервера.');
  });
  it('POST confirmed but absent public record is not treated as failure', async () => {
    mutation = async () => json(created, 201); const { user } = mount(); await start('create', user); await user.click(confirmation('create'));
    expect(await screen.findByText(/Созданный маршрут не появился/)).toBeInTheDocument();
  });


});

describe('operation failures and uncertainty', () => {
  for (const kind of ['create', 'edit', 'archive'] as const) {
    it.each([400, 403, 404, 409, 422])(`${kind} HTTP %i is a safe refusal and keeps input/record`, async status => {
      mutation = async () => json({ detail: [{ loc: ['body', 'name'], msg: '<script>private-input</script>', input: 'sensitive' }] }, status);
      const { user, client } = mount(); await start(kind, user); await user.click(confirmation(kind));
      expect(await screen.findByRole('alert')).toHaveTextContent(`(${status})`);
      expect(screen.queryByText('Исход предыдущей операции неизвестен.')).not.toBeInTheDocument();
      expect(screen.queryByText(/private-input/)).not.toBeInTheDocument(); expect(client.getQueryData(['routes'])).toEqual([route]);
      if (kind !== 'archive') { expect(screen.getByLabelText('Название')).toHaveValue(kind === 'create' ? '  Новый путь  ' : 'Новое название'); if (status === 422) expect(screen.getByLabelText('Название')).toHaveAttribute('aria-invalid', 'true'); }
    });
    it.each(['408', '500', 'network', 'timeout', 'abort', 'malformed', 'wrong-status', 'wrong-dto'])(`${kind} %s is uncertain and never auto-retries`, async mode => {
      mutation = async () => {
        if (mode === 'network') throw new TypeError('Synthetic network');
        if (mode === 'timeout' || mode === 'abort') throw new DOMException('Synthetic interruption', mode === 'timeout' ? 'TimeoutError' : 'AbortError');
        if (mode === 'malformed') return new Response('{', { status: kind === 'create' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
        if (mode === 'wrong-dto') return json({}, kind === 'create' ? 201 : 200);
        return json({}, mode === 'wrong-status' ? kind === 'create' ? 200 : 201 : Number(mode));
      };
      const { user, client, router } = mount(); await start(kind, user); await user.click(confirmation(kind));
      expect(await screen.findByText('Исход предыдущей операции неизвестен.')).toBeInTheDocument();
      const method = kind === 'create' ? 'POST' : 'PUT'; expect(calls(method)).toHaveLength(1); expect(client.getQueryData(['routes'])).toEqual([route]);
      window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus'));
      await user.click(screen.getByRole('button', { name: 'Проверить состояние в каталоге' })); await screen.findByText('Список обновлён, но результат операции нужно сверить с ответственным.');
      expect(calls(method)).toHaveLength(1);
      if (kind === 'archive') expect(screen.queryByRole('button', { name: 'Подтвердить архивацию' })).not.toBeInTheDocument();
      else expect(screen.getByRole('button', { name: 'Проверить данные' })).toBeDisabled();
      await act(() => router.navigate('/routes')); await act(() => router.navigate('/staff/routes'));
      expect(await screen.findByText('Исход предыдущей операции неизвестен.')).toBeInTheDocument(); expect(calls(method)).toHaveLength(1);
    });
    it(`${kind} current 401 clears the session and private state`, async () => {
      mutation = async () => json({}, 401); const { user, client } = mount(); await start(kind, user); await user.click(confirmation(kind));
      await screen.findByRole('heading', { name: 'Вход' }); expect(sessionStore.getSnapshot().session).toBeNull();
      expect(client.getQueryCache().findAll({ queryKey: ['private', 'adminRoutes'] })).toHaveLength(0);
    });
  }
  it('PUT foreign ID is not success', async () => {
    mutation = async () => json({ ...route, id: 99 }); const { user } = mount(); await start('edit', user); await user.click(confirmation('edit'));
    expect(await screen.findByText('Исход предыдущей операции неизвестен.')).toBeInTheDocument();
  });
  it('uncertain create needs manual check, risk acknowledgment and new review; changes reset acknowledgment', async () => {
    mutation = async () => json({}, 408); const { user } = mount(); await start('create', user); await user.click(confirmation('create'));
    await screen.findByText('Исход предыдущей операции неизвестен.');
    const risk = screen.getByRole('checkbox', { name: /Я сверил ситуацию/ }); expect(risk).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Проверить состояние в каталоге' })); await waitFor(() => expect(risk).toBeEnabled());
    await user.click(risk); change('Название', 'Другой путь'); expect(risk).not.toBeChecked(); expect(risk).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Проверить состояние в каталоге' })); await waitFor(() => expect(risk).toBeEnabled()); await user.click(risk);
    await user.click(screen.getByRole('button', { name: 'Проверить данные' })); expect(calls('POST')).toHaveLength(1);
    mutation = async () => json(created, 201); await user.click(confirmation('create')); await screen.findByRole('heading', { name: 'Создание подтверждено' });
    expect(calls('POST')).toHaveLength(2); expect(screen.getByText(/Ранее была операция без подтверждения/)).toBeInTheDocument();
  });
});

describe('session, cancellation and escaping', () => {
  it('closing by Escape restores focus only after the dialog is gone and opener enabled', async () => {
    const { user } = mount(); await start('edit', user);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /Изменить.*Тестовая тропа/ })).toHaveFocus());
  });
  it('confirmed POST does not add a local record while authoritative GET is pending', async () => {
    let release!: (response: Response) => void;
    mutation = async () => { get = () => new Promise(resolve => { release = resolve; }); return json(created, 201); };
    const { user, client } = mount(); await start('create', user); await user.click(confirmation('create'));
    await screen.findByRole('heading', { name: 'Создание подтверждено' }); await screen.findByText('Обновляем список после подтверждённой операции…');
    expect(client.getQueryData(['routes'])).toEqual([route]);
    await act(async () => release(json({ routes: [route, created] })));
    await screen.findByText('Каталог перечитан с сервера.'); expect(client.getQueryData(['routes'])).toEqual([route, created]);
  });
  it('server-side change is shown for comparison while PUT retains only intended fields', async () => {
    const { user } = mount(); await start('edit', user); await user.click(screen.getByRole('button', { name: 'Вернуться к вводу' }));
    list = [{ ...route, distance: 55 }]; await user.click(screen.getByRole('button', { name: 'Перечитать данные маршрутов' }));
    await screen.findByText(/Маршрут изменился/); await user.click(screen.getByRole('button', { name: 'Проверить данные' })); await user.click(confirmation('edit'));
    await screen.findByRole('heading', { name: 'Изменение подтверждено' }); expect(await calls('PUT')[0]!.json()).toEqual({ name: 'Новое название' });
    expect(list[0]!.distance).toBe(55);
  });
  it('a record disappearing during manual refresh disables its pending edit confirmation', async () => {
    const { user } = mount(); await start('edit', user); list = [];
    await user.click(screen.getByRole('button', { name: 'Перечитать данные маршрутов' }));
    await screen.findByText(/Маршрут сейчас не найден в списке/); expect(confirmation('edit')).toBeDisabled(); expect(calls('PUT')).toHaveLength(0);
  });
  it.each(['id', 'year', 'name', 'distance', 'is_active'])('POST missing required response %s is uncertain', async field => {
    const malformed: Record<string, unknown> = { ...created }; delete malformed[field]; mutation = async () => json(malformed, 201);
    const { user } = mount(); await start('create', user); await user.click(confirmation('create')); expect(await screen.findByText('Исход предыдущей операции неизвестен.')).toBeInTheDocument();
  });
  for (const kind of ['create', 'edit', 'archive'] as const) {
    it.each([{ status: 200, role: 'admin' }, { status: 401, role: 'admin' }, { status: 200, role: 'participant' }, { status: 401, role: 'participant' }])(`${kind} late $status from admin A cannot affect new $role`, async ({ status, role }) => {
      let release!: (response: Response) => void; mutation = () => new Promise(resolve => { release = resolve; });
      const { user, client } = mount(); await start(kind, user); await user.click(confirmation(kind));
      await waitFor(() => expect(calls(kind === 'create' ? 'POST' : 'PUT')).toHaveLength(1));
      await act(async () => { sessionStore.logout(); login(role, 9); });
      if (role === 'admin') expect(await screen.findByRole('button', { name: 'Новый маршрут' })).toBeInTheDocument();
      else expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await act(async () => release(status === 401 ? json({}, 401) : json(created, kind === 'create' ? 201 : 200)));
      expect(sessionStore.getSnapshot().session?.userId).toBe(9); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(client.getQueryCache().findAll({ queryKey: ['private', 'adminRoutes'] }).some(query => JSON.stringify(query.state.data).includes('Новый путь'))).toBe(false);
    });
    it(`${kind} unmount aborts locally and leaves a persistent uncertainty marker without replay`, async () => {
      mutation = () => new Promise(() => {}); const { user, router } = mount(); await start(kind, user); await user.click(confirmation(kind));
      const request = calls(kind === 'create' ? 'POST' : 'PUT')[0]!;
      await act(() => router.navigate('/routes')); expect(request.signal.aborted).toBe(true);
      await act(() => router.navigate('/staff/routes')); expect(await screen.findByText('Исход предыдущей операции неизвестен.')).toBeInTheDocument();
      expect(calls(kind === 'create' ? 'POST' : 'PUT')).toHaveLength(1);
    });
  }
  it('admin draft is removed immediately on switch to participant B while a public GET is slow', async () => {
    const { user, client } = mount(); await start('create', user);
    let release!: (response: Response) => void; get = () => new Promise(resolve => { release = resolve; });
    void client.refetchQueries({ queryKey: ['routes'] }); await act(async () => { sessionStore.logout(); login('participant', 9); });
    expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => release(json({ routes: list })));
    expect(client.getQueryCache().findAll({ queryKey: ['private', 'adminRoutes'] })).toHaveLength(0);
  });
  it('arbitrary name/description are escaped and unsafe scheme cannot be opened or edited', async () => {
    const payload = '<img src=x onerror=alert(1)>'; list = [{ ...route, name: payload, description: payload, map_url: 'javascript:alert(1)' }]; const { user } = mount();
    await screen.findByRole('list', { name: 'Маршруты из публичного каталога' }); expect(document.querySelector('img, script')).toBeNull(); expect(screen.queryByRole('link', { name: /Открыть схему/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Изменить/ })); expect(screen.getByLabelText('Название')).toHaveValue(payload); expect(screen.queryByLabelText('map_url')).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText(/Год и схему маршрута здесь изменить нельзя/)).toBeInTheDocument();
  });
});
