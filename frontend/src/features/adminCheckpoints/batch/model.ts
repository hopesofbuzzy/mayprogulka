import type { QueryClient } from '@tanstack/react-query';
import type { components } from '../../../shared/api/schema';
import { createBody, emptyFields, names, validate } from '../model';
import type { Errors, Fields } from '../model';

export type BatchRequest = components['schemas']['BatchCheckpointCreateRequest'];
export type BatchResponse = components['schemas']['BatchCheckpointResponse'];
export type Row = { key: string; values: Fields };
export type RowErrors = Record<string, Errors>;
export type Summary = { created_count: number; errors: string[] };
export type BatchState = { rows: Row[]; visible: boolean; phase: 'edit' | 'checking' | 'review' | 'pending' | 'result';
  errors: RowErrors; message: string; snapshot?: Row[]; summary?: Summary; unknown?: boolean; resolved?: boolean;
  refresh?: 'pending' | 'success' | 'error'; routeVersion?: number; revision: number; focusRevision?: number };
let sequence = 0;
export const newRow = (): Row => ({ key: `row-${++sequence}`, values: emptyFields() });
export const initialBatch = (): BatchState => ({ rows: [newRow(), newRow()], visible: false, phase: 'edit', errors: {}, message: '', revision: 0 });
export const batchEnabled = () => import.meta.env.MODE === 'e2e' && import.meta.env.VITE_ENABLE_CHECKPOINT_BATCH === 'true';
export const batchKey = (epoch: number, routeId: number) => ['private', 'adminCheckpointBatch', epoch, routeId] as const;
export const unresolved = (state?: BatchState) => Boolean(state && !state.resolved && (state.unknown || (state.summary && (state.summary.created_count !== state.snapshot?.length || state.summary.errors.length > 0))));
export const blocksCreate = (client: QueryClient, epoch: number, routeId: number) => {
  const state = client.getQueryData<BatchState>(batchKey(epoch, routeId));
  return unresolved(state) || state?.phase === 'pending' || state?.refresh === 'pending';
};
export const bodyFor = (rows: Row[], routeId: number): BatchRequest => ({ route_id: routeId, checkpoints: rows.map(row => createBody(row.values, routeId)) });
export function validateRows(rows: Row[]): RowErrors {
  return Object.fromEntries(rows.map(row => [row.key, validate(row.values, 'create')] as const).filter(([, errors]) => Object.keys(errors).length));
}
export function validationFields(details: unknown, snapshot: Row[]): RowErrors {
  const result: RowErrors = {};
  if (!details || typeof details !== 'object' || !('detail' in details) || !Array.isArray(details.detail)) return result;
  for (const issue of details.detail) {
    const loc: unknown = issue && typeof issue === 'object' ? issue.loc : null;
    if (!Array.isArray(loc) || loc.length !== 4 || loc[0] !== 'body' || loc[1] !== 'checkpoints' || !Number.isSafeInteger(loc[2]) || loc[2] < 0 || loc[2] >= snapshot.length || !names.includes(loc[3])) continue;
    const key = snapshot[loc[2]]!.key;
    result[key] = { ...result[key], [loc[3]]: 'Сервер отклонил поле (422). Проверьте значение.' };
  }
  return result;
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function isBatchResponse(value: unknown, count: number): value is BatchResponse {
  return record(value) && Number.isSafeInteger(value.created_count) && (value.created_count as number) >= 0 && (value.created_count as number) <= count
    && Array.isArray(value.errors) && value.errors.every(record);
}
// Bound traversal as well as text length; never stringify an arbitrary whole object.
export function safeMessage(value: Record<string, unknown>): string {
  let budget = 600, visits = 0, shortened = false;
  const cut = (text: string) => { const clean = text.replace(/\p{Cc}/gu, ' '); if (clean.length > budget) shortened = true; const part = clean.slice(0, Math.max(0, budget)); budget -= part.length; return part; };
  const visit = (item: unknown, depth: number): string => {
    if (++visits > 40 || budget <= 0 || depth > 3) { shortened = true; return '…'; }
    if (typeof item === 'string') return cut(item);
    if (item === null || typeof item !== 'object') return cut(String(item));
    const entries = Object.entries(item); if (entries.length > 8) shortened = true;
    return entries.slice(0, 8).map(([key, nested]) => `${cut(key)}: ${visit(nested, depth + 1)}`).join('; ');
  };
  const text = visit(value, 0);
  return text + (shortened ? ' … Сообщение сокращено. Подробности уточните у ответственного.' : text ? '' : '(пустой объект)');
}
