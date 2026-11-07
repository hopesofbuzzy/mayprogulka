import { api } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import { AdminFailure, requireAdmin } from '../adminShared/api';
import { isCheckpoint } from '../routes/model';
import type { Checkpoint } from '../routes/model';
import type { Kind } from '../adminShared/operation';
import type { Create, Patch } from './model';

export async function mutateCheckpoint(kind: Kind, body: Create | Patch, routeId: number, checkpointId: number | undefined, epoch: number, signal: AbortSignal): Promise<Checkpoint | null> {
  requireAdmin(epoch);
  if (kind === 'create' && (!('route_id' in body) || body.route_id !== routeId)) throw new AdminFailure('Маршрут запроса не совпадает с выбранным.');
  if (!Number.isSafeInteger(routeId) || (kind !== 'create' && !Number.isSafeInteger(checkpointId))) throw new AdminFailure('Откройте КП выбранного маршрута из достоверного списка.');
  try {
    const options = { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) };
    if (kind === 'delete') {
      const { response } = await api.DELETE('/api/v1/admin/checkpoints/{checkpoint_id}', { ...options, params: { path: { checkpoint_id: checkpointId! } } });
      requireAdmin(epoch);
      if (signal.aborted || response.status !== 204) throw new Error('Unconfirmed checkpoint deletion');
      return null;
    }
    const result = kind === 'create' ? await api.POST('/api/v1/admin/checkpoints', { ...options, body: body as Create })
      : await api.PUT('/api/v1/admin/checkpoints/{checkpoint_id}', { ...options, params: { path: { checkpoint_id: checkpointId! } }, body });
    requireAdmin(epoch);
    if (signal.aborted || result.response.status !== (kind === 'create' ? 201 : 200) || !result.response.headers.get('Content-Type')?.includes('application/json') || !isCheckpoint(result.data, routeId) || (kind === 'edit' && result.data.id !== checkpointId)) throw new Error('Unconfirmed checkpoint response');
    return result.data;
  } catch (error) {
    requireAdmin(epoch);
    if (!signal.aborted && error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status)) throw new AdminFailure(`Сервер ${error.status === 403 ? 'запретил' : 'отклонил'} действие с КП (${error.status}).`, false, error.details);
    throw new AdminFailure('Исход операции неизвестен. КП мог быть создан, изменён или удалён на сервере. Проверьте с ответственным.', true);
  }
}
