import type { components } from '../../shared/api/schema';

export type PublicRoute = components['schemas']['RouteResponse'];
export type Checkpoint = components['schemas']['CheckpointResponse'];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const optionalText = (value: unknown) => value === undefined || value === null || typeof value === 'string';

export function parseRouteId(value: string | undefined): number | null {
  if (!value || /[^0-9]/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function isPublicRoute(value: unknown): value is PublicRoute {
  return object(value) && integer(value.id) && integer(value.year) && typeof value.name === 'string'
    && typeof value.distance === 'number' && Number.isFinite(value.distance) && typeof value.is_active === 'boolean'
    && optionalText(value.description) && optionalText(value.map_url);
}

export function isCheckpoint(value: unknown, routeId: number): value is Checkpoint {
  return object(value) && integer(value.id) && value.route_id === routeId
    && ['name', 'address', 'coordinates'].every(field => typeof value[field] === 'string')
    && integer(value.order) && typeof value.is_start === 'boolean' && typeof value.is_finish === 'boolean';
}

export const uniqueIds = (items: { id: number }[]) => new Set(items.map(item => item.id)).size === items.length;

export function checkpointPathId(path: string): number | null {
  const match = /^\/staff\/routes\/([0-9]+)\/checkpoints$/.exec(path);
  if (!match || match[0] !== path) return null;
  const id = parseRouteId(match[1]);
  return id !== null && String(id) === match[1] ? id : null;
}
