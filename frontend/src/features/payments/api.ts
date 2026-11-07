import { api } from '../../shared/api/client';
import { ApiError, StaleSessionError } from '../../shared/api/errors';
import { sessionStore } from '../../shared/session/store';
import type { components } from '../../shared/api/schema';

export type Payment = components['schemas']['PaymentResponse'];
export type PaymentMethod = 'card' | 'sbp';
export class PaymentFailure extends Error {
  constructor(message: string, public readonly uncertain: boolean) { super(message); }
}

export async function payParticipant(id: number, method: PaymentMethod, epoch: number, signal: AbortSignal): Promise<Payment> {
  if (!sessionStore.isCurrentSession(epoch)) throw new StaleSessionError();
  if (!Number.isSafeInteger(id) || !['card', 'sbp'].includes(method)) throw new PaymentFailure('Проверьте участника и выбранный способ оплаты.', false);
  try {
    const { data, response } = await api.POST('/api/v1/participants/{participant_id}/pay', {
      params: { path: { participant_id: id } }, body: { payment_method: method },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!sessionStore.isCurrentSession(epoch)) throw new StaleSessionError();
    if (signal.aborted || response.status !== 200 || !data || typeof data.status !== 'string' || typeof data.payment_id !== 'string'
      || !(data.form_pdf_url === null || data.form_pdf_url === undefined || typeof data.form_pdf_url === 'string')) throw new Error('Unconfirmed payment response');
    return data;
  } catch (error) {
    if (!sessionStore.isCurrentSession(epoch) || error instanceof StaleSessionError) throw new StaleSessionError();
    if (!signal.aborted && error instanceof ApiError && error.status < 500 && error.status !== 408) {
      const messages: Record<number, string> = {
        403: 'Нет доступа к изменению отметки оплаты (403).',
        404: 'Участник или сервис оплаты не найден (404).',
        409: 'Не удалось изменить отметку оплаты из-за конфликта данных (409).',
        422: 'Проверьте параметры оплаты: данные отклонены (422).',
      };
      throw new PaymentFailure(messages[error.status] ?? `Не удалось изменить отметку оплаты (${error.status}).`, false);
    }
    throw new PaymentFailure('Результат операции неизвестен. Статус участника мог измениться. Сначала обновите статус.', true);
  }
}
