import { api } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import { sessionStore } from '../../shared/session/store';
import type { TokenResponse } from '../../shared/session/store';

export type AuthMode = 'login' | 'signup';
export type FieldName = 'username' | 'email' | 'password' | 'confirmation';
export type AuthFields = Record<FieldName, string>;
export type FieldErrors = Partial<Record<FieldName, string>>;

export class AuthError extends Error {
  constructor(message: string, public readonly fields: FieldErrors = {}) { super(message); this.name = 'AuthError'; }
}
export class CancelledAuthError extends Error {}

export function validateAuth(mode: AuthMode, fields: AuthFields): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.username.trim()) errors.username = 'Введите имя пользователя.';
  if (!fields.password) errors.password = 'Введите пароль.';
  if (mode === 'signup') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = 'Введите корректный email.';
    if ([...fields.password].length < 6 || [...fields.password].length > 72) errors.password = 'Пароль должен содержать от 6 до 72 символов.';
    if (fields.password !== fields.confirmation) errors.confirmation = 'Пароли не совпадают.';
  }
  return errors;
}

function serverError(error: ApiError, mode: AuthMode): AuthError {
  const fields: FieldErrors = {};
  if (error.status === 422 && error.details && typeof error.details === 'object' && 'detail' in error.details && Array.isArray(error.details.detail)) {
    for (const item of error.details.detail) {
      if (!item || typeof item !== 'object' || !('loc' in item) || !Array.isArray(item.loc)) continue;
      const field: unknown = item.loc[item.loc.length - 1];
      if (field === 'username') fields.username = 'Сервер отклонил имя пользователя. Проверьте логин.';
      if (field === 'email') fields.email = 'Сервер отклонил email. Проверьте адрес электронной почты.';
      if (field === 'password') fields.password = mode === 'signup' ? 'Проверьте пароль: от 6 до 72 символов.' : 'Сервер отклонил пароль. Проверьте ввод.';
    }
  }
  if (error.status === 401 || (error.status === 400 && mode === 'login')) return new AuthError('Неверное имя пользователя или пароль.');
  if (error.status === 403) return new AuthError('Нет доступа. Сервер отклонил запрос.');
  if (error.status === 422) return new AuthError('Проверьте введённые данные.', fields);
  if (error.status === 409) return new AuthError('Не удалось создать аккаунт: конфликт данных. Проверьте логин и email.');
  if (error.status === 400) return new AuthError('Сервер отклонил данные регистрации. Проверьте заполнение формы.');
  return new AuthError(`Сервис временно недоступен (${error.status}). Повторите попытку позже.`);
}

function isTokenResponse(value: unknown): value is TokenResponse {
  if (!value || typeof value !== 'object') return false;
  return 'access_token' in value && typeof value.access_token === 'string' && value.access_token.trim().length > 0
    && 'user_id' in value && typeof value.user_id === 'number' && Number.isInteger(value.user_id)
    && 'role' in value && typeof value.role === 'string'
    && (!('token_type' in value) || typeof value.token_type === 'string');
}

export async function authenticate(mode: AuthMode, fields: Pick<AuthFields, 'username' | 'email' | 'password'>, signal: AbortSignal) {
  const ticket = sessionStore.beginAuthentication();
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  try {
    const result = mode === 'signup'
      ? await api.POST('/api/v1/auth/register', { body: { username: fields.username, email: fields.email, password: fields.password }, signal: requestSignal })
      : await api.POST('/api/v1/auth/login', { body: { username: fields.username, password: fields.password }, signal: requestSignal });
    if (signal.aborted || !sessionStore.isCurrentAttempt(ticket)) throw new CancelledAuthError();
    if (result.response.status !== (mode === 'signup' ? 201 : 200) || !isTokenResponse(result.data)) throw new AuthError('Сервис вернул неожиданный ответ. Вход не подтверждён.');
    if (!sessionStore.login(result.data, ticket)) throw new CancelledAuthError();
  } catch (error) {
    if (signal.aborted || !sessionStore.isCurrentAttempt(ticket)) throw new CancelledAuthError();
    if (error instanceof ApiError) throw serverError(error, mode);
    if (error instanceof AuthError || error instanceof CancelledAuthError) throw error;
    if (error instanceof SyntaxError) throw new AuthError('Сервис вернул некорректный ответ. Вход не подтверждён.');
    throw new AuthError(mode === 'signup'
      ? 'Ответ сервера не получен. Аккаунт мог быть создан — попробуйте войти перед повторной регистрацией.'
      : 'Не удалось подключиться к сервису входа. Проверьте подключение и попробуйте ещё раз.');
  } finally { sessionStore.cancelAuthentication(ticket); }
}
