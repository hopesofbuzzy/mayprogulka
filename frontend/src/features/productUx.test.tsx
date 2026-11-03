import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appRoutes } from '../app/router';
import { sessionStore } from '../shared/session/store';

const route = { id: 71, name: 'Синтетический маршрут', year: 2026, distance: 12, is_active: true };
const participant = { id: 42, surname: 'Тестов', name: 'Первый', route_name: route.name, form_id: '00042', map_barcode: '000777', payment_status: 'pending', has_started: false, has_finished: false };
const point = { id: 201, route_id: 71, name: 'Синтетический КП', address: 'Синтетический адрес', coordinates: '000 opaque', order: 0, is_start: true, is_finish: true };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const clients: QueryClient[] = [], routers: ReturnType<typeof createMemoryRouter>[] = [], requests: Request[] = [];
const originalModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
let paid = false, unknownStatus = false, unavailable = false;
beforeEach(() => {
  sessionStore.logout(); paid = false; unknownStatus = false; unavailable = false; requests.length = 0;
  vi.stubEnv('MODE', 'test'); vi.stubEnv('VITE_ENABLE_CHECKPOINT_BATCH', 'false');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const request = input as Request, url = new URL(request.url); requests.push(request);
    if (url.pathname === '/api/v1/routes') { if (unavailable) throw new TypeError('Synthetic disconnected transport'); return json({ routes: [route] }); }
    if (url.pathname === '/api/v1/checkpoints') return json({ checkpoints: [point] });
    if (url.pathname === '/api/v1/participants/my') return json({ participants: [{ ...participant, payment_status: unknownStatus ? 'needs_review' : paid ? 'paid' : 'pending' }] });
    if (url.pathname === '/api/v1/participants/42/pay' && request.method === 'POST') { paid = true; return json({ status: 'arbitrary_operation_status', payment_id: 'synthetic-operation', form_pdf_url: null }); }
    throw new Error('Unexpected synthetic API request');
  }));
});
afterEach(() => { cleanup(); sessionStore.logout(); clients.splice(0).forEach(client => client.clear()); routers.splice(0).forEach(router => router.dispose()); vi.unstubAllEnvs(); if (originalModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalModal); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); });
function mount(path: string, role?: string) {
  if (role) sessionStore.login({ access_token: 'synthetic-token', user_id: 7, role }, sessionStore.beginAuthentication());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), router = createMemoryRouter(appRoutes, { initialEntries: [path] }); clients.push(client); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); return userEvent.setup();
}
function humanControls(container: HTMLElement) {
  const text = [...container.querySelectorAll('h1,h2,label,button,summary')].map(node => node.textContent).join(' ');
  expect(text).not.toMatch(/mock only|\bbeta\b|\bpreview\b|\b(API|GET|POST|PUT|DELETE|DTO)\b|form_id|barcode|route_id/i);
}

it.each(['card', 'sbp'])('payment warns before %s submit, associates the notice and retains exact DTO', async method => {
  const user = mount('/account/participants/42/pay', 'participant'); const button = await screen.findByRole('button', { name: 'Продолжить без списания' });
  const notice = screen.getByText('деньги не списываются').closest('p')!; expect(notice).toBeVisible(); expect(notice).toHaveTextContent('Этот шаг меняет статус участника');
  expect(button.closest('form')).toHaveAccessibleDescription('Оплата пока не подключена. Этот шаг меняет статус участника — деньги не списываются.');
  expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Оплата участия'); expect(document.title).toBe('Оплата участия — Майская прогулка');
  humanControls(screen.getByRole('main')); await user.click(screen.getByRole('radio', { name: method === 'card' ? 'Карта' : 'СБП' })); expect(notice).toBeVisible();
  await user.click(button); await screen.findByText('Отмечено в системе');
  const posts = requests.filter(request => request.method === 'POST'); expect(posts).toHaveLength(1); expect(await posts[0]!.clone().json()).toEqual({ payment_method: method });
  expect(screen.getByText('Анкета для печати пока недоступна')).toBeVisible(); expect(screen.queryByText(/Оплата прошла|Деньги получены|Чек отправлен/)).not.toBeInTheDocument();
  const details = screen.getByText('Сведения об операции').closest('details')!; expect(details).not.toHaveAttribute('open');
  await user.click(screen.getByText('Сведения об операции')); expect(within(details).getByText('arbitrary_operation_status')).toBeVisible(); expect(details).toHaveTextContent('synthetic-operation');
});
it('an unsupported payment status remains secondary and cannot authorize a payment', async () => {
  unknownStatus = true; mount('/account/participants/42/pay', 'participant'); await screen.findByText('Требует уточнения');
  expect(screen.getByText('Полученный статус: needs_review')).toBeVisible(); expect(screen.queryByRole('button', { name: 'Продолжить без списания' })).not.toBeInTheDocument(); expect(requests.some(request => request.method === 'POST')).toBe(false);
});
it('public participation instructions make printing conditional and do not promise a start procedure', async () => {
  mount('/how-to'); await screen.findByRole('heading', { name: 'Как участвовать' }); const main = screen.getByRole('main'); humanControls(main);
  expect(main).toHaveTextContent('Если ссылки нет, уточните у организаторов'); expect(main).toHaveTextContent('Если вы смогли распечатать анкету'); expect(main).toHaveTextContent('Порядок выдачи и оформления на вашем старте уточните'); expect(main).not.toHaveTextContent(/form_id|barcode/); expect(requests).toHaveLength(0);
});
it('FAQ disclosures retain payment and PDF limitations in product language', async () => {
  const user = mount('/faq'); await screen.findByRole('heading', { name: 'Вопросы и ответы' }); humanControls(screen.getByRole('main'));
  await user.click(screen.getByText('Списываются ли деньги при оплате?')); expect(screen.getByText(/Действие в личном кабинете меняет отметку участника/)).toBeVisible();
  await user.click(screen.getByText('Как получить и распечатать анкету?')); expect(screen.getByText(/Если в разделе оплаты доступна ссылка/)).toBeVisible(); expect(screen.getByRole('main')).not.toHaveTextContent(/form_id|barcode/);
});
it('checkpoint form keeps exact IDs and useful risk language without API instructions', async () => {
  const user = mount('/staff/routes/71/checkpoints', 'admin'); await user.click(await screen.findByRole('button', { name: /Удалить КП/ })); const modal = screen.getByRole('dialog'); humanControls(modal);
  const input = within(modal).getByLabelText('Введите ID КП 201'); fireEvent.change(input, { target: { value: '71' } }); expect(within(modal).getByRole('button', { name: 'Подтвердить удаление КП' })).toBeDisabled();
  expect(modal).toHaveTextContent('Последствия удаления и сохранность истории требуют согласования'); expect(requests.some(request => request.method !== 'GET')).toBe(false);
});
it('route editor keeps immutable year information and concurrent-edit warning', async () => {
  const user = mount('/staff/routes', 'admin'); await user.click(await screen.findByRole('button', { name: /Изменить/ })); const modal = screen.getByRole('dialog'); humanControls(modal);
  expect(modal).toHaveTextContent('Год и схему маршрута здесь изменить нельзя'); expect(modal).toHaveTextContent('Другой сотрудник мог изменить маршрут');
});
it('isolated batch component has product copy while gate is still mandatory', async () => {
  vi.stubEnv('MODE', 'e2e'); vi.stubEnv('VITE_ENABLE_CHECKPOINT_BATCH', 'true'); const user = mount('/staff/routes/71/checkpoints', 'admin'); await user.click(await screen.findByRole('button', { name: 'Добавить несколько КП' }));
  const modal = screen.getByRole('dialog'); humanControls(modal); expect(modal).toHaveTextContent('Партия может сохраниться частично'); expect(modal).toHaveTextContent('точные созданные строки могут быть неизвестны'); expect(requests.some(request => request.method !== 'GET')).toBe(false);
});
it('typist uses distinct human identifiers and preserves barcode zeros without submitting on Enter', async () => {
  const user = mount('/staff/typist/match', 'typist'); await screen.findByRole('heading', { name: 'Сопоставление с картой' }); humanControls(screen.getByRole('main'));
  const form = screen.getByLabelText('Номер анкеты'), barcode = screen.getByLabelText('Штрихкод физической карты'); await user.type(form, '00001{Enter}'); expect(barcode).toHaveFocus(); await user.type(barcode, '000002{Enter}'); expect(form).toHaveValue('00001'); expect(barcode).toHaveValue('000002'); await user.click(screen.getByRole('button', { name: 'Проверить пару' })); expect(screen.getByRole('region', { name: 'Проверка пары' })).toHaveTextContent('сохранённую связь здесь нельзя'); expect(requests).toHaveLength(0);
});
it('unavailable API is a real error state without a replacement catalog', async () => {
  unavailable = true; mount('/routes'); await screen.findByRole('heading', { name: 'Маршруты пока недоступны' }); expect(screen.queryByRole('list', { name: 'Список маршрутов' })).not.toBeInTheDocument(); expect(screen.queryByText(route.name)).not.toBeInTheDocument(); expect(requests).toHaveLength(1);
  await act(async () => window.dispatchEvent(new Event('online'))); expect(requests).toHaveLength(1);
});
