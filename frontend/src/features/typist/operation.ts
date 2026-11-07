import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StaleSessionError } from '../../shared/api/errors';
import { currentTypist, StaffFailure } from './api';
import { serverFields } from './model';
import type { Errors } from './model';

type Phase = 'edit' | 'review' | 'pending' | 'confirmed';
export type Operation<V, R> = { values: V; phase: Phase; uncertain: boolean; duplicateRisk: boolean; message: string; errors: Errors<V>; result?: R };
export function useStaffOperation<V, R>(kind: 'paper' | 'match', epoch: number, empty: () => V, run: (values: V, epoch: number, signal: AbortSignal) => Promise<R>, names: readonly (keyof V)[]) {
  const client = useQueryClient();
  const key = ['private', 'typist', epoch, 'operation', kind] as const;
  const initial = (): Operation<V, R> => ({ values: empty(), phase: 'edit', uncertain: false, duplicateRisk: false, message: '', errors: {} });
  const { data: state } = useQuery({ queryKey: key, meta: { private: true }, enabled: false, initialData: initial, queryFn: async () => initial(), retry: false, staleTime: Infinity, gcTime: Infinity });
  const [acknowledged, setAcknowledged] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const update = (change: (current: Operation<V, R>) => Operation<V, R>) => {
    if (currentTypist(epoch)) client.setQueryData<Operation<V, R>>(key, value => change(value ?? initial()));
  };
  useEffect(() => () => {
    if (!controller.current) return;
    controller.current.abort();
    if (currentTypist(epoch)) client.setQueryData<Operation<V, R>>(['private', 'typist', epoch, 'operation', kind], current => current?.phase === 'pending'
      ? { ...current, phase: 'edit', uncertain: true, duplicateRisk: true, message: 'Запрос прерван на устройстве. Запись или привязка могла сохраниться на сервере. Перед повтором обратитесь к ответственному.' } : current);
  }, [client, epoch, kind]);
  function change<K extends keyof V>(name: K, value: V[K]) {
    setAcknowledged(false);
    update(current => current.phase === 'pending' || current.phase === 'confirmed' ? current : { ...current, phase: 'edit', values: { ...current.values, [name]: value }, errors: { ...current.errors, [name]: undefined } });
  }
  function review(errors: Errors<V>) {
    update(current => current.phase !== 'edit' || (current.uncertain && !acknowledged) ? current : { ...current, errors, message: Object.keys(errors).length ? 'Проверьте поля.' : '', phase: Object.keys(errors).length ? 'edit' : 'review' });
  }
  async function confirm(validate: (values: V) => Errors<V>) {
    const current = client.getQueryData<Operation<V, R>>(key);
    if (!currentTypist(epoch) || !current || current.phase !== 'review' || (current.uncertain && !acknowledged)) return;
    const errors = validate(current.values);
    if (Object.keys(errors).length) { update(value => ({ ...value, phase: 'edit', errors, message: 'Проверьте поля.' })); return; }
    const request = new AbortController(); controller.current = request;
    update(value => ({ ...value, phase: 'pending', message: '', errors: {} }));
    try {
      const result = await run(current.values, epoch, request.signal);
      if (request.signal.aborted || !currentTypist(epoch)) return;
      update(value => ({ ...value, phase: 'confirmed', uncertain: false, result }));
      if (kind === 'match') {
        const prefix = ['private', 'typist', epoch, 'unlinked'];
        try {
          await client.cancelQueries({ queryKey: prefix });
          if (currentTypist(epoch)) await client.invalidateQueries({ queryKey: prefix, refetchType: 'active' });
        } catch { /* A list refresh cannot undo a confirmed mutation response. */ }
      }
    } catch (error) {
      if (error instanceof StaleSessionError || request.signal.aborted || !currentTypist(epoch)) return;
      const failure = error instanceof StaffFailure ? error : new StaffFailure('Результат неизвестен. Обратитесь к ответственному перед повтором.', true);
      update(value => ({ ...value, phase: 'edit', uncertain: value.uncertain || failure.uncertain, duplicateRisk: value.duplicateRisk || failure.uncertain, message: failure.message, errors: serverFields<V>(failure.details, names) }));
      setAcknowledged(false);
    }
  }
  return { state, acknowledged, setAcknowledged, change, review, confirm,
    edit: () => { setAcknowledged(false); update(current => current.phase === 'review' ? { ...current, phase: 'edit' } : current); },
    clear: () => { setAcknowledged(false); update(current => current.phase === 'confirmed' || (current.phase === 'edit' && !current.uncertain) ? initial() : current); },
  };
}
