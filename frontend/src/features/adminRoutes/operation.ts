import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StaleSessionError } from '../../shared/api/errors';
import { routesQuery } from '../routes/api';
import type { PublicRoute } from '../routes/model';
import { AdminFailure, currentAdmin, mutateRoute } from './api';
import { createBody, emptyFields, routeFields, serverFields, updateBody, validate } from './model';
import type { Errors, Fields, Kind } from './model';

export type Editor = { kind: Kind; baseline?: PublicRoute; values: Fields; phase: 'edit' | 'review' | 'pending' | 'confirmed';
  uncertain: boolean; earlierUncertain: boolean; errors: Errors; message: string; result?: PublicRoute | null; refresh?: 'pending' | 'success' | 'error' };
type State = { editor: Editor | null };
export function useAdminOperation(epoch: number) {
  const client = useQueryClient();
  const key = ['private', 'adminRoutes', epoch] as const;
  const { data: state } = useQuery({ queryKey: key, enabled: false, meta: { private: true }, initialData: (): State => ({ editor: null }), queryFn: async (): Promise<State> => ({ editor: null }), staleTime: Infinity, gcTime: Infinity });
  const controller = useRef<AbortController | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [checked, setChecked] = useState(false), [checking, setChecking] = useState(false);
  const update = (change: (value: State) => State) => { if (currentAdmin(epoch)) client.setQueryData<State>(key, value => change(value ?? { editor: null })); };
  const edit = (change: (editor: Editor) => Editor) => update(state => state.editor ? { editor: change(state.editor) } : state);
  useEffect(() => () => {
    if (!controller.current) return;
    controller.current.abort();
    if (currentAdmin(epoch)) client.setQueryData<State>(['private', 'adminRoutes', epoch], state => state?.editor?.phase === 'pending'
      ? { editor: { ...state.editor, phase: 'edit', uncertain: true, earlierUncertain: true, message: 'Ожидание прервано на устройстве. Сервер мог выполнить операцию; перед дальнейшими действиями проверьте состояние.' } } : state);
  }, [client, epoch]);
  const resetAcknowledgement = () => { setAcknowledged(false); setChecked(false); };
  function open(kind: Kind, baseline?: PublicRoute) {
    const existing = client.getQueryData<State>(key)?.editor;
    if (existing) return;
    resetAcknowledgement();
    update(() => ({ editor: { kind, baseline, values: baseline ? routeFields(baseline) : emptyFields(), phase: 'edit', uncertain: false, earlierUncertain: false, errors: {}, message: '' } }));
  }
  function change<K extends keyof Fields>(field: K, value: Fields[K]) {
    resetAcknowledgement(); edit(editor => editor.phase !== 'edit' ? editor : { ...editor, values: { ...editor.values, [field]: value }, errors: { ...editor.errors, [field]: undefined } });
  }
  async function refresh() {
    if (!currentAdmin(epoch)) return;
    await client.cancelQueries({ queryKey: routesQuery.queryKey, exact: true });
    if (!currentAdmin(epoch)) return;
    await client.invalidateQueries({ queryKey: routesQuery.queryKey, exact: true, refetchType: 'none' });
    if (currentAdmin(epoch)) await client.fetchQuery({ ...routesQuery, staleTime: 0 });
  }
  async function check() {
    if (!currentAdmin(epoch) || checking) return;
    setChecking(true); setAcknowledged(false);
    try { await refresh(); edit(value => value.phase === 'confirmed' ? { ...value, refresh: 'success' } : value); }
    catch { edit(value => value.phase === 'confirmed' ? { ...value, refresh: 'error' } : value); }
    finally { if (currentAdmin(epoch)) { setChecking(false); setChecked(true); } }
  }
  function review() {
    edit(editor => {
      if (editor.phase !== 'edit' || editor.kind === 'delete' || (editor.uncertain && (!checked || !acknowledged))) return editor;
      const errors = validate(editor.values, editor.kind);
      const unchanged = editor.kind === 'edit' && editor.baseline && !Object.keys(updateBody(editor.values, editor.baseline)).length;
      return { ...editor, errors, message: Object.keys(errors).length ? 'Проверьте поля.' : unchanged ? 'Нет изменений для отправки.' : '', phase: Object.keys(errors).length || unchanged ? 'edit' : 'review' };
    });
  }
  async function confirm(typedId: string, recordAvailable: boolean) {
    const editor = client.getQueryData<State>(key)?.editor;
    if (!editor || !currentAdmin(epoch) || controller.current || checking || editor.phase === 'pending' || editor.phase === 'confirmed') return;
    if (editor.kind === 'delete' ? editor.uncertain || typedId !== String(editor.baseline?.id) : editor.phase !== 'review' || (editor.uncertain && (!checked || !acknowledged))) return;
    if (editor.kind !== 'create' && !recordAvailable) return;
    if (Object.keys(validate(editor.values, editor.kind)).length) return;
    const body = editor.kind === 'create' ? createBody(editor.values) : editor.baseline ? updateBody(editor.values, editor.baseline) : {};
    if (editor.kind === 'edit' && !Object.keys(body).length) return;
    const request = new AbortController(); controller.current = request;
    edit(value => ({ ...value, phase: 'pending', message: '', errors: {} }));
    try {
      const result = await mutateRoute(editor.kind, body, editor.baseline?.id, epoch, request.signal);
      if (request.signal.aborted || !currentAdmin(epoch)) return;
      controller.current = null;
      edit(value => ({ ...value, phase: 'confirmed', uncertain: false, result, refresh: 'pending' }));
      try { await refresh(); edit(value => ({ ...value, refresh: 'success' })); }
      catch { edit(value => ({ ...value, refresh: 'error' })); }
    } catch (error) {
      if (request.signal.aborted || error instanceof StaleSessionError || !currentAdmin(epoch)) return;
      const failure = error instanceof AdminFailure ? error : new AdminFailure('Результат неизвестен. Проверьте состояние у ответственного.', true);
      edit(value => ({ ...value, phase: 'edit', uncertain: value.uncertain || failure.uncertain, earlierUncertain: value.earlierUncertain || failure.uncertain, message: failure.message, errors: serverFields(failure.details) }));
      resetAcknowledgement();
    } finally { if (controller.current === request) controller.current = null; }
  }
  return { editor: state.editor, open, change, review, confirm, checked, checking, acknowledged, setAcknowledged, check,
    back: () => { setAcknowledged(false); edit(value => value.phase === 'review' ? { ...value, phase: 'edit' } : value); },
    close: () => { const editor = client.getQueryData<State>(key)?.editor; if (!editor || editor.phase === 'pending' || editor.uncertain || editor.refresh === 'pending') return; resetAcknowledgement(); update(() => ({ editor: null })); },
  };
}
