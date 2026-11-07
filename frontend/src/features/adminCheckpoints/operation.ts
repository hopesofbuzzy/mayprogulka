import { useQueryClient } from '@tanstack/react-query';
import { useAdminWorkflow } from '../adminShared/operation';
import { currentAdmin } from '../adminShared/api';
import { checkpointsQuery, routesQuery } from '../routes/api';
import type { Checkpoint } from '../routes/model';
import { createBody, emptyFields, pointFields, samePoint, serverFields, updateBody, validate } from './model';
import type { Fields } from './model';
import { mutateCheckpoint } from './api';
import { blocksCreate } from './batch/model';

export function useCheckpointOperation(epoch: number, routeId: number) {
  const client = useQueryClient(), options = checkpointsQuery(routeId);
  return useAdminWorkflow<Fields, Checkpoint>(epoch, {
    scope: 'adminCheckpoints', contextId: routeId, allowDefer: true,
    values: point => point ? pointFields(point) : emptyFields(), validate, fields: serverFields,
    changed: editor => Boolean(editor.baseline && Object.keys(updateBody(editor.values, editor.baseline)).length),
    canConfirm: editor => {
      const routes = client.getQueryState(routesQuery.queryKey);
      if (routes?.status !== 'success' || !routes.data?.some(route => route.id === routeId)) return false;
      if (editor.kind === 'create') return !blocksCreate(client, epoch, routeId);
      const list = client.getQueryState(options.queryKey), point = list?.data?.find(item => item.id === editor.baseline?.id);
      return list?.status === 'success' && Boolean(point && editor.baseline && samePoint(point, editor.baseline));
    },
    run: (editor, signal) => mutateCheckpoint(editor.kind, editor.kind === 'create' ? createBody(editor.values, routeId) : editor.baseline ? updateBody(editor.values, editor.baseline) : {}, routeId, editor.baseline?.id, epoch, signal),
    refresh: async () => {
      if (!currentAdmin(epoch)) return;
      await client.cancelQueries({ queryKey: options.queryKey, exact: true });
      if (!currentAdmin(epoch)) return;
      await client.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: 'none' });
      if (currentAdmin(epoch)) await client.fetchQuery({ ...options, staleTime: 0 });
    },
  });
}
