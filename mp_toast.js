/**
 * mp_toast.js • Единые уведомления для терминалов «Майской прогулки 2026»
 * Заменяет alert()/confirm() на неблокирующие тосты и диалоги в стиле дизайн-системы.
 *
 *   MPToast.show('Текст', 'success')            // success | error | warn | info
 *   MPToast.dialog('Заголовок', 'Длинный текст') // карточка по центру (Form ID, инструкции)
 *   MPToast.arm(btn, 'Удалить?', () => {...})    // подтверждение вторым нажатием вместо confirm()
 */
(function(global) {
  'use strict';

  let box = null;
  let dialogEl = null;

  function ensureBox() {
    if (box && document.body.contains(box)) return box;
    box = document.createElement('div');
    box.id = 'mp-toast-box';
    box.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:999999;' +
      'display:flex;flex-direction:column;gap:8px;width:min(480px,calc(100vw - 24px));' +
      "font-family:'Onest',-apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none;";
    document.body.appendChild(box);
    return box;
  }

  const STYLES = {
    success: { icon: '✅', border: '#22c55e', accent: '#bbf7d0', bg: 'rgba(12,38,23,0.97)' },
    error:   { icon: '⛔', border: '#ef4444', accent: '#fecaca', bg: 'rgba(42,13,13,0.97)' },
    warn:    { icon: '⚠️', border: '#f59e0b', accent: '#fde68a', bg: 'rgba(42,31,7,0.97)' },
    info:    { icon: '💡', border: '#3b82f6', accent: '#bfdbfe', bg: 'rgba(13,33,55,0.97)' }
  };

  const DEFAULT_TIMEOUT = { success: 4500, error: 8000, warn: 6500, info: 5500 };

  /**
   * Показать тост. text — простой текст (\\n переносится, HTML не интерпретируется).
   */
  function show(text, type, opts) {
    opts = opts || {};
    const s = STYLES[type] || STYLES.info;
    ensureBox();

    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.style.cssText = 'pointer-events:auto;background:' + s.bg + ';backdrop-filter:blur(4px);' +
      'border:1px solid ' + s.border + ';border-left-width:4px;color:#fff;' +
      'padding:11px 13px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);' +
      'font-size:13px;line-height:1.45;display:flex;gap:10px;align-items:flex-start;' +
      'animation:mpToastIn .22s ease-out;';

    const icon = document.createElement('span');
    icon.textContent = s.icon;
    icon.style.cssText = 'font-size:15px;line-height:1.3;flex-shrink:0;';

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0;color:' + s.accent + ';white-space:pre-line;word-break:break-word;';
    body.textContent = String(text == null ? '' : text);

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.style.cssText = 'background:none;border:0;color:rgba(255,255,255,.45);cursor:pointer;' +
      'font-size:12px;padding:2px;flex-shrink:0;line-height:1;';
    close.addEventListener('click', function() { dismiss(); });

    function dismiss() {
      if (!el.parentNode) return;
      el.style.opacity = '0';
      el.style.transition = 'opacity .18s';
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 190);
    }

    el.appendChild(icon);
    el.appendChild(body);
    el.appendChild(close);
    ensureBox().appendChild(el);

    const ms = opts.timeout != null ? opts.timeout : (DEFAULT_TIMEOUT[type] || 5000);
    if (ms > 0) setTimeout(dismiss, ms);
    return dismiss;
  }

  /**
   * Диалог-карточка для длинной важной информации (Form ID, инструкции МЧС).
   * Закрывается крестиком, кликом по фону или Esc.
   */
  function dialog(title, text, type) {
    const s = STYLES[type] || STYLES.info;
    closeDialog();

    dialogEl = document.createElement('div');
    dialogEl.id = 'mp-toast-dialog';
    dialogEl.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.72);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;' +
      "font-family:'Onest',-apple-system,BlinkMacSystemFont,sans-serif;";

    const card = document.createElement('div');
    card.style.cssText = 'background:#14291D;border:1px solid ' + s.border + ';border-radius:18px;' +
      'max-width:520px;width:100%;max-height:85vh;overflow-y:auto;padding:20px 22px;' +
      'box-shadow:0 25px 60px rgba(0,0,0,.6);animation:mpToastIn .2s ease-out;';

    const head = document.createElement('div');
    head.style.cssText = 'font-size:14px;font-weight:800;color:' + s.accent + ';margin-bottom:10px;' +
      'text-transform:uppercase;letter-spacing:.04em;';
    head.textContent = s.icon + '  ' + (title || 'Информация');

    const bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'color:#fff;font-size:13px;line-height:1.55;white-space:pre-line;word-break:break-word;';
    bodyEl.textContent = String(text == null ? '' : text);

    const closer = document.createElement('button');
    closer.type = 'button';
    closer.textContent = 'Понятно';
    closer.style.cssText = 'margin-top:16px;background:#1C3828;border:1px solid #244732;color:#fff;' +
      'padding:9px 22px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;';
    closer.addEventListener('click', closeDialog);

    card.appendChild(head);
    card.appendChild(bodyEl);
    card.appendChild(closer);
    dialogEl.appendChild(card);
    dialogEl.addEventListener('click', function(e) { if (e.target === dialogEl) closeDialog(); });
    document.body.appendChild(dialogEl);

    document.addEventListener('keydown', escHandler);
  }

  function escHandler(e) {
    if (e.key === 'Escape') closeDialog();
  }

  function closeDialog() {
    if (dialogEl && dialogEl.parentNode) dialogEl.parentNode.removeChild(dialogEl);
    dialogEl = null;
    document.removeEventListener('keydown', escHandler);
  }

  /**
   * Подтверждение вторым нажатием (замена confirm()).
   * Первый клик подсвечивает кнопку и меняет надпись, второй — вызывает действие.
   *
   *   <button onclick="MPToast.arm(this, 'Точно удалить?', () => doDelete(id))">
   */
  function arm(btn, confirmLabel, fn, opts) {
    opts = opts || {};
    if (!btn) return;
    if (btn.dataset.mpArmed === '1') {
      btn.dataset.mpArmed = '';
      btn.textContent = btn.dataset.mpOriginalText || '';
      btn.style.cssText = btn.dataset.mpOriginalStyle || '';
      if (typeof fn === 'function') fn();
      return;
    }
    btn.dataset.mpArmed = '1';
    btn.dataset.mpOriginalText = btn.textContent;
    btn.dataset.mpOriginalStyle = btn.style.cssText;
    btn.textContent = confirmLabel || 'Точно?';
    if (opts.timeout !== 0) {
      setTimeout(function() {
        if (btn.dataset && btn.dataset.mpArmed === '1') {
          btn.dataset.mpArmed = '';
          btn.textContent = btn.dataset.mpOriginalText || '';
          btn.style.cssText = btn.dataset.mpOriginalStyle || '';
        }
      }, opts.holdMs || 3500);
    }
  }

  // Стили появления
  const styleTag = document.createElement('style');
  styleTag.textContent = '@keyframes mpToastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}';
  (document.head || document.documentElement).appendChild(styleTag);

  global.MPToast = { show: show, dialog: dialog, arm: arm, closeDialog: closeDialog };
})(window);
