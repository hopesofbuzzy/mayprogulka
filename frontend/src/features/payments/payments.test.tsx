import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/router';
import { sessionStore } from '../../shared/session/store';
import { safeReturnTo } from '../auth/redirect';
import { paymentRecordOptions } from './state';

vi.mock('./pdfPolicy', () => ({ approvedFormPdfPaths: ['/test-approved/forms/00123.pdf'] }));
const pdf = '/test-approved/forms/00123.pdf';
const records = [
  { id: 42, form_id: '00042', surname: 'Тестов', name: 'Первый', route_name: 'Тестовая лесная тропа', payment_status: 'pending', has_started: false, has_finished: false, map_barcode: '000777' },
  { id: 77, form_id: '00077', surname: 'Тестова', name: 'Вторая', route_name: 'Тестовый городской маршрут', payment_status: 'pending', has_started: false, has_finished: false, map_barcode: null },
];
const response = { status: 'server-arbitrary-status', payment_id: 'test-operation-only', form_pdf_url: null };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const transport = vi.fn<typeof fetch>();
let mine: () => Promise<Response>;
let post: (request: Request) => Promise<Response>;
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
function login(user = 7) { sessionStore.login({ access_token: `test-only-${user}`, user_id: user, role: 'participant' }, sessionStore.beginAuthentication()); }
function calls(method: string) { return transport.mock.calls.filter(([input]) => (input as Request).method === method); }
beforeEach(() => {
  sessionStore.logout(); login(); transport.mockReset();
  mine = async () => json({ participants: records });
  post = async () => json(response);
  transport.mockImplementation(async input => {
    const request = input as Request, url = new URL(request.url);
    if (url.pathname === '/api/v1/participants/my') { expect(url.search).toBe(''); return mine(); }
    if (url.pathname === '/api/v1/participants/42/pay') return post(request);
    if (url.pathname === '/api/v1/auth/login') return json({ access_token: 'test-login-only', user_id: 7, role: 'participant' });
    throw new Error('Unexpected test API path');
  });
  vi.stubGlobal('fetch', transport);
});
afterEach(() => { cleanup(); sessionStore.logout(); clients.splice(0).forEach(client => client.clear()); routers.splice(0).forEach(router => router.dispose()); });
function mount(path = '/account/participants/42/pay') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  clients.push(client); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router, user: userEvent.setup() };
}
async function ready() {
  const context = mount();
  await screen.findByRole('button', { name: 'Выполнить тестовую оплату' });
  return context;
}
async function submit() {
  const context = await ready();
  await context.user.click(screen.getByRole('button', { name: 'Выполнить тестовую оплату' }));
  return context;
}
describe('test payment routing and identity', () => {
  it('protects the direct URL, sends no private GET as a guest and safely returns after login', async () => {
    sessionStore.logout(); const { user, router } = mount();
    await screen.findByRole('heading', { name: 'Вход' });
    expect(transport).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Имя пользователя'), { target: { value: 'test-only' } });
    fireEvent.change(screen.getByLabelText('Пароль', { exact: true }), { target: { value: 'example-only-password' } });
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('button', { name: 'Выполнить тестовую оплату' });
    expect(router.state.location.pathname).toBe('/account/participants/42/pay');
  });
  it('links from the own participant card and shows server identity and test instructions', async () => {
    const { user } = mount('/account/participants/42');
    await user.click(await screen.findByRole('link', { name: 'Тестовая оплата' }));
    await screen.findByRole('button', { name: 'Выполнить тестовую оплату' });
    expect(screen.getByRole('heading', { name: 'Тестов Первый' })).toBeInTheDocument();
    expect(screen.getByText('Номер анкеты: 00042')).toBeInTheDocument();
    expect(screen.getByText('Тестовая оплата — без списания денег')).toBeInTheDocument();
    expect(screen.getByText(/После обновления страницы или повторного входа восстановить/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it.each(['invalid', '9007199254740992', '999'])('never posts for an invalid or absent ID %s', async id => {
    mount(`/account/participants/${id}/pay`);
    await screen.findByRole('heading', { name: id === '999' ? 'Участник не найден среди ваших записей' : 'Некорректный номер участника' });
    expect(calls('POST')).toHaveLength(0);
    if (id !== '999') expect(calls('GET')).toHaveLength(0);
  });
  it.each(['empty', 'failure'])('blocks POST with GET %s', async value => {
    mine = async () => value === 'empty' ? json({ participants: [] }) : json({}, 500);
    mount();
    await screen.findByRole('heading', { name: value === 'empty' ? 'Участник не найден среди ваших записей' : 'Участники пока недоступны' });
    expect(screen.queryByRole('button', { name: 'Выполнить тестовую оплату' })).not.toBeInTheDocument();
    expect(calls('POST')).toHaveLength(0);
  });
  it.each(['paid', 'review'])('does not offer a POST for GET payment_status %s', async status => {
    mine = async () => json({ participants: [{ ...records[0], payment_status: status }] });
    mount();
    await screen.findByRole('heading', { name: 'Тестов Первый' });
    expect(screen.queryByRole('button', { name: 'Выполнить тестовую оплату' })).not.toBeInTheDocument();
    if (status === 'review') expect(screen.getByText('Неизвестный статус: review')).toBeInTheDocument();
    else expect(screen.getByText(/Ссылка на анкету могла выдаваться/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Открыть анкету для печати' })).not.toBeInTheDocument();
    expect(calls('POST')).toHaveLength(0);
  });
  it.each(['/account/participants/42/pay?tab=status#operation', '/account/participants/42/pay'])('allows the precise payment return %s', value => expect(safeReturnTo(value)).toBe(value));
  it.each(['https://evil.example', '//evil.example/account/participants/42/pay', '/account/participants/new/pay', '/account/participants/42/pay/next', '/account/participants/42/pay%5c', '/account/participants/42/pay?x=%0a', '/account/participants/42/pay?x=%250d', '/account/participants/42/pay?x=%25250a', '/account/participants/9007199254740992/pay'])('rejects an unsafe payment return %#', value => expect(safeReturnTo(value)).toBe('/account'));
});
describe('typed POST and authoritative verification', () => {
  it.each(['card', 'sbp'] as const)('sends exactly the selected %s DTO to participant 42, with one POST and no optimistic family changes', async method => {
    let resolve!: (value: Response) => void;
    post = () => new Promise(done => { resolve = done; });
    const { user, client } = await ready();
    await user.click(screen.getByRole('radio', { name: method === 'card' ? 'Карта (тест)' : 'СБП (тест)' }));
    await user.dblClick(screen.getByRole('button', { name: 'Выполнить тестовую оплату' }));
    expect(calls('POST')).toHaveLength(1);
    const request = calls('POST')[0]![0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/v1/participants/42/pay');
    expect(await request.clone().json()).toEqual({ payment_method: method });
    expect(request.headers.get('Authorization')).toBe('Bearer test-only-7');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Выполняем…' })).toBeDisabled();
    expect(client.getQueryData(['private', 'participants', sessionStore.getCredentials()!.epoch])).toEqual(records);
    mine = async () => json({ participants: [{ ...records[0], payment_status: 'paid' }, records[1]] });
    await act(async () => { resolve(json(response)); });
    await screen.findByText('Оплачено');
    expect(calls('GET')).toHaveLength(2);
    const actual = client.getQueryData<typeof records>(['private', 'participants', sessionStore.getCredentials()!.epoch]);
    expect(actual?.[1]).toEqual(records[1]);
    expect(screen.getByText('server-arbitrary-status')).toBeInTheDocument();
    expect(screen.getByText(/Технический номер операции: test-operation-only/)).toBeInTheDocument();
    expect(screen.getByText('Анкета пока недоступна')).toBeInTheDocument();
  });
  it('blocks repeated Enter while POST is pending', async () => {
    let resolve!: (value: Response) => void;
    post = () => new Promise(done => { resolve = done; });
    const { user } = await ready();
    screen.getByRole('button', { name: 'Выполнить тестовую оплату' }).focus();
    await user.keyboard('{Enter}{Enter}{Enter}');
    expect(calls('POST')).toHaveLength(1);
    await act(async () => { resolve(json(response)); });
    await screen.findByText('Анкета пока недоступна');
  });
  it.each(['pending', 'review', 'failure', 'missing'])('keeps POST evidence but does not claim paid after verification %s, and repeats GET only', async result => {
    const { user } = await ready();
    mine = async () => result === 'failure' ? json({}, 500) : json({ participants: result === 'missing' ? [] : [{ ...records[0], payment_status: result }] });
    await user.click(screen.getByRole('button', { name: 'Выполнить тестовую оплату' }));
    await screen.findByText(/Операция принята сервером, но актуальный статус ещё не подтверждён/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Обновить статус' })).toBeEnabled());
    expect(screen.queryByText('Оплачено', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Тестов Первый' })).toBeInTheDocument();
    mine = async () => json({ participants: [{ ...records[0], payment_status: 'paid' }] });
    await user.click(screen.getByRole('button', { name: 'Обновить статус' }));
    await screen.findByText('Оплачено');
    expect(calls('POST')).toHaveLength(1); expect(calls('GET')).toHaveLength(3);
    expect(screen.queryByText(/актуальный статус ещё не подтверждён/)).not.toBeInTheDocument();
  });
});
describe('uncertain and explicit failures', () => {
  it.each([408, 500, 502, 'network', 'timeout', 'abort', 'invalidJson', 'malformed', 'missingStatus', 'badTypes', 'badUrlType', 'wrongStatus'])('keeps POST %s uncertain and offers only a separate GET', async failure => {
    post = async () => {
      if (failure === 'network') throw new TypeError('offline');
      if (failure === 'timeout' || failure === 'abort') throw new DOMException('interrupted', failure === 'timeout' ? 'TimeoutError' : 'AbortError');
      if (failure === 'invalidJson') return new Response('{', { headers: { 'Content-Type': 'application/json' } });
      if (failure === 'malformed') return json({ status: 'paid' });
      if (failure === 'missingStatus') return json({ payment_id: 'test-only' });
      if (failure === 'badTypes') return json({ status: 'paid', payment_id: 12 });
      if (failure === 'badUrlType') return json({ ...response, form_pdf_url: 123 });
      if (failure === 'wrongStatus') return json(response, 201);
      return json({ detail: 'do-not-expose-private-error' }, failure as number);
    };
    const { user } = await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Результат тестовой операции неизвестен');
    expect(screen.getByRole('heading', { name: 'Тестов Первый' })).toBeInTheDocument();
    expect(screen.getByText('Номер анкеты: 00042')).toBeInTheDocument();
    expect(calls('POST')).toHaveLength(1); expect(calls('GET')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Выполнить тестовую оплату' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('do-not-expose-private-error');
    await user.click(screen.getByRole('button', { name: 'Обновить статус' }));
    await waitFor(() => expect(calls('GET')).toHaveLength(2));
    expect(screen.queryByText('Оплачено', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Даже статус «Ожидает оплаты» не доказывает');
    expect(calls('POST')).toHaveLength(1);
  });
  it.each([403, 404, 409, 422])('handles explicit POST %s without logout, raw details or another POST', async status => {
    post = async () => json({ detail: 'do-not-echo-input' }, status);
    const { user } = await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(`(${status})`);
    expect(document.body).not.toHaveTextContent('do-not-echo-input');
    expect(sessionStore.getSnapshot().session?.userId).toBe(7);
    await user.click(screen.getByRole('button', { name: 'Обновить статус' }));
    await waitFor(() => expect(calls('GET')).toHaveLength(2));
    expect(calls('POST')).toHaveLength(1);
    expect(screen.queryByText('Оплачено', { exact: true })).not.toBeInTheDocument();
  });
  it('expires the current session on a payment 401', async () => {
    post = async () => json({}, 401);
    await submit();
    await screen.findByRole('heading', { name: 'Вход' });
    expect(sessionStore.getCredentials()).toBeNull();
    expect(calls('POST')).toHaveLength(1);
  });
});
describe('conditional PDF and private operation memory', () => {
  it.each([null, undefined, ''])('has no fake PDF action for an absent URL %#', async url => {
    post = async () => json({ ...response, form_pdf_url: url });
    await submit();
    await screen.findByText('Анкета пока недоступна');
    expect(screen.queryByRole('link', { name: 'Открыть анкету для печати' })).not.toBeInTheDocument();
  });
  it('shows only an explicitly approved URL with noreferrer, without opening it or carrying Bearer', async () => {
    post = async () => json({ ...response, form_pdf_url: pdf });
    const { user, router, client } = await submit();
    const link = await screen.findByRole('link', { name: 'Открыть анкету для печати' });
    expect(link).toHaveAttribute('href', window.location.origin + pdf);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(link.getAttribute('href')).not.toContain('test-only-7');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Обновить статус' })).toBeEnabled());
    await user.click(screen.getByRole('link', { name: 'В личный кабинет' }));
    await screen.findByRole('heading', { name: 'Личный кабинет' });
    await act(() => router.navigate(-1));
    await screen.findByRole('link', { name: 'Открыть анкету для печати' });
    expect(calls('POST')).toHaveLength(1);
    expect(client.getQueryCache().getAll().find(query => query.queryKey[1] === 'payment')?.meta?.private).toBe(true);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it.each(['https://evil.example/00123.pdf', 'javascript:alert(1)', 'data:application/pdf,a', 'https://name:pass@localhost/00123.pdf', '/unapproved.pdf'])('blocks unsafe PDF %# without exposing the raw URL', async url => {
    post = async () => json({ ...response, form_pdf_url: url });
    await submit();
    await screen.findByText('Адрес анкеты требует уточнения');
    expect(screen.queryByRole('link', { name: 'Открыть анкету для печати' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(url);
  });
  it.each([200, 401])('discards deferred payment %s from A after login B, keeping B authenticated', async status => {
    let resolve!: (value: Response) => void;
    post = () => new Promise(done => { resolve = done; });
    const { client } = await submit();
    mine = async () => json({ participants: [{ ...records[0], surname: 'Другой', name: 'Аккаунт' }] });
    await act(async () => { login(9); });
    await screen.findByRole('heading', { name: 'Другой Аккаунт' });
    await act(async () => { resolve(json({ ...response, payment_id: 'old-secret-id', form_pdf_url: pdf }, status)); });
    expect(document.body).not.toHaveTextContent('Тестов Первый');
    expect(document.body).not.toHaveTextContent('old-secret-id');
    expect(screen.queryByRole('link', { name: 'Открыть анкету для печати' })).not.toBeInTheDocument();
    expect(sessionStore.getSnapshot().session?.userId).toBe(9);
    expect(client.getQueryCache().getAll().every(query => query.queryKey[0] !== 'private' || query.queryKey[2] === sessionStore.getCredentials()!.epoch)).toBe(true);
    expect(calls('POST')).toHaveLength(1);
  });
  it('drops the PDF and technical result immediately while B GET is still loading, and ignores late A GET', async () => {
    let resolveA!: (value: Response) => void, resolveB!: (value: Response) => void;
    const { user, client } = await ready();
    mine = () => new Promise(done => { resolveA = done; });
    post = async () => json({ ...response, form_pdf_url: pdf });
    await user.click(screen.getByRole('button', { name: 'Выполнить тестовую оплату' }));
    await screen.findByRole('link', { name: 'Открыть анкету для печати' });
    await waitFor(() => expect(calls('GET')).toHaveLength(2));
    mine = () => new Promise(done => { resolveB = done; });
    await act(async () => { sessionStore.logout(); login(9); });
    expect(screen.queryByRole('link', { name: 'Открыть анкету для печати' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('test-operation-only');
    expect(document.body).not.toHaveTextContent('Тестов Первый');
    await act(async () => { resolveB(json({ participants: [{ ...records[0], surname: 'Другой', name: 'Аккаунт' }] })); resolveA(json({ participants: [{ ...records[0], payment_status: 'paid' }] })); });
    await screen.findByRole('heading', { name: 'Другой Аккаунт' });
    expect(client.getQueryData(['private', 'participants', sessionStore.getCredentials()!.epoch])).toEqual([{ ...records[0], surname: 'Другой', name: 'Аккаунт' }]);
    expect(calls('POST')).toHaveLength(1);
  });
  it('keeps the uncertainty marker after leaving during POST and back/forward; a late reply cannot restore a PDF', async () => {
    let resolve!: (value: Response) => void;
    post = () => new Promise(done => { resolve = done; });
    const { user, router, client } = await submit();
    const request = calls('POST')[0]![0] as Request;
    await user.click(screen.getByRole('link', { name: /К карточке участника/ }));
    await screen.findByRole('link', { name: 'Тестовая оплата' });
    expect(request.signal.aborted).toBe(true);
    const state = client.getQueryData(paymentRecordOptions(sessionStore.getCredentials()!.epoch, 42).queryKey);
    expect(state?.phase).toBe('uncertain');
    await act(() => router.navigate(-1));
    await screen.findByText(/Запрос прерван на устройстве/);
    await act(async () => { resolve(json({ ...response, form_pdf_url: pdf })); });
    expect(screen.queryByRole('link', { name: 'Открыть анкету для печати' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Выполнить тестовую оплату' })).not.toBeInTheDocument();
    await act(() => router.navigate(1));
    await screen.findByRole('link', { name: 'Тестовая оплата' });
    expect(calls('POST')).toHaveLength(1);
  });
  it('never pays again to recover a PDF after logout and a new paid session', async () => {
    post = async () => json({ ...response, form_pdf_url: pdf });
    const { client } = await submit();
    await screen.findByRole('link', { name: 'Открыть анкету для печати' });
    mine = async () => json({ participants: [{ ...records[0], payment_status: 'paid' }] });
    await act(async () => { sessionStore.logout(); login(); });
    await screen.findByText('Оплачено');
    expect(screen.queryByRole('link', { name: 'Открыть анкету для печати' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Выполнить тестовую оплату' })).not.toBeInTheDocument();
    expect(client.getQueryCache().getAll().filter(query => query.queryKey[1] === 'payment')).toHaveLength(1);
    expect(calls('POST')).toHaveLength(1);
  });
  it('isolates payment results by participant within the same session', async () => {
    post = async () => json({ ...response, form_pdf_url: pdf });
    const { router } = await submit();
    await screen.findByRole('link', { name: 'Открыть анкету для печати' });
    await act(() => router.navigate('/account/participants/77/pay'));
    await screen.findByRole('button', { name: 'Выполнить тестовую оплату' });
    expect(screen.getByRole('heading', { name: 'Тестова Вторая' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Открыть анкету для печати' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('test-operation-only');
    expect(calls('POST')).toHaveLength(1);
  });
});
