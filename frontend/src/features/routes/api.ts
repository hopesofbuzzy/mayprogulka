import { queryOptions } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { ApiError, errorMessage } from '../../shared/api/errors';
import { isCheckpoint, isPublicRoute, uniqueIds } from './model';

class InvalidPublicResponse extends Error {}
export function routesError(error: Error) {
  return error instanceof InvalidPublicResponse ? 'Сервис вернул некорректный список маршрутов. Повторите загрузку.' : errorMessage(error);
}
export function checkpointsError(error: Error) {
  if (error instanceof InvalidPublicResponse) return 'Сервис вернул некорректный список контрольных пунктов. Повторите загрузку.';
  if (error instanceof ApiError) return `Не удалось загрузить контрольные пункты. Сервер ответил ошибкой (${error.status}).`;
  if (error.name === 'TimeoutError') return 'Сервер не ответил вовремя. Повторите загрузку контрольных пунктов.';
  return 'Не удалось подключиться к сервису контрольных пунктов. Проверьте подключение и повторите загрузку.';
}

export const routesQuery = queryOptions({
  queryKey: ['routes'],
  queryFn: async ({ signal }) => {
    const { data, response } = await api.GET('/api/v1/routes', {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    }).catch(error => { if (error instanceof SyntaxError) throw new InvalidPublicResponse(); throw error; });
    if (!response.ok) throw new ApiError(response.status);
    if (response.status !== 200 || !response.headers.get('Content-Type')?.includes('application/json') || !data || !Array.isArray(data.routes) || !data.routes.every(isPublicRoute) || !uniqueIds(data.routes)) throw new InvalidPublicResponse();
    return data.routes;
  },
  retry: false,
  networkMode: 'always',
  staleTime: 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export function checkpointsQuery(routeId: number) {
  return queryOptions({
    queryKey: ['checkpoints', routeId] as const,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET('/api/v1/checkpoints', {
        params: { query: { route_id: routeId } },
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      }).catch(error => { if (error instanceof SyntaxError) throw new InvalidPublicResponse(); throw error; });
      if (response.status !== 200 || !response.headers.get('Content-Type')?.includes('application/json') || !data || !Array.isArray(data.checkpoints)
        || !data.checkpoints.every(item => isCheckpoint(item, routeId)) || !uniqueIds(data.checkpoints)) throw new InvalidPublicResponse();
      return [...data.checkpoints].sort((a, b) => a.order - b.order);
    },
    retry: false, networkMode: 'always', staleTime: 60_000,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
}
