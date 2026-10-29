import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../app/router';
import type { components } from '../shared/api/schema';

const fixtures: components['schemas']['RouteResponse'][] = [
  { id: 71, name: 'Тестовая лесная тропа', distance: 12.5, year: 2025, is_active: true, description: 'Описание из тестового ответа', map_url: '/test-assets/map.pdf' },
  { id: 92, name: 'Тестовый городской путь', distance: 27, year: 2024, is_active: false, description: null, map_url: null },
];

const nativeRequest = globalThis.Request;
const fetchMock = vi.fn<typeof fetch>();
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // Node's Request needs absolute URLs; real browsers resolve /api against the current origin.
  vi.stubGlobal('Request', class extends nativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, window.location.origin) : input, init);
    }
  });
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  routers.splice(0).forEach((router) => router.dispose());
});

function respond(routes = fixtures, status = 200) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ routes }), { status, headers: { 'Content-Type': 'application/json' } }));
}
function mount(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  clients.push(client);
  routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, user: userEvent.setup() };
}

describe('public routing and keyboard navigation', () => {
  it('renders the home page and navigates via the real CTA, back and forward', async () => {
    respond();
    const { router, user } = mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Город становитсяближе, когдаидёшь пешком.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Личный кабинет/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Как участвовать/ })).toBeDisabled();
    await user.click(screen.getByRole('link', { name: /Выбрать маршрут/ }));
    expect(await screen.findByRole('heading', { name: 'Маршруты' })).toBeInTheDocument();
    expect(await screen.findByText(fixtures[0]!.name)).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
    await act(() => router.navigate(-1));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Город становится');
    await act(() => router.navigate(1));
    expect(await screen.findByRole('heading', { name: 'Маршруты' })).toBeInTheDocument();
  });
  it('has a keyboard-accessible skip link and primary CTA', async () => {
    const { user } = mount();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Перейти к содержимому' })).toHaveFocus();
    await user.tab(); // brand
    await user.tab(); // home
    await user.tab(); // routes; unavailable sections do not take focus
    await user.tab();
    expect(screen.getByRole('link', { name: /Выбрать маршрут/ })).toHaveFocus();
  });
  it('renders an honest 404 and returns home', async () => {
    const { user } = mount('/does-not-exist');
    expect(screen.getByRole('heading', { name: 'Страница не найдена' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /На главную/ }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Город становится');
  });
});

describe('routes HTTP integration with controlled test responses', () => {
  it('shows loading while the request is pending', async () => {
    fetchMock.mockImplementation((_request, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal ?? (_request instanceof Request ? _request.signal : undefined);
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    mount('/routes');
    expect(await screen.findByText('Загружаем маршруты…')).toHaveAttribute('role', 'status');
  });
  it('renders exactly two server records, nullable fields, years, distances, activity and map', async () => {
    respond();
    mount('/routes');
    const list = await screen.findByRole('list', { name: 'Список маршрутов' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('12,5 км');
    expect(cards[0]).toHaveTextContent('2025 год');
    expect(cards[0]).toHaveTextContent('Описание из тестового ответа');
    expect(cards[1]).toHaveTextContent('27 км');
    expect(cards[1]).toHaveTextContent('2024 год');
    expect(cards[1]).toHaveTextContent('Неактивный');
    expect(cards[1]).toHaveTextContent('Недоступен для регистрации');
    expect(cards[1]).toHaveTextContent('Карта пока не предоставлена');
    expect(within(cards[0]!).getByRole('link', { name: /Открыть карту/ })).toHaveAttribute('href', `${window.location.origin}/test-assets/map.pdf`);
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/v1/routes');
    expect(request.method).toBe('GET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('shows a genuine empty state', async () => {
    respond([]);
    mount('/routes');
    expect(await screen.findByRole('heading', { name: 'Маршрутов пока нет' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Список маршрутов' })).not.toBeInTheDocument();
  });
  it.each([401, 403, 404, 409, 422, 500])('handles HTTP %i without exposing response content; retries only on request', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: [{ loc: ['query'], msg: 'private-server-detail', type: 'value_error' }] }), { status, headers: { 'Content-Type': 'application/json' } }));
    const { user } = mount('/routes');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(String(status));
    expect(alert).not.toHaveTextContent('private-server-detail');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    respond();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText(fixtures[0]!.name)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('handles a network failure and retries successfully with the keyboard', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { user } = mount('/routes');
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подключиться');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    respond();
    screen.getByRole('button', { name: 'Повторить' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(fixtures[0]!.name)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
