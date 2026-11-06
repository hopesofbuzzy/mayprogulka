import { describe, expect, it } from 'vitest';
import { emptyRow, registrationBody, validBirthDate, validPersonName, validPhone, validateRows } from './model';
import { validCoordinates, validate as validatePoint, pointFields, updateBody } from '../adminCheckpoints/model';
import { validateRows as validateBatch } from '../adminCheckpoints/batch/model';
import { emptyFields, validate as validateRoute } from '../adminRoutes/model';

describe('obvious participant input errors without family uniqueness rules', () => {
  it.each(['123', 'Иван7', '---', '🤖', 'Иван\nПетров', '<Иван>'])('rejects a nonsensical name %s', name => expect(validPersonName(name)).toBe(false));
  it.each(['Анна-Мария', 'О’Коннор', "Д'Артаньян", '王 小明', 'José de la Cruz', 'Нгуен Ван', 'E\u0301mile'])('keeps Unicode names %s', name => expect(validPersonName(name)).toBe(true));
  it.each(['', '123', 'abc123456789', '+7', '1234567890123456', '++++', '900@1234567'])('rejects nonsensical phone %s', phone => expect(validPhone(phone)).toBe(false));
  it.each(['+7 (900) 123-45-67', '0012345678', '+1 212 555 0100', '1234567 доб. 2'])('keeps plausible phone formatting %s', phone => expect(validPhone(phone)).toBe(true));
  it.each([['2000-02-29', true], ['1900-02-29', false], ['2026-04-31', false], ['2026-11-06', true], ['2026-11-07', false], ['1222-01-01', true]])('birth date %s respects the local day without an age limit', (date, valid) => expect(validBirthDate(date, new Date(2026, 10, 6, 10))).toBe(valid));
  it('accepts shared family contacts and trims only outer whitespace in the DTO', () => {
    const rows = ['a', 'b'].map(key => ({ ...emptyRow(key), values: { surname: '  О’Коннор  ', name: ' Анна-Мария ', middle_name: ' ', date_of_birth: '2000-02-29', gender: 'female', route_id: '12', email: ' family@example.test ', phone_number: ' +7 (900) 123-45-67 ' } }));
    const routes = [{ id: 12, year: 2026, name: 'Синтетический маршрут', distance: 12, is_active: true }];
    expect(validateRows(rows, routes)).toEqual({});
    const body = registrationBody(rows);
    expect(body.participants[0]).toMatchObject({ surname: 'О’Коннор', name: 'Анна-Мария', middle_name: null, phone_number: '+7 (900) 123-45-67', email: 'family@example.test' });
    expect(body.participants[0]).toEqual(body.participants[1]);
  });
});

describe('approved client coordinate and year rules', () => {
  it.each(['56.83, 60.60', ' -90, +180 ', '90, -180', '0,0', '  056.8300 , 060.6000  ', '-.5, +.25'])('accepts WGS84 string %s without rewriting it', coordinates => {
    expect(validCoordinates(coordinates)).toBe(true);
    const values = { name: 'КП', address: 'Адрес', coordinates, order: '0', is_start: true, is_finish: true };
    expect(validatePoint(values, 'create')).toEqual({});
    expect(validateBatch([{ key: 'one', values }])).toEqual({});
  });
  it.each(['', 'abc', '56.83;60.60', '56,83,60,60', '56.83 60.60', '91,0', '0,-181', 'NaN,60', 'Infinity,0', '1e1,60', '1,2,3'])('rejects %s consistently in single and batch forms', coordinates => {
    const values = { name: 'КП', address: 'Адрес', coordinates, order: '0', is_start: false, is_finish: false };
    expect(validCoordinates(coordinates)).toBe(false);
    expect(validatePoint(values, 'create').coordinates).toContain('56.83, 60.60');
    expect(validateBatch([{ key: 'one', values }]).one?.coordinates).toContain('56.83, 60.60');
  });
  it('allows a partial edit of legacy coordinates without sending or silently fixing them', () => {
    const point = { id: 1, route_id: 12, name: 'КП', address: 'Адрес', coordinates: 'legacy opaque', order: 0, is_start: true, is_finish: true };
    const values = { ...pointFields(point), name: 'Другое название' };
    expect(validatePoint(values, 'edit', point)).toEqual({});
    expect(updateBody(values, point)).toEqual({ name: 'Другое название' });
    expect(validatePoint({ ...values, coordinates: 'bad new value' }, 'edit', point).coordinates).toBeDefined();
  });
  it.each(['1900', '2026', '2100'])('accepts route year %s', year => expect(validateRoute({ ...emptyFields(), year, name: 'Маршрут', distance: '12' }, 'create')).toEqual({}));
  it.each(['1899', '2101', '12221', '-2026', '2026.5', '+2026', '02026', ' 2026', '2026\n'])('rejects route year %s with the agreed message', year => expect(validateRoute({ ...emptyFields(), year, name: 'Маршрут', distance: '12' }, 'create').year).toBe('Укажите год от 1900 до 2100'));
  it('does not block unrelated edits to a legacy route whose immutable year is outside the new range', () => expect(validateRoute({ ...emptyFields(), year: '12221', name: 'Маршрут', distance: '12' }, 'edit')).toEqual({}));
});
