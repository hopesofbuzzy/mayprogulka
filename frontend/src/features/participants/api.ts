import { queryOptions, useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { ApiError, StaleSessionError } from '../../shared/api/errors';
import { sessionStore } from '../../shared/session/store';
import { useAuth } from '../auth/AuthProvider';
import type { Participant, ParticipantInput, Registration } from './model';

class InvalidResponseError extends Error {}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object'; }
function isCreated(value: unknown): boolean {
  return object(value) && typeof value.id === 'number' && Number.isSafeInteger(value.id)
    && ['form_id', 'surname', 'name', 'payment_status'].every(field => typeof value[field] === 'string');
}
function isParticipant(value: unknown): value is Participant {
  return isCreated(value) && object(value) && typeof value.route_name === 'string' && typeof value.has_started === 'boolean' && typeof value.has_finished === 'boolean'
    && (value.map_barcode === null || value.map_barcode === undefined || typeof value.map_barcode === 'string');
}

export function myParticipantsOptions(epoch: number) {
  return queryOptions({
    queryKey: ['private', 'participants', epoch] as const,
    meta: { private: true },
    queryFn: async ({ signal }) => {
      if (!sessionStore.isCurrentSession(epoch)) throw new StaleSessionError();
      const { data, response } = await api.GET('/api/v1/participants/my', { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
      if (!sessionStore.isCurrentSession(epoch)) throw new StaleSessionError();
      if (response.status !== 200 || !data || !Array.isArray(data.participants) || !data.participants.every(isParticipant)) throw new InvalidResponseError();
      return data.participants;
    },
    retry: false,
    networkMode: 'always',
    staleTime: 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useMyParticipants(enabled = true) {
  const { isAuthenticated } = useAuth();
  const epoch = sessionStore.getCredentials()?.epoch;
  return useQuery({ ...myParticipantsOptions(epoch ?? -1), enabled: enabled && isAuthenticated && epoch !== undefined });
}

export function participantsError(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Сессия завершена. Войдите снова.';
    if (error.status === 403) return 'Нет доступа к участникам этого аккаунта (403).';
    if (error.status === 404) return 'Сервис участников не найден (404).';
    if (error.status === 422) return 'Сервер отклонил запрос списка участников (422).';
    return `Не удалось загрузить участников. Ошибка сервиса (${error.status}).`;
  }
  if (error instanceof InvalidResponseError) return 'Сервис вернул некорректный список участников. Попробуйте обновить его.';
  return 'Не удалось загрузить участников. Проверьте подключение и повторите загрузку.';
}

export class RegistrationFailure extends Error {
  constructor(message: string, public readonly uncertain: boolean, public readonly details: unknown = undefined) { super(message); }
}

export async function registerParticipants(participants: ParticipantInput[], epoch: number, signal: AbortSignal): Promise<Registration> {
  if (!participants.length) throw new RegistrationFailure('Добавьте хотя бы одного участника.', false);
  if (!sessionStore.isCurrentSession(epoch)) throw new StaleSessionError();
  try {
    const { data, response } = await api.POST('/api/v1/participants/register', {
      body: { participants }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (signal.aborted || !sessionStore.isCurrentSession(epoch)) throw new StaleSessionError();
    if (response.status !== 201 || !data || !Number.isSafeInteger(data.registration_id) || !Array.isArray(data.participants) || !data.participants.every(isCreated)) throw new InvalidResponseError();
    return data;
  } catch (error) {
    if (signal.aborted || !sessionStore.isCurrentSession(epoch) || error instanceof StaleSessionError) throw new StaleSessionError();
    // A 408 may come from infrastructure after the backend has created records.
    if (error instanceof ApiError && error.status < 500 && error.status !== 408) {
      const message = error.status === 422 ? 'Проверьте поля участников. Сервер отклонил данные (422).'
        : error.status === 403 ? 'Нет доступа к регистрации участников (403).'
          : error.status === 409 ? 'Сервер сообщил о конфликте регистрации (409). Проверьте данные и список участников.'
            : `Сервер отклонил регистрацию (${error.status}). Проверьте данные.`;
      throw new RegistrationFailure(message, false, error.details);
    }
    throw new RegistrationFailure('Не удалось получить подтверждение. Участники могли быть зарегистрированы.', true);
  }
}
