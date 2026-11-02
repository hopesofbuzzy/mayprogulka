import type { components } from '../../shared/api/schema';
import type { PublicRoute } from '../routes/model';

export type CreateRoute = components['schemas']['RouteCreateRequest'];
export type UpdateRoute = Pick<components['schemas']['RouteUpdateRequest'], 'name' | 'distance' | 'description' | 'is_active'>;
export type Kind = 'create' | 'edit' | 'delete';
export type Fields = { year: string; name: string; distance: string; description: string; is_active: boolean };
export type Errors = Partial<Record<keyof Fields, string>>;
export const labels = { year: 'Год', name: 'Название', distance: 'Дистанция, км', description: 'Описание', is_active: 'Флаг активности' };
export const emptyFields = (): Fields => ({ year: '', name: '', distance: '', description: '', is_active: true });
export const routeFields = (route: PublicRoute): Fields => ({ year: String(route.year), name: route.name, distance: String(route.distance), description: route.description ?? '', is_active: route.is_active });
const decimal = (value: string) => !/\s/.test(value) && /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value) ? Number(value.replace(',', '.')) : NaN;
export function validate(values: Fields, kind: Kind): Errors {
  const errors: Errors = {};
  if (kind === 'delete') return errors;
  if (!values.name.trim()) errors.name = 'Введите название маршрута.';
  if (kind === 'create' && (!/^[+-]?\d+$/.test(values.year) || /\s/.test(values.year) || !Number.isSafeInteger(Number(values.year)))) errors.year = 'Введите безопасное целое число года.';
  if (!Number.isFinite(decimal(values.distance))) errors.distance = 'Введите конечное число дистанции.';
  return errors;
}
export function createBody(values: Fields): CreateRoute {
  return { year: Number(values.year), name: values.name, distance: decimal(values.distance), is_active: values.is_active,
    ...(values.description === '' ? {} : { description: values.description }) };
}
export function updateBody(values: Fields, baseline: PublicRoute): UpdateRoute {
  const body: UpdateRoute = {};
  if (values.name !== baseline.name) body.name = values.name;
  if (decimal(values.distance) !== baseline.distance) body.distance = decimal(values.distance);
  if (values.description !== (baseline.description ?? '')) body.description = values.description === '' ? null : values.description;
  if (values.is_active !== baseline.is_active) body.is_active = values.is_active;
  return body;
}
export function serverFields(details: unknown): Errors {
  const errors: Errors = {};
  if (!details || typeof details !== 'object' || !('detail' in details) || !Array.isArray(details.detail)) return errors;
  for (const item of details.detail) {
    if (!item || typeof item !== 'object' || !Array.isArray(item.loc) || item.loc.length !== 2 || item.loc[0] !== 'body') continue;
    const field = item.loc[1] as keyof Fields;
    if (Object.hasOwn(labels, field)) errors[field] = 'Сервер отклонил значение. Проверьте поле (422).';
  }
  return errors;
}
