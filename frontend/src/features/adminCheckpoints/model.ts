import type { components } from '../../shared/api/schema';
import type { Checkpoint } from '../routes/model';
import type { Kind } from '../adminShared/operation';

export type Fields = { name: string; address: string; coordinates: string; order: string; is_start: boolean; is_finish: boolean };
export type Errors = Partial<Record<keyof Fields, string>>;
export type Create = components['schemas']['CheckpointCreateRequest'];
export type Patch = { [K in keyof components['schemas']['CheckpointUpdateRequest']]?: NonNullable<components['schemas']['CheckpointUpdateRequest'][K]> };
export const labels = { name: 'Название КП', address: 'Адрес', coordinates: 'Координаты', order: 'Порядок', is_start: 'Начальный КП', is_finish: 'Конечный КП' };
export const names = Object.keys(labels) as (keyof Fields)[];
export const emptyFields = (): Fields => ({ name: '', address: '', coordinates: '', order: '', is_start: false, is_finish: false });
export const pointFields = (point: Checkpoint): Fields => ({ name: point.name, address: point.address, coordinates: point.coordinates, order: String(point.order), is_start: point.is_start, is_finish: point.is_finish });
const orderNumber = (value: string) => !/\s/.test(value) && /^[+-]?\d+$/.test(value) ? Number(value) : NaN;
export function validate(values: Fields, kind: Kind): Errors {
  if (kind === 'delete') return {};
  const errors: Errors = {};
  for (const field of ['name', 'address', 'coordinates'] as const) if (!values[field].trim()) errors[field] = 'Введите непробельный текст.';
  if (!Number.isSafeInteger(orderNumber(values.order))) errors.order = 'Введите целое число порядка. Слишком большие значения не поддерживаются.';
  return errors;
}
export function createBody(values: Fields, routeId: number): Create { return { ...values, route_id: routeId, order: orderNumber(values.order) }; }
export function updateBody(values: Fields, baseline: Checkpoint): Patch {
  const body: Patch = {};
  for (const field of ['name', 'address', 'coordinates', 'is_start', 'is_finish'] as const) {
    if (values[field] !== baseline[field]) Object.assign(body, { [field]: values[field] });
  }
  if (orderNumber(values.order) !== baseline.order) body.order = orderNumber(values.order);
  return body;
}
export const samePoint = (a: Checkpoint, b: Checkpoint) => a.id === b.id && a.route_id === b.route_id && names.every(field => a[field] === b[field]);
export function rebaseValues(values: Fields, baseline: Checkpoint, current: Checkpoint): Fields {
  const changed = updateBody(values, baseline), next = pointFields(current);
  for (const field of names) if (Object.hasOwn(changed, field)) Object.assign(next, { [field]: values[field] });
  return next;
}
export function serverFields(details: unknown): Errors {
  const errors: Errors = {};
  if (!details || typeof details !== 'object' || !('detail' in details) || !Array.isArray(details.detail)) return errors;
  for (const issue of details.detail) if (issue && typeof issue === 'object' && Array.isArray(issue.loc) && issue.loc.length === 2 && issue.loc[0] === 'body' && names.includes(issue.loc[1])) errors[issue.loc[1] as keyof Fields] = 'Сервер отклонил поле (422). Проверьте значение.';
  return errors;
}
