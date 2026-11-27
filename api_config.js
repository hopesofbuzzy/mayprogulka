(function (global) {
  const AUTH_TOKEN_KEY = 'mp_auth_token';
  const LEGACY_USER_KEY = 'mp_auth_user';
  const ROLE_HOME = {
    user: 'user_cabinet.html',
    typist: 'typist_station.html',
    registrar: 'registrar_terminal.html',
    marker: 'marker_terminal.html',
    organizer: 'control_panel.html',
    admin: 'control_panel.html'
  };
  const PAGE_ROLES = {
    'user_cabinet.html': ['user', 'admin'],
    'typist_station.html': ['typist', 'admin'],
    'registrar_terminal.html': ['registrar', 'organizer', 'admin'],
    'marker_terminal.html': ['marker', 'organizer', 'admin'],
    'control_panel.html': ['organizer', 'admin']
  };
  const PUBLIC_PAGES = ['index.html', 'mayprogulka_festival.html', 'route_selector.html'];
  let verifiedUser = null;
  let verifiedToken = '';
  // An invalidated document can only be replaced by navigation or reload.
  let sessionInvalidated = false;

  const gateStyle = document.createElement('style');
  gateStyle.textContent = `
    #mp-auth-status { max-width: 32rem; margin: 3rem auto; padding: 1.25rem; color: #fff; background: #14291d; border-radius: 1rem; }
    #mp-auth-status a { display: inline-block; margin: .75rem 1rem 0 0; text-decoration: underline; }
  `;
  document.head.appendChild(gateStyle);

  function getAuthToken() {
    try {
      return global.localStorage.getItem(AUTH_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function setAuthToken(token) {
    try {
      global.localStorage.removeItem(LEGACY_USER_KEY);
      if (token) global.localStorage.setItem(AUTH_TOKEN_KEY, token);
      else global.localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch { /* localStorage unavailable */ }
    getAuthUser();
  }

  function invalidatePageSession() {
    if (!verifiedToken || sessionInvalidated) return;
    sessionInvalidated = true;
    verifiedUser = null;
    document.documentElement.classList.add('mp-auth-wait');
    document.dispatchEvent(new Event('mp-auth-invalidated'));
    showAuthGateError(loginUrlFor(currentDestination()), true);
  }

  function getAuthUser() {
    if (verifiedToken && verifiedToken !== getAuthToken()) invalidatePageSession();
    return verifiedUser;
  }

  function checkRequestSession(snapshot) {
    const currentToken = getAuthToken();
    if (verifiedToken && currentToken !== verifiedToken) invalidatePageSession();
    if (sessionInvalidated || currentToken !== snapshot) {
      throw new Error('Сессия изменилась. Повторите проверку или войдите снова.');
    }
  }

  global.addEventListener('storage', event => {
    if (event.storageArea === global.localStorage &&
        (event.key === null || event.key === AUTH_TOKEN_KEY && event.newValue !== verifiedToken)) {
      invalidatePageSession();
    }
  });
  global.addEventListener('pageshow', event => {
    if (event.persisted) getAuthUser();
  });

  function clearAuth() { setAuthToken(''); }

  function logout() {
    clearAuth();
    global.location.href = 'login.html';
  }

  function canAccessPage(page, role) {
    return PUBLIC_PAGES.includes(page) ||
      (Object.hasOwn(PAGE_ROLES, page) && PAGE_ROLES[page].includes(role));
  }

  function localDestination(value) {
    const match = typeof value === 'string' && /^\/?([a-z_]+\.html)(?:\?([^#]*))?$/.exec(value);
    if (!match) return null;
    const [, page, query] = match;
    if (!Object.hasOwn(PAGE_ROLES, page) && !PUBLIC_PAGES.includes(page)) return null;

    const input = new URLSearchParams(query);
    const params = new URLSearchParams();
    if (page === 'user_cabinet.html') {
      const route = input.get('route');
      if (route && /^[A-Za-z0-9_-]{1,40}$/.test(route)) params.set('route', route);
      if (input.get('new') === '1' || input.get('register') === '1') params.set('new', '1');
    }
    if (page === 'registrar_terminal.html' && input.get('open') === 'cards') params.set('open', 'cards');
    return { page, path: params.size ? page + '?' + params : page };
  }

  function postLoginDestination(next, role) {
    const target = localDestination(next);
    return target && canAccessPage(target.page, role) ? target.path : ROLE_HOME[role];
  }

  function mpApiUrl(path) {
    if (typeof path !== 'string' || !/^\/api\/v1\/[a-zA-Z0-9_/-]/.test(path) || /[\\\r\n\t#]/.test(path)) {
      throw new Error('Недопустимый путь API');
    }
    const url = new URL(path, global.location.origin);
    if (!url.pathname.startsWith('/api/v1/') || url.origin !== global.location.origin) {
      throw new Error('Недопустимый путь API');
    }
    return path;
  }

  async function apiRequest(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ?? null;
    const snapshot = getAuthToken();
    const token = options.auth === false ? '' : snapshot;
    const headers = new Headers(options.headers);
    headers.delete('Authorization');
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (body !== null && !(body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const url = mpApiUrl(path);
    const requestBody = body === null ? undefined : (body instanceof FormData ? body : JSON.stringify(body));
    checkRequestSession(snapshot);
    let response;
    let raw;
    try {
      response = await fetch(url, {
        method, headers, signal: options.signal, redirect: 'error', body: requestBody
      });
      raw = await response.text();
    } finally {
      checkRequestSession(snapshot);
    }
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = raw; }
    }
    if (!response.ok) {
      if (response.status === 401 && token && token === getAuthToken()) clearAuth();
      const detail = data && (data.detail || data.message);
      const error = new Error(typeof detail === 'string' ? detail : ('Ошибка API (HTTP ' + response.status + ')'));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return options.withStatus ? { status: response.status, data } : data;
  }

  async function verifyAuthSession() {
    const token = getAuthToken();
    if (!token) throw Object.assign(new Error('Войдите в систему.'), { status: 401 });
    const user = await apiRequest('/api/v1/auth/me', { signal: AbortSignal.timeout(12000) });
    if (token !== getAuthToken()) throw new Error('Сессия изменилась. Повторите вход.');
    if (!user || user.is_active !== true || typeof user.role !== 'string' || !Object.hasOwn(ROLE_HOME, user.role) ||
        !Number.isSafeInteger(user.user_id) || user.user_id <= 0 ||
        typeof user.username !== 'string' || !user.username.trim() ||
        typeof user.email !== 'string' || !user.email.trim()) {
      throw new Error('Сессия не подтверждена. Войдите снова или повторите проверку.');
    }
    return { user, token };
  }

  function currentDestination() {
    return localDestination(global.location.pathname + global.location.search);
  }

  function loginUrlFor(destination) {
    return 'login.html?error=auth&next=' + encodeURIComponent(destination?.path || '');
  }

  function showAuthGateError(loginUrl, sessionChanged = false) {
    if (document.getElementById('mp-auth-status')) return;
    const status = document.createElement('section');
    status.id = 'mp-auth-status';
    status.setAttribute('role', 'alert');
    status.tabIndex = -1;
    const message = document.createElement('p');
    message.textContent = sessionChanged
      ? 'Сессия изменилась. Повторите проверку или войдите снова.'
      : 'Не удалось подтвердить доступ. Повторите проверку или войдите снова.';
    const retry = document.createElement('a');
    retry.href = global.location.pathname + global.location.search;
    retry.textContent = 'Повторить проверку';
    const login = document.createElement('a');
    login.href = loginUrl;
    login.textContent = 'Войти';
    if (!sessionChanged) login.addEventListener('click', clearAuth);
    status.append(message, retry, login);
    document.body.append(status);
    status.focus();
  }

  async function requireAuth() {
    const current = currentDestination();
    const loginUrl = loginUrlFor(current);
    if (!getAuthToken()) {
      global.location.href = loginUrl;
      return null;
    }

    let session;
    try {
      session = await verifyAuthSession();
    } catch (error) {
      if (error.status === 401 && !getAuthToken()) global.location.href = loginUrl;
      else showAuthGateError(loginUrl);
      return null;
    }
    if (session.token !== getAuthToken()) {
      showAuthGateError(loginUrl);
      return null;
    }
    const { user } = session;
    if (!current || !canAccessPage(current.page, user.role)) {
      global.location.href = ROLE_HOME[user.role] + '?denied=' + encodeURIComponent(current?.page || '');
      return null;
    }
    verifiedUser = user;
    verifiedToken = session.token;
    document.documentElement.classList.remove('mp-auth-wait');
    document.dispatchEvent(new Event('mp-auth-ready'));
    return user;
  }

  global.MP_CONFIG = { API_BASE_URL: '', API_VERSION: 'v1', AUTH_TOKEN_KEY, ROLE_HOME };
  Object.assign(global, {
    mpApiUrl, getAuthToken, setAuthToken, getAuthUser, clearAuth, logout,
    apiRequest, requireAuth, verifyAuthSession, postLoginDestination, canAccessPage
  });
})(window);
