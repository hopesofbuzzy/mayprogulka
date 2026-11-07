import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appRoutes } from '../app/router';
import { sessionStore } from '../shared/session/store';

const routers: ReturnType<typeof createMemoryRouter>[] = [], clients: QueryClient[] = [];
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { sessionStore.logout(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()); sessionStore.logout(); });
function mount(path = '/', role?: string) {
  if (role) sessionStore.login({ access_token: 'synthetic-token', user_id: 7, role }, sessionStore.beginAuthentication());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] }); clients.push(client); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, user: userEvent.setup() };
}

it('opens /about directly with its own title and confirmed identity without API', async () => {
  mount('/about'); await screen.findByRole('heading', { name: 'О Майской прогулке' });
  await waitFor(() => expect(document.title).toBe('О Майской прогулке — Майская прогулка'));
  expect(screen.getByRole('main')).toHaveTextContent('Традиция пешей прогулки в Екатеринбурге с 1984 года.');
  expect(screen.getByRole('main')).toHaveTextContent('один аккаунт позволяет зарегистрировать нескольких участников');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('home has ordered editorial sections and real, distinct destinations', () => {
  mount(); const main = screen.getByRole('main');
  expect(within(main).getAllByRole('region').map(region => within(region).getAllByRole('heading')[0]!.textContent)).toEqual(['Город становитсяближе, когдаидёшь пешком.', 'Выбрать свой путь', 'Как устроено участие', 'Екатеринбург.Пешком. Вместе.', 'Куда отправимся?']);
  for (const [name, path] of [['Посмотреть маршруты', '/routes'], ['Инструкция по шагам', '/how-to'], ['К регистрации участников', '/account/participants/new'], ['О прогулке', '/about'], ['Открыть каталог', '/routes'], ['Остались вопросы?', '/faq']]) expect(within(main).getByRole('link', { name: new RegExp(name!) })).toHaveAttribute('href', path);
  expect(main).toHaveTextContent('Если ссылка на файл доступна');
  expect(main).toHaveTextContent('Онлайн-регистрация её не заменяет'); expect(fetchMock).not.toHaveBeenCalled();
});
it('new content contains only the approved historical year and no dates, prices or contacts', async () => {
  const { router } = mount();
  for (const path of ['/', '/about']) {
    await act(() => router.navigate(path)); await screen.findByRole('heading', { level: 1 });
    const text = screen.getByRole('main').textContent!;
    expect(new Set(text.match(/\b(?:19|20)\d{2}\b/g))).toEqual(new Set(['1984']));
    expect(text).not.toMatch(/\d+[.,]?\d*\s*(?:₽|руб|км)|\d{1,2}[./]\d{1,2}|\+7|@|https?:|mock|beta|preview|заглушк|гарантирован|бесплатн/i);
  }
});
it('header and footer provide all five working public links and active state', async () => {
  const { user } = mount('/about'); await screen.findByRole('heading', { name: 'О Майской прогулке' });
  for (const name of ['Основная навигация', 'Навигация в футере']) {
    const nav = screen.getByRole('navigation', { name });
    expect(within(nav).getAllByRole('link').map(link => link.getAttribute('href')).sort()).toEqual(['/', '/about', '/faq', '/how-to', '/routes']);
    expect(within(nav).getByRole('link', { name: 'О прогулке' })).toHaveAttribute('aria-current', 'page');
  }
  expect(screen.queryByText('Организаторам')).not.toBeInTheDocument();
  expect(document.querySelector('a[href="#"], [aria-disabled="true"]')).toBeNull();
  await user.click(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Главная' }));
  expect(screen.getByRole('main')).toHaveFocus(); expect(fetchMock).not.toHaveBeenCalled();
});
it('decorative vectors cannot receive focus or carry external images', async () => {
  const { router } = mount();
  for (const path of ['/', '/about']) {
    await act(() => router.navigate(path)); await screen.findByRole('heading', { level: 1 });
    for (const svg of screen.getByRole('main').querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true'); expect(svg).toHaveAttribute('focusable', 'false');
      expect(svg.querySelector('[tabindex], a, image, foreignObject')).toBeNull();
    }
  }
});
it('editorial footer is hidden only on workspace path segments, including descendants', async () => {
  const { router } = mount('/staff/typist', 'typist'); await screen.findByRole('heading', { name: 'Рабочее место наборщика' });
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  await act(() => router.navigate('/staff/typist/match')); await screen.findByRole('heading', { name: 'Сопоставление с картой' });
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  await act(() => router.navigate('/account/unknown')); await screen.findByRole('heading', { name: 'Страница не найдена' });
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  await act(() => router.navigate('/accounting')); await screen.findByRole('heading', { name: 'Страница не найдена' });
  expect(screen.getByRole('contentinfo')).toBeInTheDocument(); expect(document.title).toBe('Страница не найдена — Майская прогулка');
  expect(fetchMock).not.toHaveBeenCalled();
});
