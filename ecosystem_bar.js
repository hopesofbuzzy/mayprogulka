/**
 * ecosystem_bar.js • Универсальный навигатор по экосистеме «Майская прогулка 2026»
 * Позволяет мгновенно переключаться между 3 контурами и 7 модулями платформы на любой странице.
 */
(function() {
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';

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
        { title: 'Кабинет семьи и QR-билеты', file: 'user_cabinet.html', url: '/cabinet', icon: '👤', tag: 'Участник' }
      ]
    },
    {
      group: 'III. СЛУЖЕБНЫЙ КОНТУР (STAFF)',
      items: [
        { title: 'Стартовый терминал (2 сек)', file: 'registrar_terminal.html', url: '/registrar', icon: '⚡', tag: 'Старт' },
        { title: 'Офлайн-сканер КП (Лес)', file: 'marker_terminal.html', url: '/marker', icon: '📱', tag: 'Маркёр' },
        { title: 'Штаб безопасности (МЧС)', file: 'safety_dashboard.html', url: '/safety', icon: '🚨', tag: 'Safety Engine' },
        { title: 'Станция оцифровки анкет', file: 'typist_station.html', url: '/typist', icon: '📝', tag: 'AI-OCR' }
      ]
    }
  ];

  // Helper to determine URL based on environment (file:// vs http://)
  function resolveUrl(item) {
    if (window.location.protocol === 'file:') {
      return item.file;
    }
    return item.url || item.file;
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
        <span style="font-size: 11px; color: #64748b; font-family: monospace;">7 модулей</span>
      </div>

      <div id="mp-eco-groups"></div>

      <a href="${window.location.protocol === 'file:' ? 'index.html' : '/'}" class="mp-eco-hub-link">
        🌐 Главная витрина платформы (Hub) &rarr;
      </a>
    </div>

    <button class="mp-eco-trigger" id="mp-eco-trigger" title="Переключение между модулями системы">
      <span class="mp-eco-dot"></span>
      <span>Экосистема</span>
      <span style="background: #FF542E; color: white; padding: 1px 6px; border-radius: 9999px; font-size: 11px;">7</span>
    </button>
  `;

  document.body.appendChild(container);

  // Render Groups & Items
  const groupsContainer = document.getElementById('mp-eco-groups');
  let html = '';
  modules.forEach(group => {
    html += `<div class="mp-eco-group-title">${group.group}</div>`;
    group.items.forEach(item => {
      const isCurrent = (currentPath && currentPath.includes(item.file)) || 
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
  groupsContainer.innerHTML = html;

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
