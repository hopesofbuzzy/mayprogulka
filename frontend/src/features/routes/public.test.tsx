import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/router';
import { sessionStore } from '../../shared/session/store';
import { parseRouteId } from './model';
import type { Checkpoint, PublicRoute } from './model';

const route: PublicRoute = { id: 71, name: 'Тестовая прогулка', year: 2025, distance: 12.5, is_active: true, description: 'Описание маршрута из API', map_url: '/test-assets/route.pdf' };
const other: PublicRoute = { ...route, id: 92, name: 'Другой маршрут', year: 2027, is_active: false };
const point: Checkpoint = { id: 3, route_id: 71, name: 'Тестовый старт', address: 'Тестовый адрес', coordinates: 'opaque: not lat/lon', order: 1, is_start: true, is_finish: false };
const finish: Checkpoint = { ...point, id: 4, name: 'Тестовый финиш', order: 2, is_start: false, is_finish: true };
const fetchMock = vi.fn<typeof fetch>();
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let routeReply: () => Response | Promise<Response>;
let checkpointReply: (request: Request) => Response | Promise<Response>;

beforeEach(() => {
  sessionStore.logout(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  routeReply = () => json({ routes: [route, other] });
  checkpointReply = () => json({ checkpoints: [finish, point] });
  fetchMock.mockImplementation(async input => {
    const request = input as Request;
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(request.headers.has('Authorization')).toBe(false);
    expect(request.credentials).toBe('omit');
    expect(request.signal).toBeDefined();
    if (url.pathname === '/api/v1/routes') { expect(url.search).toBe(''); return routeReply(); }
    expect(url.pathname).toBe('/api/v1/checkpoints');
    expect([...url.searchParams.keys()]).toEqual(['route_id']);
    return checkpointReply(request);
  });
});
afterEach(() => { routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()); sessionStore.logout(); });
function mount(path = '/routes/71') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] }); clients.push(client); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, client, user: userEvent.setup() };
}
const requests = (path: string) => fetchMock.mock.calls.map(call => call[0] as Request).filter(request => new URL(request.url).pathname === path);

describe('public route identity and navigation', () => {
  it.each(['1', '0', '00071', '9007199254740991'])('accepts decimal safe integer %s', value => expect(parseRouteId(value)).toBe(Number(value)));
  it.each([undefined, '', '-1', '+1', '1.0', '1e2', '0x10', ' 1', '1 ', 'Infinity', 'NaN', '9007199254740992', '１２', '\n', '71\n', '71\r', '71\u2028'])('rejects non-decimal or unsafe ID %s', value => expect(parseRouteId(value)).toBeNull());
  it.each(['abc', '-1', '+1', '1.2', '1e2', '9007199254740992', '0x47', '%20', '71%0A', '71%0D'])('invalid URL %s performs no HTTP reads', async value => {
    mount(`/routes/${value}`);
    expect(await screen.findByRole('heading', { name: 'Некорректный номер маршрута' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('opens directly, loads exactly selected checkpoints and keeps actual fields/order', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: route.name })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Контрольные пункты маршрута' });
    const points = within(list).getAllByRole('listitem');
    expect(points[0]).toHaveTextContent(point.name); expect(points[1]).toHaveTextContent(finish.name);
    expect(points[0]).toHaveTextContent('Порядок: 1'); expect(points[0]).toHaveTextContent('Старт'); expect(points[1]).toHaveTextContent('Финиш');
    expect(screen.getByText('2025 год')).toBeInTheDocument(); expect(screen.getByText('12,5 км')).toBeInTheDocument();
    expect(screen.getByText(route.description!)).toBeInTheDocument();
    expect(screen.getByText(/Активность маршрута не означает/)).toBeInTheDocument();
    expect(screen.getByText(/а не прохождение участника/)).toBeInTheDocument();
    expect(screen.queryByText(point.coordinates)).not.toBeInTheDocument();
    expect(document.querySelector('iframe, img, canvas')).toBeNull();
    expect(requests('/api/v1/routes')).toHaveLength(1);
    expect(new URL(requests('/api/v1/checkpoints')[0]!.url).search).toBe('?route_id=71');
    expect(screen.getByRole('link', { name: 'Зарегистрировать участников' })).toHaveAttribute('href', '/account/participants/new');
  });
  it('catalog → detail → back/forward reuses the same routes query and cache', async () => {
    const { user, router } = mount('/routes');
    await user.click(await screen.findByRole('link', { name: /Подробнее о маршруте.*Тестовая прогулка/ }));
    expect(await screen.findByRole('list', { name: 'Контрольные пункты маршрута' })).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(await screen.findByRole('heading', { name: 'Маршруты' })).toBeInTheDocument();
    await act(() => router.navigate(1));
    expect(await screen.findByRole('heading', { name: route.name })).toBeInTheDocument();
    expect(requests('/api/v1/routes')).toHaveLength(1); expect(requests('/api/v1/checkpoints')).toHaveLength(1);
    await user.click(screen.getByRole('link', { name: '← Все маршруты' }));
    expect(await screen.findByRole('heading', { name: 'Маршруты' })).toBeInTheDocument();
  });
  it.each([{ routes: [] }, { routes: [route] }])('missing route is distinct from unavailable API and sends no checkpoints', async ({ routes }) => {
    routeReply = () => json({ routes }); mount('/routes/999');
    expect(await screen.findByRole('heading', { name: 'Маршрут не найден' })).toBeInTheDocument();
    expect(requests('/api/v1/checkpoints')).toHaveLength(0);
    if (!routes.length) expect(screen.getByText('Сервис вернул пустой список маршрутов.')).toBeInTheDocument();
  });
  it('waits for confirmed route presence before requesting checkpoints', async () => {
    let release!: (response: Response) => void; routeReply = () => new Promise(resolve => { release = resolve; });
    mount(); expect(await screen.findByText('Загружаем маршрут…')).toBeInTheDocument();
    expect(requests('/api/v1/checkpoints')).toHaveLength(0);
    await act(async () => release(json({ routes: [route] })));
    expect(await screen.findByRole('list', { name: 'Контрольные пункты маршрута' })).toBeInTheDocument();
  });
  it('a public 401 does not expire an authenticated session or send its Bearer', async () => {
    sessionStore.login({ access_token: 'synthetic-memory-only', user_id: 7, role: 'participant' }, sessionStore.beginAuthentication());
    const epoch = sessionStore.getCredentials()!.epoch;
    checkpointReply = () => json({}, 401); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('(401)');
    expect(sessionStore.isCurrentSession(epoch)).toBe(true);
    expect(requests('/api/v1/checkpoints')[0]!.headers.has('Authorization')).toBe(false);
  });
});

describe('independent route and checkpoint failures', () => {
  it.each([401, 403, 404, 409, 422, 500])('routes HTTP %i is not a missing route; manual retry works', async status => {
    routeReply = () => json({ detail: 'untrusted server text' }, status); const { user } = mount();
    expect(await screen.findByRole('heading', { name: 'Маршрут пока недоступен' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(String(status)); expect(screen.queryByText('untrusted server text')).not.toBeInTheDocument();
    expect(requests('/api/v1/checkpoints')).toHaveLength(0); expect(fetchMock).toHaveBeenCalledTimes(1);
    routeReply = () => json({ routes: [route] });
    await user.click(screen.getByRole('button', { name: 'Повторить загрузку маршрутов' }));
    expect(await screen.findByRole('list', { name: 'Контрольные пункты маршрута' })).toBeInTheDocument();
  });
  it.each([{ routes: [null] }, { routes: [{ ...route, name: {} }] }, { routes: [{ ...route, distance: '12' }] }, { routes: [route, route] }, {}, []])('malformed route data is a safe response error (%j)', async body => {
    routeReply = () => json(body); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('некорректный список маршрутов');
    expect(requests('/api/v1/checkpoints')).toHaveLength(0);
  });
  it.each(['routes', 'checkpoints'])('%s invalid JSON is a response error, not a connection failure', async endpoint => {
    const invalid = () => new Response('{', { headers: { 'Content-Type': 'application/json' } });
    if (endpoint === 'routes') routeReply = invalid; else checkpointReply = invalid;
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('некорректный список');
  });
  it.each(['routes', 'checkpoints'])('%s network failure and timeout have honest states', async endpoint => {
    const fail = () => { throw new DOMException('Synthetic timeout', 'TimeoutError'); };
    if (endpoint === 'routes') routeReply = fail; else checkpointReply = fail;
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('не ответил вовремя');
  });
  it.each([401, 403, 404, 409, 422, 500])('checkpoints HTTP %i keeps route and retries only checkpoints', async status => {
    checkpointReply = () => json({ detail: 'untrusted server text' }, status); const { user } = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(`(${status})`);
    expect(screen.getByRole('heading', { name: route.name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Открыть схему/ })).toBeInTheDocument();
    expect(screen.queryByText('untrusted server text')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    checkpointReply = () => json({ checkpoints: [point] });
    await user.click(screen.getByRole('button', { name: 'Повторить загрузку КП' }));
    expect(await screen.findByText(point.name)).toBeInTheDocument();
    expect(requests('/api/v1/routes')).toHaveLength(1); expect(requests('/api/v1/checkpoints')).toHaveLength(2);
  });
  it('checkpoints loading then empty never invents a start or finish', async () => {
    let release!: (response: Response) => void; checkpointReply = () => new Promise(resolve => { release = resolve; }); mount();
    expect(await screen.findByText('Загружаем контрольные пункты…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: route.name })).toBeInTheDocument();
    await act(async () => release(json({ checkpoints: [] })));
    expect(await screen.findByText('Контрольные пункты пока не опубликованы.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Контрольные пункты маршрута' })).not.toBeInTheDocument();
    expect(screen.queryByText('Старт', { exact: true })).not.toBeInTheDocument();
  });
  it.each(Object.keys(point))('rejects a missing required checkpoint field: %s', async field => {
    const malformed: Record<string, unknown> = { ...point }; delete malformed[field];
    checkpointReply = () => json({ checkpoints: [malformed] }); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('некорректный список контрольных пунктов');
  });
  it.each([null, { ...point, route_id: 92 }, { ...point, is_start: 'true' }, { ...point, order: 1.5 }, { ...point, coordinates: {} }, { ...point, address: null }])('rejects malformed or unrelated checkpoints (%j)', async value => {
    checkpointReply = () => json({ checkpoints: [value] }); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('некорректный список контрольных пунктов');
  });
  it('network failure has an explicit retry and preserves route information', async () => {
    checkpointReply = () => { throw new TypeError('offline'); }; const { user } = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подключиться');
    checkpointReply = () => json({ checkpoints: [] }); await user.click(screen.getByRole('button', { name: 'Повторить загрузку КП' }));
    expect(await screen.findByText('Контрольные пункты пока не опубликованы.')).toBeInTheDocument();
  });
  it('navigation aborts the old checkpoint GET, isolates keys and ignores a late response', async () => {
    let release!: (response: Response) => void; let oldSignal!: AbortSignal;
    checkpointReply = request => {
      if (new URL(request.url).searchParams.get('route_id') === '71') { oldSignal = request.signal; return new Promise(resolve => { release = resolve; }); }
      return json({ checkpoints: [{ ...point, route_id: 92, name: 'КП другого маршрута' }] });
    };
    const { router, client } = mount(); await screen.findByText('Загружаем контрольные пункты…');
    await act(() => router.navigate('/routes/92'));
    expect(await screen.findByText('КП другого маршрута')).toBeInTheDocument(); expect(oldSignal.aborted).toBe(true);
    await act(async () => release(json({ checkpoints: [point] })));
    expect(screen.queryByText(point.name)).not.toBeInTheDocument(); expect(client.getQueryData(['checkpoints', 71])).toBeUndefined();
    expect(client.getQueryData(['checkpoints', 92])).toBeDefined();
  });
});

describe('map links and non-executable public text', () => {
  it.each([null, undefined, 'javascript:alert(1)', 'data:text/html,test', 'https://other.example.test/map.pdf', '//other.example.test/map', 'http://name:password@localhost/map'])('rejects unavailable or unsafe map URL %s', async map_url => {
    routeReply = () => json({ routes: [{ ...route, map_url }] }); mount();
    expect(await screen.findByText('Схема маршрута пока недоступна.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Открыть схему/ })).not.toBeInTheDocument();
  });
  it('safe same-origin scheme opens a new tab without weakening the URL policy', async () => {
    mount(); const link = await screen.findByRole('link', { name: /Открыть схему/ });
    expect(link).toHaveAttribute('href', `${window.location.origin}/test-assets/route.pdf`);
    expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('API strings are plain text, never executable markup', async () => {
    const payload = '<img src=x onerror=alert(1)><script>throw 1</script>';
    routeReply = () => json({ routes: [{ ...route, name: payload, description: payload }] });
    checkpointReply = () => json({ checkpoints: [{ ...point, name: payload, address: payload }] }); mount();
    expect(await screen.findByRole('list', { name: 'Контрольные пункты маршрута' })).toHaveTextContent(payload);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(payload);
    expect(document.querySelector('img, script')).toBeNull();
  });
});

describe('public guides', () => {
  it('hero and navigation reach how-to and FAQ without authentication or HTTP', async () => {
    const { user } = mount('/');
    await user.click(screen.getAllByRole('link', { name: /Как участвовать/ }).at(-1)!);
    expect(await screen.findByRole('heading', { name: 'Как участвовать' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Шаги участия' })).toHaveTextContent('без списания денег');
    expect(screen.getByText(/Последующий ввод и сопоставление/)).toHaveTextContent('не задерживает');
    expect(screen.getByText(/Номер анкеты \(form_id\)/)).toHaveTextContent('barcode');
    expect(screen.getByText(/Если PDF недоступен/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Вопросы' }));
    expect(await screen.findByRole('heading', { name: 'Вопросы и ответы' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['/how-to', '/faq'])('direct %s is accessible and all internal links target existing pages', async path => {
    const { router } = mount(path); await screen.findByRole('heading', { level: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    const urls = within(screen.getByRole('main')).getAllByRole('link').map(link => link.getAttribute('href'));
    expect(urls.every(url => ['/routes', '/signup', '/login', '/account', '/account/participants/new', '/faq', '/how-to'].includes(url!))).toBe(true);
    await act(() => router.navigate('/account/participants/new'));
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
    expect(router.state.location.state).toMatchObject({ returnTo: '/account/participants/new' });
  });
  it('FAQ uses keyboard-operable native disclosures and states current limitations', async () => {
    const { user } = mount('/faq'); await screen.findByRole('heading', { name: 'Вопросы и ответы' });
    const summary = screen.getByText('Списываются ли деньги при оплате?'); summary.focus(); await user.keyboard('{Enter}');
    expect(summary.closest('details')).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('без списания денег'); expect(main).toHaveTextContent('если сервер предоставил');
    expect(main).toHaveTextContent('не физическая карта'); expect(main).toHaveTextContent('не полный официальный регламент');
    await waitFor(() => expect(document.title).toBe('Вопросы и ответы — Майская прогулка'));
  });
});
