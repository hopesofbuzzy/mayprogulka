import { api } from '../../shared/api/client';
import { ApiError, StaleSessionError } from '../../shared/api/errors';
import { AdminFailure, currentAdmin } from '../adminShared/api';
export { AdminFailure, currentAdmin } from '../adminShared/api';
import { isPublicRoute } from '../routes/model';
import type { PublicRoute } from '../routes/model';
import type { CreateRoute, Kind, UpdateRoute } from './model';

function authorize(epoch: number) { if (!currentAdmin(epoch)) throw new StaleSessionError(); }
export async function mutateRoute(kind: Kind, body: CreateRoute | UpdateRoute, id: number | undefined, epoch: number, signal: AbortSignal): Promise<PublicRoute | null> {
  authorize(epoch);
  if (kind !== 'create' && (id === undefined || !Number.isSafeInteger(id))) throw new AdminFailure('Откройте достоверный маршрут из списка.');
  try {
    const options = { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) };
    if (kind === 'delete') {
      const { response } = await api.DELETE('/api/v1/admin/routes/{route_id}', { ...options, params: { path: { route_id: id! } } });
      authorize(epoch);
      if (signal.aborted || response.status !== 204) throw new Error('Unconfirmed delete response');
      return null;
    }
    const result = kind === 'create' ? await api.POST('/api/v1/admin/routes', { ...options, body: body as CreateRoute })
      : await api.PUT('/api/v1/admin/routes/{route_id}', { ...options, params: { path: { route_id: id! } }, body });
    authorize(epoch);
    if (signal.aborted || result.response.status !== (kind === 'create' ? 201 : 200)
      || !result.response.headers.get('Content-Type')?.includes('application/json') || !isPublicRoute(result.data)
      || (kind === 'edit' && result.data.id !== id)) throw new Error('Unconfirmed route response');
    return result.data;
  } catch (error) {
    authorize(epoch);
    if (!signal.aborted && error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status)) {
      const context = error.status === 403 ? 'Сервер запретил действие. Клиентская роль не заменяет серверные права'
        : error.status === 422 ? 'Сервер отклонил поля маршрута' : 'Сервер отклонил действие';
      throw new AdminFailure(`${context} (${error.status}).`, false, error.details);
    }
    throw new AdminFailure('Результат неизвестен. Операция могла сохраниться на сервере. Проверьте состояние и обратитесь к ответственному.', true);
  }
}
