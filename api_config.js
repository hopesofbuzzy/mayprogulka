/**
 * api_config.js • Единая конфигурация API для фронтенда «Майская прогулка 2026»
 *
 * Как указать адрес вашего бэкенда:
 * 1) Если фронт и бэк на одном домене/порту (или настроено проксирование /api -> бэк),
 *    оставьте API_BASE_URL пустой строкой: ''
 * 2) Если бэкенд запущен на другом порту/домене (например, http://localhost:8000 или https://api.example.com),
 *    пропишите его в DEFAULT_API_BASE_URL ниже (без завершающего слэша).
 * 3) Для быстрого переключения в браузере без правки кода можно передать query-параметр:
 *    ?api=http://localhost:8000   (сохранится в localStorage)
 *    ?api=reset                   (сбросит на значение по умолчанию)
 */
(function (global) {
  const DEFAULT_API_BASE_URL = '';

  const STORAGE_KEY = 'mp_api_base';
  try {
    const params = new URLSearchParams(global.location.search);
    const apiParam = params.get('api');
    if (apiParam === 'reset') {
      global.localStorage.removeItem(STORAGE_KEY);
    } else if (apiParam) {
      global.localStorage.setItem(STORAGE_KEY, apiParam.replace(/\/+$/, ''));
    }
  } catch (e) {
    // localStorage/URLSearchParams unavailable
  }

  let savedBase = '';
  try {
    savedBase = global.localStorage.getItem(STORAGE_KEY) || '';
  } catch (e) {
    savedBase = '';
  }

  const baseUrl = (savedBase || DEFAULT_API_BASE_URL || '').replace(/\/+$/, '');

  global.MP_CONFIG = {
    API_BASE_URL: baseUrl
  };

  global.mpApiUrl = function mpApiUrl(path) {
    if (!path) return baseUrl || '/';
    if (/^https?:\/\//i.test(path)) return path;
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    return baseUrl ? baseUrl + normalizedPath : normalizedPath;
  };
})(window);
