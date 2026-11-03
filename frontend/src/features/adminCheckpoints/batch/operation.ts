import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StaleSessionError } from '../../../shared/api/errors';
import { AdminFailure, currentAdmin } from '../../adminShared/api';
import { checkpointsQuery, routesQuery } from '../../routes/api';
import type { Fields } from '../model';
import { createBatch } from './api';
import { batchEnabled, batchKey, bodyFor, initialBatch, newRow, unresolved, validateRows, validationFields } from './model';
import type { BatchState, Row } from './model';

export function useBatchOperation(epoch: number, routeId: number) {
  const client = useQueryClient(), key = useMemo(() => batchKey(epoch, routeId), [epoch, routeId]);
  const { data: state } = useQuery({ queryKey: key, enabled: false, initialData: initialBatch, queryFn: async () => initialBatch(), meta: { private: true }, staleTime: Infinity, gcTime: Infinity });
  const basis = useQuery({ ...routesQuery, enabled: false });
  const request = useRef<AbortController | null>(null), alive = useRef(true), busy = useRef(false);
  const read = () => client.getQueryData<BatchState>(key)!;
  const update = (change: (value: BatchState) => BatchState) => { if (currentAdmin(epoch)) client.setQueryData<BatchState>(key, value => change(value ?? initialBatch())); };
  const singleBusy = () => {
    const single = client.getQueryData<{ editor?: unknown; paused?: { kind: string }[] }>(['private', 'adminCheckpoints', epoch, routeId]);
    return Boolean(single?.editor || single?.paused?.some(item => item.kind !== 'delete'));
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; busy.current = false;
      request.current?.abort(); request.current = null;
      if (currentAdmin(epoch)) client.setQueryData<BatchState>(key, value => value?.phase === 'pending' ? { ...value, phase: 'result', unknown: true, message: 'Ожидание прервано на устройстве; сервер мог записать часть партии.', refresh: undefined, revision: value.revision + 1 }
        : value?.phase === 'checking' ? { ...value, phase: 'edit', revision: value.revision + 1 } : value);
    };
  }, [client, epoch, key]);
  const active = () => alive.current && currentAdmin(epoch);
  function close() {
    const value = read(); request.current?.abort(); request.current = null; busy.current = false;
    update(item => ({ ...item, visible: false, revision: item.revision + 1, phase: value.phase === 'pending' ? 'result' : value.phase === 'checking' || value.phase === 'review' ? 'edit' : value.phase,
      ...(value.phase === 'pending' ? { unknown: true, message: 'Ожидание прервано на устройстве; сервер мог записать часть партии.' } : {}) }));
  }
  function changeRows(change: (rows: Row[]) => Row[]) { if (read().phase !== 'edit') return; update(value => ({ ...value, rows: change(value.rows), message: '', revision: value.revision + 1 })); }
  function change<K extends keyof Fields>(key: string, field: K, value: Fields[K]) {
    changeRows(rows => rows.map(row => row.key === key ? { ...row, values: { ...row.values, [field]: value } } : row));
    update(item => ({ ...item, errors: { ...item.errors, [key]: { ...item.errors[key], [field]: undefined } } }));
  }
  async function review() {
    if (!active() || !batchEnabled() || busy.current || read().phase !== 'edit' || unresolved(read()) || singleBusy()) return;
    const errors = validateRows(read().rows);
    if (Object.keys(errors).length) { update(value => ({ ...value, errors, message: 'Проверьте поля партии.', revision: value.revision + 1 })); return; }
    busy.current = true; const revision = read().revision;
    update(value => ({ ...value, phase: 'checking', errors: {}, message: '' }));
    try {
      const routes = await client.fetchQuery({ ...routesQuery, staleTime: 0 });
      if (!active() || read().phase !== 'checking' || read().revision !== revision) return;
      if (!routes.some(route => route.id === routeId)) throw new Error('Unavailable route');
      update(value => ({ ...value, phase: 'review', snapshot: value.rows.map(row => ({ ...row, values: { ...row.values } })), routeVersion: client.getQueryState(routesQuery.queryKey)?.dataUpdatedAt, revision: value.revision + 1 }));
    } catch { if (active() && read().phase === 'checking') update(value => ({ ...value, phase: 'edit', message: 'Не удалось обновить данные маршрута. Отправка запрещена.', revision: value.revision + 1 })); }
    finally { if (active()) busy.current = false; }
  }
  async function refresh() {
    if (!active() || read().refresh === 'pending') return;
    update(value => ({ ...value, refresh: 'pending', revision: value.revision + 1 }));
    try {
      const options = checkpointsQuery(routeId);
      await client.cancelQueries({ queryKey: options.queryKey, exact: true });
      if (!active()) return;
      await client.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: 'none' });
      if (!active()) return;
      await client.fetchQuery({ ...options, staleTime: 0 });
      if (active()) update(value => ({ ...value, refresh: 'success' }));
    } catch { if (active()) update(value => ({ ...value, refresh: 'error' })); }
  }
  async function confirm(typed: string, ack: boolean) {
    const value = read(), routes = client.getQueryState(routesQuery.queryKey);
    if (!active() || !batchEnabled() || busy.current || value.phase !== 'review' || unresolved(value) || !ack || typed !== String(routeId) || !value.snapshot || singleBusy()) return;
    if (routes?.status !== 'success' || routes.fetchStatus !== 'idle' || routes.isInvalidated || routes.dataUpdatedAt !== value.routeVersion || Date.now() - routes.dataUpdatedAt >= 60_000 || !routes.data?.some(route => route.id === routeId)) {
      update(item => ({ ...item, phase: 'edit', message: 'Данные маршрута изменились или устарели. Заново проверьте партию.', revision: item.revision + 1 })); return;
    }
    const controller = new AbortController(); request.current = controller; busy.current = true;
    update(item => ({ ...item, phase: 'pending', errors: {}, message: '', revision: item.revision + 1 }));
    try {
      const summary = await createBatch(bodyFor(value.snapshot, routeId), routeId, epoch, controller.signal);
      if (!active() || controller.signal.aborted) return;
      update(item => ({ ...item, phase: 'result', summary, revision: item.revision + 1 }));
      await refresh();
    } catch (error) {
      if (!active() || controller.signal.aborted || error instanceof StaleSessionError) return;
      const failure = error instanceof AdminFailure ? error : new AdminFailure('Исход партии неизвестен.', true);
      update(item => ({ ...item, phase: failure.uncertain ? 'result' : 'edit', unknown: failure.uncertain, message: failure.message,
        errors: validationFields(failure.details, value.snapshot!), revision: item.revision + 1 }));
    } finally { if (request.current === controller) { request.current = null; busy.current = false; } }
  }
  return { state, confirmationRevision: `${state.revision}/${basis.dataUpdatedAt}/${basis.fetchStatus}`, locked: unresolved(state) || state.phase === 'pending' || state.refresh === 'pending', close, review, confirm, refresh, change,
    open: () => { if (batchEnabled() && !singleBusy()) update(value => ({ ...value, visible: true, revision: value.revision + 1 })); },
    back: () => update(value => value.phase === 'review' ? { ...value, phase: 'edit', revision: value.revision + 1 } : value),
    add: () => changeRows(rows => [...rows, newRow()]), remove: (key: string) => changeRows(rows => rows.length > 1 ? rows.filter(row => row.key !== key) : rows),
    resolve: (typed: string, ack: boolean) => { if (unresolved(read()) && read().refresh !== 'pending' && typed === String(routeId) && ack) update(value => ({ ...value, resolved: true, revision: value.revision + 1 })); },
    startNew: () => { if (!unresolved(read()) && !busy.current && read().refresh !== 'pending') update(() => ({ ...initialBatch(), visible: true })); },
  };
}
