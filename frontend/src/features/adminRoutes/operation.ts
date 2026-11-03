import { useQueryClient } from '@tanstack/react-query';
import { routesQuery } from '../routes/api';
import type { PublicRoute } from '../routes/model';
import { currentAdmin, mutateRoute } from './api';
import { createBody, emptyFields, routeFields, serverFields, updateBody, validate } from './model';
import type { Fields } from './model';
import { useAdminWorkflow } from '../adminShared/operation';
import type { AdminEditor } from '../adminShared/operation';

export type Editor = AdminEditor<Fields, PublicRoute>;
export function useAdminOperation(epoch: number) {
  const client = useQueryClient();
  return useAdminWorkflow<Fields, PublicRoute>(epoch, {
    scope: 'adminRoutes', values: baseline => baseline ? routeFields(baseline) : emptyFields(), validate, fields: serverFields,
    changed: editor => Boolean(editor.baseline && Object.keys(updateBody(editor.values, editor.baseline)).length),
    run: (editor, signal) => mutateRoute(editor.kind, editor.kind === 'create' ? createBody(editor.values) : editor.baseline ? updateBody(editor.values, editor.baseline) : {}, editor.baseline?.id, epoch, signal),
    refresh: async () => {
      if (!currentAdmin(epoch)) return;
      await client.cancelQueries({ queryKey: routesQuery.queryKey, exact: true });
      if (!currentAdmin(epoch)) return;
      await client.invalidateQueries({ queryKey: routesQuery.queryKey, exact: true, refetchType: 'none' });
      if (currentAdmin(epoch)) await client.fetchQuery({ ...routesQuery, staleTime: 0 });
    },
  });
}
