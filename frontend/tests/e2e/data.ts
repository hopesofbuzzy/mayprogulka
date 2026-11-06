import type { components } from '../../src/shared/api/schema';

// Synthetic records only. IDs deliberately differ from form/barcode strings.
export const routes = [
  { id: 12, name: 'Тестовая лесная тропа', year: 2026, distance: 12, is_active: true },
  { id: 15, name: 'Тестовый городской маршрут', year: 2025, distance: 18, is_active: true },
  { id: 17, name: 'Неактивный тестовый маршрут', year: 2024, distance: 33, is_active: false },
] satisfies components['schemas']['RouteResponse'][];
export const participants = [
  { id: 42, form_id: '00042', surname: 'Тестов', name: 'Первый', route_name: routes[0]!.name, payment_status: 'unpaid', has_started: false, has_finished: false, map_barcode: '000777' },
  { id: 77, form_id: '00077', surname: 'Тестова', name: 'Вторая', route_name: routes[1]!.name, payment_status: 'unpaid', has_started: false, has_finished: false, map_barcode: null },
] satisfies components['schemas']['ParticipantListItem'][];
export const otherParticipants = [{ ...participants[0], id: 99, surname: 'Другой', name: 'Аккаунт', form_id: '00099', map_barcode: null }];
export const registration = {
  registration_id: 900,
  participants: participants.map(({ id, form_id, surname, name, payment_status }) => ({ id, form_id, surname, name, payment_status })),
} satisfies components['schemas']['ParticipantRegisterResponse'];
