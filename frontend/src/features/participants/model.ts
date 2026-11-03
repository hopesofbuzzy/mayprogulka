import type { components } from '../../shared/api/schema';

export type Participant = components['schemas']['ParticipantListItem'];
export type Registration = components['schemas']['ParticipantRegisterResponse'];
export type ParticipantInput = components['schemas']['ParticipantData'];
export type Route = components['schemas']['RouteResponse'];
export const fieldNames = ['surname', 'name', 'middle_name', 'date_of_birth', 'gender', 'route_id', 'email', 'phone_number'] as const;
export type FieldName = typeof fieldNames[number];
export type Fields = Record<FieldName, string>;
export type Row = { key: string; values: Fields };
export type FieldErrors = Partial<Record<FieldName, string>>;
export type RowErrors = Record<string, FieldErrors>;
export const labels: Record<FieldName, string> = { surname: 'Фамилия', name: 'Имя', middle_name: 'Отчество (необязательно)', date_of_birth: 'Дата рождения', gender: 'Пол', route_id: 'Маршрут', email: 'Email', phone_number: 'Телефон' };

export function emptyRow(key: string): Row {
  return { key, values: { surname: '', name: '', middle_name: '', date_of_birth: '', gender: '', route_id: '', email: '', phone_number: '' } };
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateRows(rows: Row[], routes: Route[]): RowErrors {
  const errors: RowErrors = {};
  for (const row of rows) {
    const values = row.values;
    const fields: FieldErrors = {};
    for (const name of ['surname', 'name', 'phone_number'] as const) if (!values[name].trim()) fields[name] = 'Заполните это поле.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) fields.email = 'Введите корректный email.';
    if (!validDate(values.date_of_birth)) fields.date_of_birth = 'Укажите корректную календарную дату.';
    if (values.gender !== 'male' && values.gender !== 'female') fields.gender = 'Выберите пол.';
    if (!values.route_id || !routes.some(route => route.is_active === true && route.id === Number(values.route_id))) fields.route_id = 'Выберите доступный маршрут из списка.';
    if (Object.keys(fields).length) errors[row.key] = fields;
  }
  return errors;
}

export function registrationBody(rows: Row[]): { participants: ParticipantInput[] } {
  return { participants: rows.map(({ values }) => ({
    surname: values.surname, name: values.name, middle_name: values.middle_name || null,
    date_of_birth: values.date_of_birth, gender: values.gender, route_id: Number(values.route_id),
    email: values.email, phone_number: values.phone_number,
  })) };
}

export function indexedErrors(details: unknown, submittedKeys: string[]): RowErrors {
  const result: RowErrors = {};
  if (!details || typeof details !== 'object' || !('detail' in details) || !Array.isArray(details.detail)) return result;
  for (const issue of details.detail) {
    if (!issue || typeof issue !== 'object' || !('loc' in issue) || !Array.isArray(issue.loc)) continue;
    const path: unknown[] = issue.loc;
    const start = path.indexOf('participants');
    const index = path[start + 1];
    const field = path[start + 2];
    if (start < 0 || path.length !== start + 3 || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || typeof field !== 'string' || !fieldNames.includes(field as FieldName)) continue;
    const key = submittedKeys[index];
    if (!key) continue;
    result[key] = { ...result[key], [field]: `Проверьте поле «${labels[field as FieldName]}»: сервер отклонил значение.` };
  }
  return result;
}

export function paymentLabel(status: string): string {
  if (status === 'paid') return 'Отмечено в системе';
  if (status === 'pending') return 'Не отмечено';
  return 'Требует уточнения';
}

export function validParticipantId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return null;
  return Number(value);
}
