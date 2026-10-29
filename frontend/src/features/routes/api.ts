import { queryOptions } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';

export const routesQuery = queryOptions({
  queryKey: ['routes'],
  queryFn: async ({ signal }) => {
    const { data, response } = await api.GET('/api/v1/routes', {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new ApiError(response.status);
    if (!data || !Array.isArray(data.routes)) throw new Error('Invalid routes response');
    return data.routes;
  },
  retry: false,
  networkMode: 'always',
  staleTime: 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});
