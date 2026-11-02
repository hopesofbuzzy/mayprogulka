import type { components } from '../../shared/api/schema';
import { emptyRow, registrationBody, validateRows } from '../participants/model';
import type { Fields, FieldName, Route } from '../participants/model';

export type PaperInput = components['schemas']['PaperFormRequest'];
export type PaperResult = components['schemas']['PaperFormResponse'];
export type MatchInput = components['schemas']['MatchRequest'];
export type MatchResult = components['schemas']['MatchResponse'];
export type UnlinkedMap = components['schemas']['UnlinkedMapResponse'];
export type Errors<V> = Partial<Record<keyof V, string>>;
export const emptyPaper = () => emptyRow('paper').values;
export const emptyMatch = (): MatchInput => ({ form_id: '', barcode: '' });
export const paperBody = (values: Fields): PaperInput => registrationBody([{ key: 'paper', values }]).participants[0]!;
export const validatePaper = (values: Fields, routes: Route[]): Errors<Fields> => validateRows([{ key: 'paper', values }], routes).paper ?? {};
export function validateMatch(values: MatchInput): Errors<MatchInput> {
  return { ...(!values.form_id.trim() ? { form_id: 'Укажите номер анкеты.' } : {}), ...(!values.barcode.trim() ? { barcode: 'Укажите штрихкод физической карты.' } : {}) };
}
export function serverFields<V>(details: unknown, names: readonly (keyof V)[]): Errors<V> {
  const errors: Errors<V> = {};
  if (!details || typeof details !== 'object' || !('detail' in details) || !Array.isArray(details.detail)) return errors;
  for (const issue of details.detail) {
    if (!issue || typeof issue !== 'object' || !('loc' in issue) || !Array.isArray(issue.loc)) continue;
    if (issue.loc.length !== 2 || issue.loc[0] !== 'body' || !names.includes(issue.loc[1] as keyof V)) continue;
    errors[issue.loc[1] as keyof V] = 'Проверьте поле: сервер отклонил значение.';
  }
  return errors;
}
export type PaperField = FieldName;
