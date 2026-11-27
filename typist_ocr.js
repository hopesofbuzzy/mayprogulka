const ocrFields = {
  surname: ['pf-surname', 'Фамилия'],
  name: ['pf-name', 'Имя'],
  middle_name: ['pf-middle', 'Отчество'],
  date_of_birth: ['pf-dob', 'Дата рождения'],
  phone_number: ['pf-phone', 'Телефон'],
  email: ['pf-email', 'Email']
};
const ocrApplied = new Map();
const ocrEdited = new Set();
let ocrRequest = null;
let ocrPreviewUrl = '';
let draftHadPhoto = false;

function toggleOcrPanel(force) {
  const body = document.getElementById('ocr-body');
  const open = typeof force === 'boolean' ? force : body.classList.contains('hidden');
  body.classList.toggle('hidden', !open);
  document.getElementById('ocr-toggle').textContent = open ? 'Свернуть' : 'Развернуть';
}

function openOcrPicker(id) {
  if (!currentUser || paperState !== 'draft') return;
  toggleOcrPanel(true);
  document.getElementById(id).click();
}
function startOcr() { openOcrPicker('ocr-file-camera'); }
function pickOcrImage() { openOcrPicker('ocr-file-gallery'); }

function showOcrMessage(message) {
  const summary = document.getElementById('ocr-summary');
  summary.textContent = message;
  summary.classList.toggle('hidden', !message);
}

function clearOcr(preserveFields = false) {
  if (ocrRequest) ocrRequest.abort();
  ocrRequest = null;
  for (const [field, value] of ocrApplied) {
    if (!preserveFields && field.value === value) field.value = '';
    field.classList.remove('ocr-filled');
  }
  ocrApplied.clear();
  if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
  ocrPreviewUrl = '';
  document.getElementById('ocr-preview').removeAttribute('src');
  document.getElementById('ocr-raw').textContent = '';
  document.getElementById('ocr-result').classList.add('hidden');
  document.getElementById('ocr-progress').classList.add('hidden');
  showOcrMessage('');
}

function cancelOcr() {
  clearOcr();
  showOcrMessage('Распознавание отменено. Можно продолжить вручную.');
}

async function handleOcrFile(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !currentUser || paperState !== 'draft') return;
  if (window.MP_LOOPBACK_GATEWAY !== true || location.origin !== 'http://127.0.0.1:8080') {
    showOcrMessage('Распознавание доступно через локальный шлюз. Можно заполнить анкету вручную.');
    return;
  }
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    showOcrMessage('Выберите JPEG или PNG размером до 10 МБ.');
    return;
  }
  const token = getAuthToken();
  if (!token) return;
  const hasDraft = draftHadPhoto || ocrEdited.size > 0 ||
    Object.values(ocrFields).some(([id]) => document.getElementById(id).value !== '') ||
    document.getElementById('pf-gender').value !== '' ||
    document.querySelector('#paper-form [name="pf-route"]:checked');
  if (hasDraft) {
    const action = await choosePaperAction(
      'К какой анкете относится фото?',
      'Если это другой участник, начните новую анкету. Если это тот же бланк, введённые поля сохранятся.',
      'Новая анкета', 'Тот же бланк'
    );
    if (paperState !== 'draft' || token !== getAuthToken()) return;
    if (action === 'new') resetPaperForm(false);
    else if (action === 'same') clearOcr(true);
    else return;
  } else {
    clearOcr();
  }
  document.getElementById('pf-reviewed').checked = false;
  draftHadPhoto = true;
  const controller = new AbortController();
  ocrRequest = controller;
  ocrPreviewUrl = URL.createObjectURL(file);
  document.getElementById('ocr-preview').src = ocrPreviewUrl;
  document.getElementById('ocr-result').classList.remove('hidden');
  document.getElementById('ocr-progress').classList.remove('hidden');
  const timeout = setTimeout(() => controller.abort(), 45000);
  const isCurrent = () => ocrRequest === controller && token === getAuthToken() && paperState === 'draft';
  try {
    const body = new FormData();
    body.append('file', file);
    const response = await fetch('/ocr/recognize', {
      method: 'POST', body, signal: controller.signal, redirect: 'error',
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await response.json().catch(() => null);
    if (!isCurrent()) return;
    if (!response.ok || data?.status !== 'review_required' || !data.fields) {
      throw new Error(typeof data?.detail === 'string' ? data.detail : 'Сервис распознавания недоступен.');
    }
    let filled = 0;
    const raw = [];
    for (const [key, [id, label]] of Object.entries(ocrFields)) {
      const field = document.getElementById(id);
      const candidate = data.fields[key];
      raw.push(label + ' — ' + (candidate?.raw || '∅') +
        (candidate?.reason ? ' (' + candidate.reason + ')' : ''));
      if (candidate?.value && !field.value && !ocrEdited.has(field)) {
        field.value = candidate.value;
        if (field.value) {
          ocrApplied.set(field, field.value);
          field.classList.add('ocr-filled');
          filled++;
        }
      }
    }
    document.getElementById('ocr-raw').textContent = raw.join('\n');
    document.getElementById('pf-review-row').classList.remove('hidden');
    document.getElementById('pf-reviewed').checked = false;
    showOcrMessage('Заполнено полей: ' + filled + '. Сверьте значения с фото. Пол и дистанцию выберите вручную.');
  } catch (error) {
    if (isCurrent()) showOcrMessage((controller.signal.aborted
      ? 'Истекло время ожидания распознавания.'
      : 'Распознавание: ' + error.message) + ' Можно заполнить анкету вручную.');
  } finally {
    clearTimeout(timeout);
    if (ocrRequest === controller) {
      ocrRequest = null;
      document.getElementById('ocr-progress').classList.add('hidden');
    }
  }
}

document.addEventListener('input', event => {
  if (event.target.closest('#paper-form') && event.target.id !== 'pf-reviewed') {
    document.getElementById('pf-reviewed').checked = false;
    ocrEdited.add(event.target);
  }
  if (ocrApplied.delete(event.target)) event.target.classList.remove('ocr-filled');
});
window.addEventListener('pagehide', () => resetPaperForm(false, true));
window.addEventListener('storage', event => {
  if (event.key === MP_CONFIG.AUTH_TOKEN_KEY) resetPaperForm(false, true);
});
document.addEventListener('click', event => {
  if (event.target.closest('#mp-eco-logout')) resetPaperForm(false, true);
}, true);
