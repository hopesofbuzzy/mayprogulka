/**
 * api_config.js • Единая конфигурация API + авторизация для фронтенда «Майская прогулка 2026»
 *
 * Как указать адрес вашего бэкенда:
 * 1) Если фронт и бэк на одном домене/порту (или настроено проксирование /api -> бэк),
 *    оставьте API_BASE_URL пустой строкой: ''
 * 2) Если бэкенд запущен на другом порту/домене (например, http://localhost:8000),
 *    пропишите его в DEFAULT_API_BASE_URL ниже (без завершающего слэша).
 * 3) Для быстрого переключения в браузере без правки кода можно передать query-параметр:
 *    ?api=http://localhost:8000   (сохранится в localStorage)
 *    ?api=reset                   (сбросит на значение по умолчанию)
 *
 * Авторизация (JWT Bearer):
 * - mpAuth.saveToken(tokenResponse) — сохраняет access_token, user_id, role из ответа /auth/login
 * - mpAuth.getToken() / getRole() / getUserId() / isAuthenticated()
 * - mpAuth.logout() — очищает хранилище и редиректит на login.html
 * - mpApiUrl(path) — строит URL относительно базы /api/v1
 * - mpApi(path, options) — fetch с автоматическим заголовком Authorization: Bearer <token>
 */
(function (global) {
  const DEFAULT_API_BASE_URL = '';

  const STORAGE_KEY = 'mp_api_base';
  const TOKEN_KEY = 'mp_jwt_token';
  const USER_ID_KEY = 'mp_user_id';
  const ROLE_KEY = 'mp_user_role';
  const USERNAME_KEY = 'mp_username';

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

  function storageGet(key) {
    try { return global.localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function storageSet(key, value) {
    try { global.localStorage.setItem(key, value == null ? '' : String(value)); } catch (e) {}
  }
  function storageRemove(key) {
    try { global.localStorage.removeItem(key); } catch (e) {}
  }

  const mpAuth = {
    TOKEN_KEY: TOKEN_KEY,
    ROLES: ['user', 'typist', 'registrar', 'marker', 'organizer', 'admin'],

    saveToken: function (tokenResponse) {
      if (!tokenResponse || !tokenResponse.access_token) return;
      storageSet(TOKEN_KEY, tokenResponse.access_token);
      storageSet(USER_ID_KEY, tokenResponse.user_id != null ? tokenResponse.user_id : '');
      storageSet(ROLE_KEY, tokenResponse.role || 'user');
    },
    getToken: function () { return storageGet(TOKEN_KEY); },
    getAuthToken: function () { return storageGet(TOKEN_KEY); },
    getUserId: function () { return storageGet(USER_ID_KEY); },
    getRole: function () { return storageGet(ROLE_KEY); },
    getUsername: function () { return storageGet(USERNAME_KEY); },
    setUsername: function (name) { storageSet(USERNAME_KEY, name); },
    setRole: function (role) { storageSet(ROLE_KEY, role); },
    isAuthenticated: function () { return !!storageGet(TOKEN_KEY); },
    hasRole: function () {
      var roles = Array.prototype.slice.call(arguments);
      return roles.indexOf(storageGet(ROLE_KEY)) !== -1;
    },
    logout: function (redirect) {
      storageRemove(TOKEN_KEY);
      storageRemove(USER_ID_KEY);
      storageRemove(ROLE_KEY);
      if (redirect !== false) {
        global.location.href = 'login.html';
      }
    },
    /** Защита страницы: редирект на логин, если нет токена; опционально проверка ролей */
    requireAuth: function (roles) {
      if (!this.isAuthenticated()) {
        global.location.href = 'login.html';
        return false;
      }
      if (roles && roles.length && roles.indexOf(this.getRole()) === -1) {
        global.location.href = 'login.html?denied=1';
        return false;
      }
      return true;
    }
  };

  global.MP_CONFIG = {
    API_BASE_URL: baseUrl,
    API_VERSION: '/api/v1'
  };

  /**
   * Строит URL эндпоинта. Принимает путь как '/participants/register'
   * (версия /api/v1 добавляется автоматически), либо полный путь '/api/v1/...'
   * или абсолютный URL.
   */
  global.mpApiUrl = function mpApiUrl(path) {
    if (!path) return (baseUrl || '') + '/api/v1';
    if (/^https?:\/\//i.test(path)) return path;
    var normalizedPath = path.startsWith('/') ? path : '/' + path;
    if (normalizedPath.indexOf('/api/') !== 0) {
      normalizedPath = '/api/v1' + normalizedPath;
    }
    return baseUrl ? baseUrl + normalizedPath : normalizedPath;
  };

  /**
   * fetch-обёртка с автоматической авторизацией.
   * mpApi('/participants/my', { method: 'GET' })
   * Опции: json — тело объекта (сериализуется в JSON), raw — вернуть сырой Response
   */
  global.mpApi = async function mpApi(path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    var token = mpAuth.getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var init = Object.assign({}, options);
    delete init.json;
    delete init.raw;

    if (options.json !== undefined && options.body === undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.json);
    }
    init.headers = headers;

    var resp = await fetch(global.mpApiUrl(path), init);

    if (resp.status === 401 && token) {
      // Токен истёк/невалиден — выходим на страницу логина
      mpAuth.logout();
      throw new Error('Сессия истекла. Войдите заново.');
    }

    if (options.raw) return resp;

    var data = null;
    try { data = await resp.json(); } catch (e) { data = null; }

    if (!resp.ok) {
      var detail = data && (data.detail || data.message);
      if (Array.isArray(detail)) {
        detail = detail.map(function (d) { return d.msg || JSON.stringify(d); }).join('; ');
      }
      var err = new Error(detail || ('Ошибка сервера (' + resp.status + ')'));
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  global.mpAuth = mpAuth;
})(window);
