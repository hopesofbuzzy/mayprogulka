import { queryOptions } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { ApiError, StaleSessionError } from '../../shared/api/errors';
import { sessionStore } from '../../shared/session/store';
import type { MatchInput, MatchResult, PaperInput, PaperResult, UnlinkedMap } from './model';

export class StaffFailure extends Error {
  constructor(message: string, public readonly uncertain = false, public readonly details: unknown = undefined) { super(message); }
}
export const currentTypist = (epoch: number) => sessionStore.isCurrentSession(epoch) && sessionStore.getSnapshot().session?.role === 'typist';
function authorize(epoch: number) {
  if (!sessionStore.isCurrentSession(epoch)) throw new StaleSessionError();
  if (!currentTypist(epoch)) throw new StaffFailure('Нет доступа: требуется роль наборщика.');
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const strings = (value: Record<string, unknown>, names: string[]) => names.every(name => typeof value[name] === 'string');
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
export function staffReadError(error: Error): string {
  if (error instanceof ApiError) return error.status === 403 ? 'Сервер запретил доступ к непривязанным картам (403). Права роли требуют проверки ответственным.' : `Не удалось загрузить выборку карт (${error.status}).`;
  return error instanceof StaffFailure ? error.message : 'Не удалось загрузить выборку карт. Проверьте подключение и повторите загрузку.';
}
export function unlinkedOptions(epoch: number, limit = 100) {
  return queryOptions({
    queryKey: ['private', 'typist', epoch, 'unlinked', limit] as const, meta: { private: true },
    queryFn: async ({ signal }): Promise<UnlinkedMap[]> => {
      authorize(epoch);
      const { data, response } = await api.GET('/api/v1/typist/unlinked', { params: { query: { limit } }, signal: timeout(signal) });
      authorize(epoch);
      if (response.status !== 200 || !data || !Array.isArray(data.maps) || !data.maps.every(value => object(value) && integer(value.id) && typeof value.barcode === 'string' && (value.participant_id === undefined || value.participant_id === null || integer(value.participant_id)))) throw new StaffFailure('Сервис вернул некорректную выборку карт.');
      return data.maps;
    },
    retry: false, networkMode: 'always', staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
}
function failure(error: unknown, epoch: number, signal: AbortSignal): never {
  authorize(epoch);
  if (!signal.aborted && error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
    const context: Record<number, string> = { 400: 'Сервер отклонил запрос', 403: 'Нет права на действие', 404: 'Запись или сервис не найдены', 409: 'Конфликт записи или привязки. Исправление и отвязка через текущий API недоступны', 422: 'Проверьте поля: сервер отклонил данные' };
    throw new StaffFailure(`${context[error.status] ?? 'Сервер отклонил запрос'} (${error.status}).`, false, error.details);
  }
  throw new StaffFailure('Результат неизвестен. Запись или привязка могла уже сохраниться. Перед повтором обратитесь к ответственному или проверьте доступный серверный источник.', true);
}
export async function createPaper(body: PaperInput, epoch: number, signal: AbortSignal): Promise<PaperResult> {
  authorize(epoch);
  try {
    const { data, response } = await api.POST('/api/v1/typist/paper-form', { body, signal: timeout(signal) });
    authorize(epoch);
    if (signal.aborted || response.status !== 201 || !object(data) || !integer(data.participant_id) || !strings(data, ['form_id', 'payment_status'])) throw new Error('Unconfirmed paper result');
    return data as PaperResult;
  } catch (error) { return failure(error, epoch, signal); }
}
export async function matchMap(body: MatchInput, epoch: number, signal: AbortSignal): Promise<MatchResult> {
  authorize(epoch);
  try {
    const { data, response } = await api.POST('/api/v1/typist/match', { body, signal: timeout(signal) });
    authorize(epoch);
    if (signal.aborted || response.status !== 200 || !object(data) || !integer(data.participant_id) || !strings(data, ['status', 'barcode', 'participant_name', 'message']) || data.barcode !== body.barcode) throw new Error('Unconfirmed match result');
    return data as MatchResult;
  } catch (error) { return failure(error, epoch, signal); }
}
