/**
 * ecosystem_bar.js • Универсальный навигатор по экосистеме «Майская прогулка 2026»
 * Позволяет мгновенно переключаться между 4 контурами и 9 модулями платформы на любой странице.
 * Dev-инструмент: на этапе полировки скрывается за ?demo=1.
 */
(function() {
  // Dev-навигатор: рендерится только при ?demo=1 в адресной строке.
  // Без параметра не показывается нигде и никому.
  let demo = false;
  try { demo = new URLSearchParams(window.location.search).get('demo') === '1'; } catch (e) { demo = false; }
  if (!demo) return;

  const currentPath = window.location.pathname.split('/').pop() || 'index.html';

  // Текущий пользователь (заполняется на странице логина / requireAuth)
  let currentUser = null;
  try {
    const raw = localStorage.getItem('mp_auth_user');
    currentUser = raw ? JSON.parse(raw) : null;
  } catch (e) { currentUser = null; }

  const ROLE_LABELS = {
    user: 'Участник',
    typist: 'Наборщик',
    registrar: 'Регистратор',
    marker: 'Маркёр',
    organizer: 'Организатор',
    admin: 'Администратор'
  };

  const modules = [
    {
      group: 'I. ПУБЛИЧНЫЙ КОНТУР',
      items: [
        { title: 'Главный портал 2026', file: 'mayprogulka_festival.html', url: '/portal', icon: '🌲', tag: 'Лендинг' },
        { title: 'Интерактивная карта и профиль', file: 'route_selector.html', url: '/routes', icon: '🗺️', tag: 'Маршруты' }
      ]
    },
    {
      group: 'II. ЛИЧНЫЙ КАБИНЕТ (USER)',
      items: [
        { title: 'Кабинет и QR-билеты', file: 'user_cabinet.html', url: '/cabinet', icon: '👤', tag: 'Участник', roles: ['user', 'organizer', 'admin'] }
      ]
    },
    {
      group: 'III. СЛУЖЕБНЫЙ КОНТУР (STAFF)',
      items: [
        { title: 'Стартовый терминал (2 сек)', file: 'registrar_terminal.html', url: '/registrar', icon: '⚡', tag: 'Старт', roles: ['registrar', 'organizer', 'admin'] },
        { title: 'Офлайн-сканер КП (Лес)', file: 'marker_terminal.html', url: '/marker', icon: '📱', tag: 'Маркёр', roles: ['marker', 'organizer', 'admin'] },
        { title: 'Штаб безопасности (МЧС)', file: 'safety_dashboard.html', url: '/safety', icon: '🚨', tag: 'Safety Engine', roles: ['marker', 'organizer', 'admin'] },
        { title: 'Станция оцифровки анкет', file: 'typist_station.html', url: '/typist', icon: '📝', tag: 'Наборщик', roles: ['typist', 'organizer', 'admin'] },
        { title: 'Витрина QR и штрихкодов карт', file: 'registrar_terminal.html?open=cards', url: '/registrar?open=cards', icon: '📋', tag: 'Образцы', roles: ['registrar', 'organizer', 'admin'] }
      ]
    },
    {
      group: 'IV. ЦЕНТР УПРАВЛЕНИЯ (ORGANIZER/ADMIN)',
      items: [
        { title: 'Статистика, участники, маркёры, роли', file: 'control_panel.html', url: '/control', icon: '🎯', tag: 'Орг/Админ', roles: ['organizer', 'admin'] }
      ]
    }
  ];

  function userRole() {
    return currentUser ? currentUser.role : null;
  }

  function hasAccess(item) {
    return !item.roles || (userRole() && item.roles.indexOf(userRole()) !== -1);
  }

  // Helper to determine URL based on environment (file:// vs http://)
  function resolveUrl(item) {
    return item.file;
  }

  // Create UI Container
  const container = document.createElement('div');
  container.id = 'mp-ecosystem-navigator';
  container.className = 'mp-eco-fixed';
  container.innerHTML = `
    <style>
      .mp-eco-fixed {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        font-family: 'Onest', -apple-system, BlinkMacSystemFont, sans-serif;
      }
      .mp-eco-trigger {
        background: #122419;
        color: #FFF8F3;
        border: 2px solid #FF542E;
        padding: 10px 18px;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.4), 0 0 15px rgba(255,84,46,0.3);
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: none;
      }
      .mp-eco-trigger:hover {
        background: #1C3627;
        transform: translateY(-2px);
        box-shadow: 0 14px 28px -5px rgba(0,0,0,0.5), 0 0 20px rgba(255,84,46,0.5);
      }
      .mp-eco-dot {
        width: 8px;
        height: 8px;
        background: #22c55e;
        border-radius: 50%;
        animation: mpEcoPulse 2s infinite;
      }
      @keyframes mpEcoPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.8); }
      }
      .mp-eco-panel {
        display: none;
        position: absolute;
        bottom: 54px;
        right: 0;
        width: 330px;
        max-height: 82vh;
        overflow-y: auto;
        background: #122419;
        border: 2px solid #244732;
        border-radius: 18px;
        padding: 16px;
        box-shadow: 0 20px 40px -10px rgba(0,0,0,0.7);
        color: #FFF8F3;
        animation: mpEcoSlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes mpEcoSlideUp {
        from { opacity: 0; transform: translateY(12px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .mp-eco-panel.open {
        display: block;
      }
      .mp-eco-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 10px;
        border-bottom: 1px solid #244732;
        margin-bottom: 12px;
      }
      .mp-eco-title {
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #FF542E;
      }
      .mp-eco-group-title {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #94a3b8;
        margin: 10px 0 6px 4px;
      }
      .mp-eco-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-radius: 10px;
        background: #183324;
        color: #FFF8F3;
        text-decoration: none;
        margin-bottom: 6px;
        border: 1px solid transparent;
        transition: all 0.15s ease;
      }
      .mp-eco-item:hover {
        background: #204530;
        border-color: #FF542E;
        transform: translateX(3px);
      }
      .mp-eco-item.active {
        background: #255239;
        border-color: #22c55e;
      }
      .mp-eco-item-left {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 600;
      }
      .mp-eco-item-tag {
        font-size: 9px;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(255,255,255,0.08);
        color: #cbd5e1;
        font-family: monospace;
      }
      .mp-eco-hub-link {
        display: block;
        text-align: center;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #244732;
        font-size: 11px;
        color: #cbd5e1;
        text-decoration: none;
        font-family: monospace;
      }
      .mp-eco-hub-link:hover {
        color: #FF542E;
        text-decoration: underline;
      }
    </style>

    <div class="mp-eco-panel" id="mp-eco-panel">
      <div class="mp-eco-head">
        <span class="mp-eco-title">Экосистема Майской прогулки</span>
        <span style="font-size: 11px; color: #64748b; font-family: monospace;" id="mp-eco-count">9 модулей</span>
      </div>

      <div id="mp-eco-auth"></div>

      <div id="mp-eco-groups"></div>

      <a href="index.html" class="mp-eco-hub-link">
        🌐 Главная витрина платформы (Hub) &rarr;
      </a>
    </div>

    <button class="mp-eco-trigger" id="mp-eco-trigger" title="Переключение между модулями системы">
      <span class="mp-eco-dot"></span>
      <span>Экосистема</span>
      <span id="mp-eco-trigger-count" style="background: #FF542E; color: white; padding: 1px 6px; border-radius: 9999px; font-size: 11px;">9</span>
    </button>
  `;

  document.body.appendChild(container);

  // Render Groups & Items (with role-based filtering)
  const groupsContainer = document.getElementById('mp-eco-groups');
  const authContainer = document.getElementById('mp-eco-auth');
  const countEl = document.getElementById('mp-eco-count');
  let html = '';
  let visibleCount = 0;

  modules.forEach(group => {
    const allowedItems = group.items.filter(hasAccess);
    if (allowedItems.length === 0) return;
    visibleCount += allowedItems.length;

    html += `<div class="mp-eco-group-title">${group.group}</div>`;
    allowedItems.forEach(item => {
      // Точное совпадение с учётом query (?open=cards у витрины карт)
      const isCurrent = (resolveUrl(item) === currentPath + window.location.search) ||
                        window.location.pathname === item.url ||
                        window.location.pathname === item.url + '/';
      html += `
        <a href="${resolveUrl(item)}" class="mp-eco-item ${isCurrent ? 'active' : ''}">
          <div class="mp-eco-item-left">
            <span>${item.icon}</span>
            <span>${item.title}</span>
          </div>
          <span class="mp-eco-item-tag">${item.tag}</span>
        </a>
      `;
    });
  });

  if (userRole() === null) {
    html += `
      <div class="mp-eco-group-title">ДОСТУП ОГРАНИЧЕН</div>
      <a href="login.html" class="mp-eco-item" style="border-color:#FF542E;">
        <div class="mp-eco-item-left">
          <span>🔑</span>
          <span>Войдите, чтобы открыть служебный контур</span>
        </div>
        <span class="mp-eco-item-tag">Вход</span>
      </a>
    `;
  }

  if (countEl) countEl.textContent = visibleCount + ' модулей';
  const triggerCount = document.getElementById('mp-eco-trigger-count');
  if (triggerCount) triggerCount.textContent = visibleCount;
  groupsContainer.innerHTML = html;

  // Auth widget (current user + logout)
  if (authContainer) {
    if (currentUser) {
      const roleLabel = ROLE_LABELS[currentUser.role] || currentUser.role;
      authContainer.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;margin-bottom:10px;border-radius:10px;background:#0D1B12;border:1px solid #244732;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <span style="width:26px;height:26px;border-radius:50%;background:#FF542E;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0;">${(currentUser.username || '?').charAt(0).toUpperCase()}</span>
            <div style="min-width:0;">
              <div style="font-size:12px;font-weight:700;color:#FFF8F3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${currentUser.username || ''}</div>
              <div style="font-size:10px;color:#22c55e;font-family:monospace;">${roleLabel}</div>
            </div>
          </div>
          <button id="mp-eco-logout" title="Выйти из системы" style="background:rgba(255,84,46,0.15);border:1px solid rgba(255,84,46,0.5);color:#FF542E;font-size:11px;font-weight:700;padding:5px 10px;border-radius:8px;cursor:pointer;flex-shrink:0;">⎋ Выйти</button>
        </div>
      `;
      const logoutBtn = document.getElementById('mp-eco-logout');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          try {
            localStorage.removeItem('mp_auth_token');
            localStorage.removeItem('mp_auth_user');
          } catch (err) { /* noop */ }
          window.location.href = 'login.html';
        });
      }
    } else {
      authContainer.innerHTML = '';
    }
  }

  // Toggle Panel
  const trigger = document.getElementById('mp-eco-trigger');
  const panel = document.getElementById('mp-eco-panel');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      panel.classList.remove('open');
    }
  });
})();
