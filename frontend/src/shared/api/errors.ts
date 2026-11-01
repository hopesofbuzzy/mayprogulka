export class ApiError extends Error {
  constructor(public readonly status: number, public readonly details: unknown = undefined) {
    super(`HTTP ${status}`);
    this.name = 'ApiError';
  }
}

export class StaleSessionError extends Error {
  constructor() {
    super('Session changed while the request was in flight');
    this.name = 'StaleSessionError';
  }
}

export function errorMessage(error: Error): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401: return 'Сервер требует авторизацию для просмотра маршрутов (401).';
      case 403: return 'Сервер ограничил доступ к маршрутам (403).';
      case 404: return 'Сервис маршрутов не найден (404).';
      case 409: return 'Сервер сообщил о конфликте данных (409). Попробуйте обновить список.';
      case 422: return 'Сервер не смог обработать запрос списка маршрутов (422).';
      default: return `Не удалось получить маршруты. Ошибка сервера (${error.status}).`;
    }
  }
  if (error.name === 'TimeoutError') return 'Сервер не ответил вовремя. Проверьте подключение и повторите запрос.';
  return 'Не удалось подключиться к сервису маршрутов. Проверьте подключение и повторите запрос.';
}
