import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StaleSessionError } from '../../shared/api/errors';
import { AdminFailure, currentAdmin } from './api';

export type Kind = 'create' | 'edit' | 'delete';
export type AdminEditor<V, B> = { kind: Kind; baseline?: B; values: V; phase: 'edit' | 'review' | 'pending' | 'confirmed';
  uncertain: boolean; earlierUncertain: boolean; errors: Partial<Record<keyof V, string>>; message: string; result?: B | null; refresh?: 'pending' | 'success' | 'error' };
type State<V, B> = { editor: AdminEditor<V, B> | null; paused?: AdminEditor<V, B>[] };
type Definition<V, B> = {
  scope: string; contextId?: number; allowDefer?: boolean;
  values: (baseline?: B) => V;
  validate: (values: V, kind: Kind) => Partial<Record<keyof V, string>>;
  changed: (editor: AdminEditor<V, B>) => boolean;
  fields: (details: unknown) => Partial<Record<keyof V, string>>;
  run: (editor: AdminEditor<V, B>, signal: AbortSignal) => Promise<B | null>;
  refresh: () => Promise<void>;
  canConfirm?: (editor: AdminEditor<V, B>) => boolean;
};
export function useAdminWorkflow<V, B extends { id: number }>(epoch: number, definition: Definition<V, B>) {
  const client = useQueryClient();
  const { scope, contextId } = definition;
  const key = useMemo(() => ['private', scope, epoch, ...(contextId === undefined ? [] : [contextId])], [scope, epoch, contextId]);
  const initial = (): State<V, B> => ({ editor: null });
  const { data: state } = useQuery({ queryKey: key, enabled: false, meta: { private: true }, initialData: initial, queryFn: async () => initial(), staleTime: Infinity, gcTime: Infinity });
  const controller = useRef<AbortController | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [checked, setChecked] = useState(false), [checking, setChecking] = useState(false);
  const read = () => client.getQueryData<State<V, B>>(key);
  const update = (change: (value: State<V, B>) => State<V, B>) => { if (currentAdmin(epoch)) client.setQueryData<State<V, B>>(key, value => change(value ?? initial())); };
  const edit = (change: (editor: AdminEditor<V, B>) => AdminEditor<V, B>) => update(state => state.editor ? { ...state, editor: change(state.editor) } : state);
  useEffect(() => () => {
    if (!controller.current) return;
    controller.current.abort();
    if (currentAdmin(epoch)) client.setQueryData<State<V, B>>(key, state => state?.editor?.phase === 'pending'
      ? { ...state, editor: { ...state.editor, phase: 'edit', uncertain: true, earlierUncertain: true, message: 'Ожидание прервано на устройстве. Сервер мог выполнить операцию; перед дальнейшими действиями проверьте состояние.' } } : state);
  }, [client, epoch, key]);
  const resetAcknowledgement = () => { setAcknowledged(false); setChecked(false); };
  function blocked(kind: Kind, baseline?: B) {
    return (read()?.paused ?? []).some(item => item.kind !== 'delete' || (kind !== 'create' && item.baseline?.id === baseline?.id));
  }
  function open(kind: Kind, baseline?: B) {
    if (read()?.editor || blocked(kind, baseline)) return;
    resetAcknowledgement();
    update(state => ({ ...state, editor: { kind, baseline, values: definition.values(baseline), phase: 'edit', uncertain: false, earlierUncertain: false, errors: {}, message: '' } }));
  }
  function change<K extends keyof V>(field: K, value: V[K]) {
    resetAcknowledgement(); edit(editor => editor.phase !== 'edit' ? editor : { ...editor, values: { ...editor.values, [field]: value }, errors: { ...editor.errors, [field]: undefined } });
  }
  async function check() {
    if (!currentAdmin(epoch) || checking) return;
    setChecking(true); setAcknowledged(false);
    try { await definition.refresh(); edit(value => value.phase === 'confirmed' ? { ...value, refresh: 'success' } : value); }
    catch { edit(value => value.phase === 'confirmed' ? { ...value, refresh: 'error' } : value); }
    finally { if (currentAdmin(epoch)) { setChecking(false); setChecked(true); } }
  }
  function review() {
    edit(editor => {
      if (editor.phase !== 'edit' || editor.kind === 'delete' || (editor.uncertain && (!checked || !acknowledged))) return editor;
      const errors = definition.validate(editor.values, editor.kind);
      const unchanged = editor.kind === 'edit' && !definition.changed(editor);
      return { ...editor, errors, message: Object.keys(errors).length ? 'Проверьте поля.' : unchanged ? 'Нет изменений для отправки.' : '', phase: Object.keys(errors).length || unchanged ? 'edit' : 'review' };
    });
  }
  async function confirm(typedId: string, recordAvailable: boolean) {
    const editor = read()?.editor;
    if (!editor || !currentAdmin(epoch) || controller.current || checking || editor.phase === 'pending' || editor.phase === 'confirmed') return;
    if (editor.kind === 'delete' ? editor.uncertain || typedId !== String(editor.baseline?.id) : editor.phase !== 'review' || (editor.uncertain && (!checked || !acknowledged))) return;
    if (editor.kind !== 'create' && !recordAvailable) return;
    if (definition.canConfirm && !definition.canConfirm(editor)) return;
    if (Object.keys(definition.validate(editor.values, editor.kind)).length || (editor.kind === 'edit' && !definition.changed(editor))) return;
    const request = new AbortController(); controller.current = request;
    edit(value => ({ ...value, phase: 'pending', message: '', errors: {} }));
    try {
      const result = await definition.run(editor, request.signal);
      if (request.signal.aborted || !currentAdmin(epoch)) return;
      controller.current = null;
      edit(value => ({ ...value, phase: 'confirmed', uncertain: false, result, refresh: 'pending' }));
      try { await definition.refresh(); edit(value => ({ ...value, refresh: 'success' })); }
      catch { edit(value => ({ ...value, refresh: 'error' })); }
    } catch (error) {
      if (request.signal.aborted || error instanceof StaleSessionError || !currentAdmin(epoch)) return;
      const failure = error instanceof AdminFailure ? error : new AdminFailure('Результат неизвестен. Проверьте состояние у ответственного.', true);
      edit(value => ({ ...value, phase: 'edit', uncertain: value.uncertain || failure.uncertain, earlierUncertain: value.earlierUncertain || failure.uncertain, message: failure.message, errors: definition.fields(failure.details) }));
      resetAcknowledgement();
    } finally { if (controller.current === request) controller.current = null; }
  }
  function close() {
    let editor = read()?.editor;
    if (!editor || editor.refresh === 'pending' || ((editor.phase === 'pending' || editor.uncertain) && !definition.allowDefer)) return;
    if (editor.phase === 'pending') {
      controller.current?.abort(); controller.current = null;
      editor = { ...editor, phase: 'edit', uncertain: true, earlierUncertain: true, message: 'Ожидание прервано на устройстве. Сервер мог выполнить операцию; перед дальнейшими действиями проверьте состояние.' };
    }
    resetAcknowledgement();
    update(state => ({ ...state, editor: null, ...(editor.uncertain ? { paused: [...(state.paused ?? []), editor] } : {}) }));
  }
  function resume(index: number) {
    if (read()?.editor || !definition.allowDefer) return;
    resetAcknowledgement();
    update(state => ({ ...state, editor: state.paused?.[index] ?? null, paused: state.paused?.filter((_, item) => item !== index) }));
  }
  function rebase(baseline: B, values: V) {
    if (!checked || checking) return;
    setAcknowledged(false);
    edit(editor => editor.phase === 'pending' || editor.phase === 'confirmed' ? editor : { ...editor, baseline, values, phase: 'edit', errors: {}, message: '' });
  }
  return { editor: state.editor, paused: state.paused ?? [], blocked, open, change, review, confirm, checked, checking, acknowledged, setAcknowledged, check, close, resume, rebase,
    back: () => { setAcknowledged(false); edit(value => value.phase === 'review' ? { ...value, phase: 'edit' } : value); },
  };
}
