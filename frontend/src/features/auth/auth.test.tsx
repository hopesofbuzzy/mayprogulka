import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/router';
import { sessionStore } from '../../shared/session/store';
import { validateAuth } from './api';
import { safeReturnTo } from './redirect';

const transport = vi.fn<typeof fetch>();
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
const tokenReply = (user = 11) => ({ access_token: `test-only-${user}`, user_id: user, role: 'participant' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  sessionStore.logout(); transport.mockReset();
  vi.stubGlobal('fetch', ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (url.pathname === '/api/v1/participants/my') return Promise.resolve(json({ participants: [] }));
    return transport(input, init);
  }) satisfies typeof fetch);
});
afterEach(() => {
  cleanup();
  sessionStore.logout();
  clients.splice(0).forEach(client => client.clear());
  routers.splice(0).forEach(router => router.dispose());
});

function mount(path = '/login', state: unknown = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(appRoutes, { initialEntries: [state ? { pathname: path, state } : path] });
  clients.push(client); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router, user: userEvent.setup() };
}

async function fillLogin(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Вход' });
  await user.type(screen.getByLabelText('Имя пользователя'), 'test_walker');
  await user.type(screen.getByLabelText('Пароль', { exact: true }), 'example-pass-123');
}

async function fillSignup(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Создать аккаунт' });
  await user.type(screen.getByLabelText('Имя пользователя'), 'test_walker');
  await user.type(screen.getByLabelText('Email'), 'walker@example.test');
  await user.type(screen.getByLabelText('Пароль', { exact: true }), 'example-pass-123');
  await user.type(screen.getByLabelText('Повторите пароль'), 'example-pass-123');
}

describe('account forms', () => {
  it('registers with exactly the contract DTO, logs in on 201 and opens the account without auth/me', async () => {
    transport.mockResolvedValue(json(tokenReply(), 201));
    const { user } = mount('/signup');
    await fillSignup(user);
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(await screen.findByRole('heading', { name: 'Личный кабинет' })).toBeInTheDocument();
    const request = transport.mock.calls[0]![0] as Request;
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/v1/auth/register');
    expect(await request.json()).toEqual({ username: 'test_walker', email: 'walker@example.test', password: 'example-pass-123' });
    expect(request.headers.has('Authorization')).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(sessionStore.getSnapshot().session?.userId).toBe(11);
    expect(await screen.findByRole('heading', { name: 'Вы пока не зарегистрировали участников' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Добавить участника/ })[0]).toHaveAttribute('href', '/account/participants/new');
    expect(screen.queryByRole('button', { name: /Оплатить/ })).not.toBeInTheDocument();
  });
  it('validates required fields, email, password length and confirmation without a request', async () => {
    const { user } = mount('/signup');
    await screen.findByRole('heading', { name: 'Создать аккаунт' });
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(screen.getByLabelText('Имя пользователя')).toHaveFocus();
    expect(screen.getByText('Введите корректный email.')).toBeInTheDocument();
    expect(screen.getByText('Пароль должен содержать от 6 до 72 символов.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Имя пользователя'), { target: { value: 'test_walker' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalid-address' } });
    fireEvent.change(screen.getByLabelText('Пароль', { exact: true }), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'other' } });
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(screen.getByText('Пароли не совпадают.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(transport).not.toHaveBeenCalled();
  });
  it('maps structured 422 to the email field, keeps values and never renders raw server messages', async () => {
    transport.mockResolvedValue(json({ detail: [{ loc: ['body', 'email'], type: 'value_error', msg: '<server-trace>private detail</server-trace>', input: 'not-for-display' }] }, 422));
    const { user } = mount('/signup');
    await fillSignup(user);
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте введённые данные.');
    expect(screen.getByLabelText('Email')).toHaveValue('walker@example.test');
    expect(screen.getByLabelText('Пароль', { exact: true })).toHaveValue('example-pass-123');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Сервер отклонил email. Проверьте адрес электронной почты.');
    expect(document.body).not.toHaveTextContent('server-trace');
    expect(document.body).not.toHaveTextContent('not-for-display');
    expect(sessionStore.getSnapshot().session).toBeNull();
  });
  it('does not treat registration HTTP 200 as a confirmed registration', async () => {
    transport.mockResolvedValue(json(tokenReply(), 200));
    const { user } = mount('/signup');
    await fillSignup(user);
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Вход не подтверждён');
    expect(sessionStore.getSnapshot().session).toBeNull();
  });
  it('blocks duplicate POST while waiting; login contains username, not email', async () => {
    let resolve!: (value: Response) => void;
    transport.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const { user } = mount();
    await fillLogin(user);
    await user.dblClick(screen.getByRole('button', { name: 'Войти' }));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Входим…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Ждём ответ сервера');
    const request = transport.mock.calls[0]![0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/v1/auth/login');
    expect(await request.json()).toEqual({ username: 'test_walker', password: 'example-pass-123' });
    await act(async () => { resolve(json(tokenReply())); });
    expect(await screen.findByRole('heading', { name: 'Личный кабинет' })).toBeInTheDocument();
  });
  it.each([400, 401, 403, 422, 500, 502])('handles login HTTP %i, preserves input, and only retries on manual submit', async (status) => {
    transport.mockResolvedValueOnce(json({ detail: [{ loc: ['body', 'username'], type: 'value_error', msg: 'unsafe raw detail' }] }, status));
    const { user } = mount();
    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('unsafe raw detail');
    if (status === 403) expect(alert).toHaveTextContent('Нет доступа');
    if (status === 400 || status === 401) expect(alert).toHaveTextContent('Неверное имя пользователя или пароль');
    expect(screen.getByLabelText('Имя пользователя')).toHaveValue('test_walker');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(sessionStore.getSnapshot().session).toBeNull();
    transport.mockResolvedValueOnce(json(tokenReply()));
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('heading', { name: 'Личный кабинет' })).toBeInTheDocument();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('handles a network failure, preserves input and allows a manual retry', async () => {
    transport.mockRejectedValueOnce(new TypeError('network unavailable'));
    const { user } = mount();
    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подключиться');
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockResolvedValueOnce(json(tokenReply()));
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('heading', { name: 'Личный кабинет' })).toBeInTheDocument();
  });
  it('rejects a malformed success without publishing a session', async () => {
    transport.mockResolvedValue(json({ user_id: 3, role: 'participant' }));
    const { user } = mount();
    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Вход не подтверждён');
    expect(sessionStore.getSnapshot().session).toBeNull();
  });
});

describe('guard, logout and private cache', () => {
  it('redirects a guest and returns to the original internal account URL after login', async () => {
    transport.mockResolvedValue(json(tokenReply()));
    const { user, router } = mount('/account?section=overview#start');
    await fillLogin(user);
    expect(router.state.location.pathname).toBe('/login');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('heading', { name: 'Личный кабинет' })).toBeInTheDocument();
    expect(router.state.location.pathname + router.state.location.search + router.state.location.hash).toBe('/account?section=overview#start');
  });
  it('rejects external redirect state and clears private cache on logout and next login', async () => {
    transport.mockResolvedValue(json(tokenReply()));
    const { user, client, router } = mount('/login', { returnTo: 'https://outside.example/steal' });
    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('heading', { name: 'Личный кабинет' });
    expect(router.state.location.pathname).toBe('/account');
    client.setQueryData(['private', 11, 'example'], { note: 'old-account-test-data' });
    client.setQueryDefaults(['sensitive-example'], { meta: { private: true } });
    client.setQueryData(['sensitive-example'], { note: 'also-private' });
    client.setQueryData(['routes'], { public: true });
    let resolve!: (value: string) => void;
    const inFlight = client.fetchQuery({ queryKey: ['private', 'pending'], queryFn: ({ signal }) => {
      void signal;
      return new Promise<string>(done => { resolve = done; });
    } }).catch(() => undefined);
    await user.click(within(screen.getByRole('banner')).getAllByRole('button', { name: 'Выйти' }).at(-1)!);
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
    expect(sessionStore.getCredentials()).toBeNull();
    expect(client.getQueryData(['private', 11, 'example'])).toBeUndefined();
    expect(client.getQueryData(['sensitive-example'])).toBeUndefined();
    expect(client.getQueryData(['routes'])).toEqual({ public: true });
    resolve('late-old-account-data');
    await inFlight;
    expect(client.getQueryData(['private', 'pending'])).toBeUndefined();
    await act(() => router.navigate('/account'));
    await screen.findByRole('heading', { name: 'Вход' });
    transport.mockResolvedValue(json(tokenReply(22)));
    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('heading', { name: 'Личный кабинет' });
    expect(sessionStore.getSnapshot().session?.userId).toBe(22);
    expect(document.body).not.toHaveTextContent('old-account-test-data');
  });
  it('a confirmed protected 401 clears the session and redirects the account guard', async () => {
    sessionStore.login(tokenReply(), sessionStore.beginAuthentication());
    const { client } = mount('/account');
    await screen.findByRole('heading', { name: 'Личный кабинет' });
    // The direct transport call below bypasses userEvent's act boundary. Finish
    // mounting the lazy route/provider before seeding and expiring its cache.
    await act(() => Promise.resolve());
    client.setQueryData(['private', 'protected-example'], 'test-data');
    transport.mockResolvedValue(json({}, 401));
    const { api } = await import('../../shared/api/client');
    await act(async () => { await api.GET('/api/v1/auth/me').catch(() => undefined); });
    await screen.findByRole('heading', { name: 'Вход' });
    expect(client.getQueryData(['private', 'protected-example'])).toBeUndefined();
    expect(screen.getByRole('status')).toHaveTextContent('Сессия завершена');
  });
  it('leaving the form aborts it; a late auth success cannot sign in', async () => {
    let resolve!: (value: Response) => void;
    transport.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const { user, router } = mount();
    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await act(() => router.navigate('/'));
    await act(async () => { resolve(json(tokenReply())); });
    await waitFor(() => expect(sessionStore.getSnapshot().session).toBeNull());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Город становится');
  });
});

describe('local validation and redirect boundaries', () => {
  it.each([5, 73])('rejects signup password length %i', (length) => {
    const password = 'x'.repeat(length);
    expect(validateAuth('signup', { username: 'test', email: 'test@example.test', password, confirmation: password }).password).toBeDefined();
  });
  it.each([6, 72])('accepts the contract password boundary %i', (length) => {
    const password = 'x'.repeat(length);
    expect(validateAuth('signup', { username: 'test', email: 'test@example.test', password, confirmation: password })).toEqual({});
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/%2f%2fevil.example', 'javascript:alert(1)', '/login', '/staff/admin', '/\n/evil.example'])('blocks unsafe or unsupported return URL %s', (url) => {
    expect(safeReturnTo(url)).toBe('/account');
  });
  it('keeps supported internal paths', () => { expect(safeReturnTo('/routes')).toBe('/routes'); });
});
