import { useQueryClient } from '@tanstack/react-query';
import { routesQuery } from '../routes/api';
import type { PublicRoute } from '../routes/model';
import { AdminFailure, currentAdmin, mutateRoute } from './api';
import { createBody, emptyFields, routeFields, serverFields, updateBody, validate } from './model';
import type { Fields } from './model';
import { useAdminWorkflow } from '../adminShared/operation';
import type { AdminEditor } from '../adminShared/operation';

export type Editor = AdminEditor<Fields, PublicRoute>;
const scope = 'adminRoutes';
export function useAdminOperation(epoch: number) {
  const client = useQueryClient();
  const workflow = useAdminWorkflow<Fields, PublicRoute>(epoch, {
    scope, allowDefer: true, values: baseline => baseline ? routeFields(baseline) : emptyFields(), validate, fields: serverFields,
    changed: editor => Boolean(editor.baseline && Object.keys(updateBody(editor.values, editor.baseline)).length),
    canConfirm: editor => {
      if (!editor.values.activityAction) return true;
      const state = client.getQueryState(routesQuery.queryKey);
      const current = state?.data?.find(route => route.id === editor.baseline?.id);
      return state?.status === 'success' && state.fetchStatus === 'idle' && !state.isInvalidated && Boolean(current && current.is_active === editor.baseline?.is_active);
    },
    run: async (editor, signal) => {
      const body = editor.values.activityAction ? { is_active: editor.values.is_active } : editor.kind === 'create' ? createBody(editor.values) : editor.baseline ? updateBody(editor.values, editor.baseline) : {};
      const result = await mutateRoute(editor.kind, body, editor.baseline?.id, epoch, signal);
      if (editor.values.activityAction && result?.is_active !== editor.values.is_active) throw new AdminFailure('Ответ сервера не подтверждает запрошенный статус. Проверьте состояние маршрута.', true);
      return result;
    },
    refresh: async () => {
      if (!currentAdmin(epoch)) return;
      await client.cancelQueries({ queryKey: routesQuery.queryKey, exact: true });
      if (!currentAdmin(epoch)) return;
      await client.invalidateQueries({ queryKey: routesQuery.queryKey, exact: true, refetchType: 'none' });
      if (currentAdmin(epoch)) await client.fetchQuery({ ...routesQuery, staleTime: 0 });
    },
  });
  function setActivity(route: PublicRoute, action: 'archive' | 'restore') {
    if (!currentAdmin(epoch) || route.is_active === (action === 'restore') || !workflow.open('edit', route)) return;
    workflow.change('activityAction', action);
    workflow.change('is_active', action === 'restore');
    workflow.review();
  }
  function resolveActivity() {
    if (!currentAdmin(epoch) || !workflow.checked || !workflow.acknowledged || workflow.checking) return;
    const key = ['private', scope, epoch] as const;
    const state = client.getQueryData<{ editor: Editor | null; paused?: Editor[] }>(key);
    const query = client.getQueryState(routesQuery.queryKey);
    const editor = state?.editor;
    const current = query?.data?.find(route => route.id === editor?.baseline?.id);
    if (!editor?.values.activityAction || !editor.uncertain || editor.phase === 'pending' || query?.status !== 'success' || query.fetchStatus !== 'idle' || query.isInvalidated || !current || current.is_active !== editor.values.is_active) return;
    // Explicit reconciliation of a fresh GET, never a claim that the lost PUT
    // succeeded and never a replay of that request.
    client.setQueryData(key, { ...state, editor: { ...editor, phase: 'confirmed', uncertain: false, earlierUncertain: true, result: current, refresh: 'success', message: 'Текущий статус подтверждён полученным каталогом. Исход прежнего запроса остаётся неизвестным.' } });
  }
  return { ...workflow,
    open: (kind: 'create' | 'edit', route?: PublicRoute) => workflow.open(kind, route),
    archive: (route: PublicRoute) => setActivity(route, 'archive'),
    restore: (route: PublicRoute) => setActivity(route, 'restore'),
    resolveActivity,
  };
}
