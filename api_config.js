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
 *
 * Аутентификация (JWT Bearer):
 * - Токен хранится в localStorage под ключом mp_auth_token, пользователь (роль и т.д.) — mp_auth_user.
 * - Функция apiRequest(path, options) автоматически добавляет заголовок Authorization: Bearer <token>.
 * - Страницы служебного контура должны вызывать await MP.requireAuth([...роли]) при загрузке.
 */
(function (global) {
  const DEFAULT_API_BASE_URL = 'http://localhost:8000';

  const STORAGE_KEY = 'mp_api_base';
  const AUTH_TOKEN_KEY = 'mp_auth_token';
  const AUTH_USER_KEY = 'mp_auth_user';

  // --- Auth gate («шторка доступа») ---
  // Защищённые страницы помечают <html class="mp-auth-wait"> до первой отрисовки.
  // Пока класс на месте, контент скрыт: пользователь не видит «вспышку»
  // интерфейса до того, как requireAuth проверит токен и роль.
  try {
    const gateStyle = document.createElement('style');
    gateStyle.id = 'mp-auth-gate-style';
    gateStyle.textContent = 'html.mp-auth-wait body{visibility:hidden!important}';
    document.head.appendChild(gateStyle);
  } catch (e) { /* noop */ }

  function releaseAuthGate() {
    try { document.documentElement.classList.remove('mp-auth-wait'); } catch (e) { /* noop */ }
  }

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

  // --- Домашняя страница для каждой роли (после входа) ---
  const ROLE_HOME = {
    user: 'user_cabinet.html',
    typist: 'typist_station.html',
    registrar: 'registrar_terminal.html',
    marker: 'marker_terminal.html',
    organizer: 'index.html',      // панель организатора появится позже
    admin: 'index.html'           // админ-панель появится позже
  };

  // --- Хранилище токена и пользователя ---

  function getAuthToken() {
    try {
      return global.localStorage.getItem(AUTH_TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setAuthToken(token) {
    try {
      if (token) {
        global.localStorage.setItem(AUTH_TOKEN_KEY, token);
      } else {
        global.localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    } catch (e) { /* noop */ }
  }

  function getAuthUser() {
    try {
      const raw = global.localStorage.getItem(AUTH_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setAuthUser(user) {
    try {
      if (user) {
        global.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
      } else {
        global.localStorage.removeItem(AUTH_USER_KEY);
      }
    } catch (e) { /* noop */ }
  }

  function clearAuth() {
    try {
      global.localStorage.removeItem(AUTH_TOKEN_KEY);
      global.localStorage.removeItem(AUTH_USER_KEY);
    } catch (e) { /* noop */ }
  }

  function logout(redirectTo) {
    clearAuth();
    global.location.href = redirectTo || 'login.html';
  }

  // --- Формирование URL ---

  function mpApiUrl(path) {
    if (!path) return baseUrl || '/';
    if (/^https?:\/\//i.test(path)) return path;
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    return baseUrl ? baseUrl + normalizedPath : normalizedPath;
  }

  // --- Универсальный запрос к API ---

  /**
   * Выполняет запрос к API v1 с автоматическим добавлением JWT.
   *
   * @param {string} path - путь, например '/api/v1/auth/me' (можно с base URL через ?api=...)
   * @param {object} [options]
   * @param {string} [options.method='GET']
   * @param {object|FormData|null} [options.body=null] - объект -> JSON, FormData -> как есть
   * @param {object} [options.headers={}] - дополнительные заголовки
   * @param {boolean} [options.auth=true] - добавлять ли Authorization: Bearer <token>
   * @returns {Promise<any>} распарсенный JSON-ответ
   * @throws {Error} с полями .status (HTTP код) и .data (тело ответа)
   */
  async function apiRequest(path, options) {
    const opts = options || {};
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body !== undefined ? opts.body : null;
    const useAuth = opts.auth !== false;

    const headers = Object.assign({}, opts.headers || {});
    if (useAuth) {
      const token = getAuthToken();
      if (token) headers['Authorization'] = 'Bearer ' + token;
    }
    if (body !== null && !(body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const resp = await fetch(mpApiUrl(path), {
      method: method,
      headers: headers,
      body: body === null ? undefined : (body instanceof FormData ? body : JSON.stringify(body))
    });

    let data = null;
    let raw = '';
    try { raw = await resp.text(); } catch (e) { /* noop */ }
    if (raw) {
      try { data = JSON.parse(raw); } catch (e) { data = raw; }
    }

    if (!resp.ok) {
      if (resp.status === 401) {
        // Токен просрочен/невалиден — сбрасываем сессию.
        clearAuth();
      }
      const detail = data && (data.detail || data.message);
      const err = new Error(typeof detail === 'string' ? detail : ('Ошибка API (HTTP ' + resp.status + ')'));
      err.status = resp.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  /**
   * Проверяет авторизацию перед показом страницы.
   * Нет токена или токен невалиден -> редирект на login.html?next=...
   * Роль не входит в список -> редирект на домашнюю страницу роли (?denied=...).
   *
   * @param {string[]|null} [allowedRoles] - null/[] = любая авторизованная роль
   * @returns {Promise<object|null>} объект пользователя (MeResponse) или null (идёт редирект)
   */
  async function requireAuth(allowedRoles) {
    let next = global.location.pathname.split('/').pop() || 'index.html';
    const qs = global.location.search || '';
    if (qs) next += qs;

    if (!getAuthToken()) {
      // Нет токена — уходим на логин. Контент страницы остаётся скрыт шторкой.
      global.location.href = 'login.html?next=' + encodeURIComponent(next);
      return null;
    }

    let me = null;
    try {
      me = await apiRequest('/api/v1/auth/me');
    } catch (e) {
      if (e.status === 401) {
        global.location.href = 'login.html?next=' + encodeURIComponent(next);
        return null;
      }
      // Иные ошибки (сеть/бэк недоступен) — остаёмся на странице:
      // снимаем шторку, страница сама покажет состояние ошибки.
      releaseAuthGate();
      return null;
    }

    setAuthUser(me);

    if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && allowedRoles.indexOf(me.role) === -1) {
      // Пользователь аутентифицирован, но роль не подходит. Отправляем на его
      // домашнюю страницу, а НЕ на логин: перелогин роль не поменяет, а редирект
      // «страница -> логин (next) -> страница» зациклится (мерцание).
      const home = ROLE_HOME[me.role] || 'index.html';
      global.location.href = home + '?denied=' + encodeURIComponent(next);
      return null;
    }

    // Доступ разрешён — открываем страницу.
    releaseAuthGate();
    return me;
  }

  global.MP_CONFIG = {
    API_BASE_URL: baseUrl,
    API_VERSION: 'v1',
    AUTH_TOKEN_KEY: AUTH_TOKEN_KEY,
    AUTH_USER_KEY: AUTH_USER_KEY,
    ROLE_HOME: ROLE_HOME
  };

  global.mpApiUrl = mpApiUrl;

  // Публичное API (глобально)
  global.getAuthToken = getAuthToken;
  global.setAuthToken = setAuthToken;
  global.getAuthUser = getAuthUser;
  global.setAuthUser = setAuthUser;
  global.clearAuth = clearAuth;
  global.logout = logout;
  global.apiRequest = apiRequest;
  global.requireAuth = requireAuth;
})(window);
