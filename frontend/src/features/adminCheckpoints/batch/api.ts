import { api } from '../../../shared/api/client';
import { ApiError } from '../../../shared/api/errors';
import { AdminFailure, requireAdmin } from '../../adminShared/api';
import { batchEnabled, isBatchResponse, safeMessage } from './model';
import type { BatchRequest, Summary } from './model';

export async function createBatch(body: BatchRequest, routeId: number, epoch: number, signal: AbortSignal): Promise<Summary> {
  requireAdmin(epoch);
  if (!batchEnabled()) throw new AdminFailure('Пакетное создание выключено. Доступно только изолированное mock-тестирование.');
  if (!Number.isSafeInteger(routeId) || body.route_id !== routeId || !body.checkpoints.length || body.checkpoints.some(row => row.route_id !== routeId)) throw new AdminFailure('Маршрут партии и каждой строки должен совпадать.');
  try {
    const { data, response } = await api.POST('/api/v1/admin/checkpoints/batch', { body, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    requireAdmin(epoch);
    if (signal.aborted || response.status !== 201 || response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json' || !isBatchResponse(data, body.checkpoints.length)) throw new Error('Unconfirmed batch response');
    return { created_count: data.created_count, errors: data.errors.map(safeMessage) };
  } catch (error) {
    requireAdmin(epoch);
    if (!signal.aborted && error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status)) throw new AdminFailure(`Сервер отклонил запрос (${error.status}). Отсутствие любых последствий не гарантировано.`, false, error.details);
    throw new AdminFailure('Исход неизвестен: сервер мог записать часть партии. Не повторяйте отправку; нужна сверка с ответственным.', true);
  }
}
