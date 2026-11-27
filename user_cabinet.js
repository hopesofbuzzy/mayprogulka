const $ = id => document.getElementById(id);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' && value.trim().length > 0;
const optionalText = value => value == null || text(value);
const paymentStatuses = ['paid', 'unpaid', 'pending', 'failed'];
const expired = () => !getAuthUser();
const uncertainScans = new Map();
const uncertainPayments = new Set();
let routes = [];
let participants = [];
let listReady = false;
let selectedId = null;
let selection = null;
let listRequest;
let detailRequest;
let routesRequest;
let scanCandidate = null;
let scanBusy = false;
let paymentId = null;
let paymentBusy = false;
let registrationBusy = false;
let registrationUncertain = false;
let scannerJob = null;
let scannerIdle = Promise.resolve();
const person = item => [item.surname, item.name, item.middle_name].filter(Boolean).join(' ');
const routeLabel = route => route ? [route.name, positiveId(route.year) ? route.year : 'год: нет данных',
  Number.isFinite(route.distance) ? route.distance + ' км' : 'дистанция: нет данных'].join(' · ') : 'Нет данных';
const toggle = (id, visible) => $(id).classList.toggle('hidden', !visible);

function validMember(item) {
  return item && positiveId(item.id) && text(item.form_id) && text(item.surname) && text(item.name) &&
    text(item.route_name) && paymentStatuses.includes(item.payment_status) &&
    typeof item.has_started === 'boolean' && typeof item.has_finished === 'boolean' && optionalText(item.map_barcode);
}

function validClock(value) {
  if (!text(value) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(value)) return null;
  // The pinned backend writes naive UTC timestamps with datetime.utcnow().
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + 'Z');
  return Number.isFinite(date.valueOf()) ? date : null;
}

function renderMembers() {
  const grid = $('participants-grid');
  grid.replaceChildren();
  $('badge-count').textContent = String(participants.length);
  for (const id of ['ticket-pills', 'diploma-pills']) $(id).replaceChildren();
  for (const item of participants) {
    const card = document.createElement('article');
    card.className = 'bg-white rounded-2xl border border-stone-200 p-4 shadow-sm min-w-0';
    const name = document.createElement('h3');
    name.className = 'font-unbounded font-bold break-words';
    name.textContent = person(item);
    const info = document.createElement('p');
    info.className = 'my-2 text-sm text-stone-600 break-words';
    info.textContent = item.route_name + ' · ' + (item.payment_status === 'paid' ? 'Оплата подтверждена' : 'Оплата не подтверждена');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Открыть билет и отметки';
    button.className = 'bg-orange-100 text-[#ea580c] rounded-lg px-3 py-2 text-sm font-bold';
    button.addEventListener('click', () => { switchTab('tickets'); loadSelection(item.id); });
    card.append(name, info, button);
    grid.append(card);
    for (const id of ['ticket-pills', 'diploma-pills']) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'rounded-lg px-3 py-2 text-sm break-words max-w-full ' +
        (item.id === selectedId ? 'bg-[#ea580c] text-white' : 'bg-stone-100');
      pill.textContent = person(item);
      pill.setAttribute('aria-pressed', String(item.id === selectedId));
      pill.addEventListener('click', () => loadSelection(item.id));
      $(id).append(pill);
    }
  }
}

function clearSelection(message) {
  selection = null;
  scanCandidate = null;
  stopScanner();
  closePaymentModal();
  for (const id of ['active-ticket-container','unpaid-ticket-lock','fs-ticket',
    'diploma-card-box','map-qr-container']) toggle(id,false);
  for (const id of ['ticket-qr-container','map-qr-container','fs-qr-container','progress-list']) $(id).replaceChildren();
  for (const id of ['t-name','t-route','t-form-id','t-map','fs-name','fs-route','fs-form-id','diploma-name','diploma-route','progress-note'])
    $(id).textContent = '';
  for (const id of ['ticket-state','diploma-status-badge','scan-state']) $(id).textContent = message;
  $('scan-code').value = '';
  $('scan-controls').disabled = $('scan-confirm').disabled = $('btn-pay').disabled = $('ticket-pay').disabled = true;
}

async function loadMyParticipants(preferredId = selectedId) {
  listRequest?.abort();
  detailRequest?.abort();
  const request = new AbortController();
  listRequest = request;
  listReady = false;
  participants = [];
  selectedId = null;
  clearSelection('Загружаем участников…');
  $('cabinet-message').textContent = 'Загружаем участников…';
  renderMembers();
  try {
    const result = await apiRequest('/api/v1/participants/my?limit=200', {signal:AbortSignal.any([request.signal,AbortSignal.timeout(12000)])});
    if (listRequest !== request || expired()) return false;
    const items = result?.participants;
    if (!Array.isArray(items) || !items.every(validMember) || new Set(items.map(p => p.id)).size !== items.length ||
        !Number.isSafeInteger(result.total) || result.total < items.length || result.offset !== 0 ||
        !positiveId(result.limit) || result.limit > 200 || items.length > result.limit ||
        (items.length === 0 && result.total > 0)) throw new Error();
    participants = items;
    listReady = true;
    $('cabinet-message').textContent = items.length ? (result.total > items.length ? 'Показаны первые 200 участников.' : '') :
      'У вас пока нет участников.';
    renderMembers();
    const item = items.find(p => p.id === preferredId);
    if (item) await loadSelection(item.id);
    else clearSelection(items.length ? 'Выберите участника.' : 'У вас пока нет участников.');
    return listRequest === request && listReady && !expired();
  } catch {
    if (listRequest !== request || expired()) return false;
    clearSelection('Список недоступен. Обновите данные.');
    $('cabinet-message').textContent = 'Список участников недоступен. Обновите данные.';
    return false;
  }
}

async function loadSelection(id) {
  const member = participants.find(item => item.id === id);
  if (!listReady || !member || expired()) return false;
  detailRequest?.abort();
  const request = new AbortController();
  detailRequest = request;
  selectedId = id;
  clearSelection('Проверяем данные участника…');
  renderMembers();
  const current = () => detailRequest === request && selectedId === id && !expired();
  try {
    const options = {signal:AbortSignal.any([request.signal,AbortSignal.timeout(12000)])};
    const path = '/api/v1/participants/' + id;
    const [detail, passList] = await Promise.all([apiRequest(path, options), apiRequest(path + '/passes', options)]);
    if (!current()) return false;
    if (!validMember(detail) || detail.id !== id || detail.form_id !== member.form_id ||
        detail.user_id !== getAuthUser().user_id || !positiveId(detail.route_id) ||
        !optionalText(detail.middle_name) || passList?.participant_id !== id ||
        !Array.isArray(passList.passes)) throw new Error();
    const result = await apiRequest('/api/v1/checkpoints?route_id=' + detail.route_id, options);
    if (!current()) return false;
    if (!Array.isArray(result?.checkpoints)) throw new Error();
    const validCheckpoint = cp => cp && positiveId(cp.id) && positiveId(cp.position) &&
      cp.route_id === detail.route_id && text(cp.name) && text(cp.barcode) && typeof cp.address === 'string';
    const validPass = pass => pass && positiveId(pass.checkpoint_id) && positiveId(pass.position) &&
      pass.route_id === detail.route_id && text(pass.checkpoint_name) && typeof pass.address === 'string' &&
      text(pass.passed_at);
    if (!result.checkpoints.every(validCheckpoint) || !passList.passes.every(validPass)) throw new Error();
    const checkpoints = result.checkpoints.toSorted((a,b) => a.position - b.position);
    const passes = new Map(passList.passes.map(pass => [pass.checkpoint_id, pass]));
    const coherent = checkpoints.length > 0 &&
      new Set(checkpoints.map(cp => cp.id)).size === checkpoints.length &&
      new Set(checkpoints.map(cp => cp.barcode)).size === checkpoints.length &&
      checkpoints.every((cp,index) => index === 0 || cp.position > checkpoints[index - 1].position) && passes.size === passList.passes.length &&
      passList.passes.every(pass => checkpoints.some(cp => cp.id === pass.checkpoint_id && cp.position === pass.position)) &&
      checkpoints.every((cp,index) => passes.has(cp.id) === (index < passes.size));
    const route = routes.find(item => item.id === detail.route_id);
    selection = {detail, route, passes, checkpoints, coherent};
    const pending = uncertainScans.get(id);
    if (pending && passes.has(pending)) uncertainScans.delete(id);
    if (detail.payment_status === 'paid' && member.payment_status === 'paid') uncertainPayments.delete(id);
    renderSelection();
    return true;
  } catch {
    if (current()) clearSelection('Данные участника недоступны. Обновите данные.');
    return false;
  }
}

function makeQr(container, value, size) {
  container.replaceChildren();
  if (typeof QRCode !== 'function') throw new Error();
  new QRCode(container, {text:value, width:size, height:size, correctLevel:QRCode.CorrectLevel.M});
  if (!container.querySelector('canvas,img,table')) throw new Error();
}

function renderSelection() {
  const {detail, route, passes, checkpoints, coherent} = selection;
  const member = participants.find(item => item.id === detail.id);
  const paid = detail.payment_status === 'paid' && member.payment_status === 'paid';
  const label = routeLabel(route) + (route ? '' : ' · ' + detail.route_name);
  $('ticket-state').textContent = paid ? '' : 'Стартовый QR появится после подтверждения оплаты.';
  toggle('unpaid-ticket-lock', !paid);
  if (paid) {
    try {
      makeQr($('ticket-qr-container'), detail.form_id, 176);
      makeQr($('fs-qr-container'), detail.form_id, 196);
      if (detail.map_barcode) makeQr($('map-qr-container'), detail.map_barcode, 144);
      for (const prefix of ['t', 'fs']) {
        $(prefix + '-name').textContent = person(detail);
        $(prefix + '-route').textContent = label;
        $(prefix + '-form-id').textContent = detail.form_id;
      }
      $('t-map').textContent = detail.map_barcode || 'Карта не выдана';
      toggle('map-qr-container', Boolean(detail.map_barcode));
      toggle('active-ticket-container', true);
    } catch {
      for (const id of ['ticket-qr-container','map-qr-container','fs-qr-container']) $(id).replaceChildren();
      for (const id of ['active-ticket-container','map-qr-container','fs-ticket']) toggle(id,false);
      $('ticket-state').textContent = 'Не удалось сформировать QR. Обновите данные.';
    }
  }

  $('diploma-status-badge').textContent = detail.has_finished ? 'Финиш по данным сервера' :
    (detail.has_started ? 'На маршруте' : 'До старта');
  const finished = detail.has_finished && detail.has_started && coherent && passes.size === checkpoints.length;
  if (detail.has_finished && !finished) $('progress-note').textContent = 'Требуется сверка отметок';
  else if (!coherent && checkpoints.length) $('progress-note').textContent = 'Требуется сверка отметок';
  else $('progress-note').textContent = checkpoints.length ? 'Маршрут: ' + label : 'Контрольные пункты: нет данных.';
  const progress = checkpoints.length ? checkpoints.map(cp => [cp.name,cp.position,passes.get(cp.id),cp.address]) :
    [...passes.values()].toSorted((a,b) => a.position - b.position).map(pass => [pass.checkpoint_name,pass.position,pass,pass.address]);
  for (const [name,position,pass,address] of progress) {
    const item = document.createElement('li');
    item.className = 'bg-stone-50 rounded-xl p-3 break-words';
    const date = validClock(pass?.passed_at);
    item.textContent = position + '. ' + name + (address ? ' · ' + address : '') + ' — ' +
      (pass ? 'Отмечен · ' + (date ? date.toLocaleString('ru-RU', {timeZone:'Asia/Yekaterinburg'}) + ' (Екатеринбург)' : 'время: нет данных') : 'Нет отметки');
    $('progress-list').append(item);
  }
  toggle('diploma-card-box', finished);
  if (finished) {
    $('diploma-name').textContent = person(detail);
    $('diploma-route').textContent = label;
  }
  $('btn-pay').disabled = $('ticket-pay').disabled = !canPay();
  updateScanControls();
}

function toggleFullscreenTicket() {
  if (expired() || !selection || $('active-ticket-container').classList.contains('hidden') ||
      !$('fs-qr-container').firstChild) return;
  $('fs-ticket').classList.toggle('hidden');
}

function downloadAward() {
  if (expired() || !selection || $('diploma-card-box').classList.contains('hidden')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 600 900');
  const background = document.createElementNS(ns,'rect');
  for (const [key,value] of Object.entries({width:'600',height:'900',fill:'#122419',stroke:'#ea580c','stroke-width':'12'}))
    background.setAttribute(key,value);
  svg.append(background);
  for (const [value,y,size,color] of [
    ['Майская прогулка · Карточка финишера',290,26,'#ffcf72'],
    [person(selection.detail),420,27,'#fff'],[routeLabel(selection.route),520,19,'#fff']
  ]) {
    const row = document.createElementNS(ns,'text');
    Object.entries({x:'300',y,'text-anchor':'middle','font-size':size,'font-family':'sans-serif',fill:color})
      .forEach(([key,field]) => row.setAttribute(key,String(field)));
    row.textContent = value;
    svg.append(row);
  }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'finisher-card.svg';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

function canScan() {
  return selection && selection.detail.payment_status === 'paid' &&
    participants.some(p => p.id === selectedId && p.payment_status === 'paid') &&
    selection.detail.has_started && !selection.detail.has_finished && selection.coherent &&
    selection.passes.size < selection.checkpoints.length &&
    !uncertainScans.has(selection.detail.id) && !scanBusy;
}

function updateScanControls() {
  $('scan-controls').disabled = !canScan();
  $('scan-confirm').disabled = !canScan() || !scanCandidate;
  if (!selection) return;
  const {detail, coherent, checkpoints, passes} = selection;
  $('scan-state').textContent = scanBusy ? 'Проверяем результат отметки…' :
    uncertainScans.has(detail.id) ? 'Результат не подтверждён. Обновите данные перед продолжением.' :
    detail.has_finished ? 'Маршрут завершён по данным сервера.' :
    !detail.has_started ? 'Самостоятельная отметка доступна после старта.' :
    !coherent ? 'Порядок КП не подтверждён. Обратитесь к организатору.' :
    passes.size === checkpoints.length ? 'Все известные КП уже отмечены.' :
    detail.payment_status !== 'paid' ? 'Взнос не подтверждён.' : 'Введите или отсканируйте код следующего КП.';
  if (passes.size === checkpoints.length) $('scan-controls').disabled = true;
}

function verifyScanCode(code) {
  scanCandidate = null;
  $('scan-confirm').disabled = true;
  if (!canScan() || expired()) return;
  const state = selection;
  const cp = state.checkpoints.find(item => item.barcode === code);
  if (!cp) {
    $('scan-state').textContent = 'Код неизвестен или относится к другому маршруту.';
  } else if (state.passes.has(cp.id)) {
    $('scan-state').textContent = 'КП уже отмечен для этого участника.';
  } else if (state.checkpoints.find(item => !state.passes.has(item.id))?.id !== cp.id) {
    $('scan-state').textContent = 'Сначала отметьте предыдущий КП.';
  } else {
    scanCandidate = {state,cp,code};
    $('scan-state').textContent = 'Подтвердите: ' + person(state.detail) + ' · ' + cp.name;
    $('scan-confirm').disabled = false;
  }
}

function stopScanner() {
  const job = scannerJob;
  scannerJob = null;
  toggle('checkpoint-reader', false);
  toggle('scan-close', false);
  if (!job) return;
  scannerIdle = job.ready.catch(() => {}).then(async () => {
    try { if (job.running) await job.reader.stop(); } catch { /* Already stopped. */ }
    try { job.reader?.clear(); } catch { /* Reader is no longer active. */ }
  });
}

function startScanner(file) {
  if (!canScan() || expired() || selection.passes.size === selection.checkpoints.length) return;
  stopScanner();
  const job = {state:selection, reader:null, running:false};
  scannerJob = job;
  const current = () => scannerJob === job && job.state === selection && !expired() && canScan();
  const decoded = value => {
    if (!current()) return;
    stopScanner();
    $('scan-code').value = value;
    verifyScanCode(value);
  };
  job.ready = scannerIdle.then(async () => {
    if (!current()) return;
    toggle('checkpoint-reader', true);
    toggle('scan-close', true);
    job.reader = new Html5Qrcode('checkpoint-reader', {formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE]});
    if (file) decoded(await job.reader.scanFile(file,false));
    else {
      await job.reader.start({facingMode:'environment'}, {fps:8}, decoded, () => {});
      job.running = true;
    }
  });
  job.ready.catch(() => {
    if (!current()) return;
    stopScanner();
    $('scan-state').textContent = 'Не удалось прочитать QR. Введите код вручную или выберите другой файл.';
  });
}

async function confirmScan() {
  const candidate = scanCandidate;
  if (!candidate || candidate.state !== selection || !canScan() || expired()) return;
  const {state,cp,code} = candidate;
  const id = state.detail.id;
  const requestAtSend = detailRequest;
  const stillSelected = () => detailRequest === requestAtSend && selectedId === id && !expired();
  scanBusy = true;
  scanCandidate = null;
  stopScanner();
  uncertainScans.set(id,cp.id);
  updateScanControls();
  let rejection;
  const scanErrors = {
    400:'Этот КП не относится к маршруту участника.', 403:'Отметка недоступна для этого участника.',
    404:'КП или участник не найден.', 409:'Старт ещё не подтверждён.', 422:'Проверьте код КП.'
  };
  let acknowledged = null;
  try {
    const result = await apiRequest('/api/v1/scans/self', {
      method:'POST', body:{checkpoint_barcode:code,participant_id:id}, signal:AbortSignal.timeout(12000)
    });
    if (['success','already_passed'].includes(result?.status) && result.checkpoint_name === cp.name &&
        text(result.message) && (result.status === 'already_passed' || validClock(result.passed_at))) {
      acknowledged = result.status;
    }
  } catch (error) {
    if (Object.hasOwn(scanErrors,error.status)) {
      rejection = error.status;
      uncertainScans.delete(id);
    }
  } finally {
    // Keep the write guard through readback, including if the user changes selection.
    let finalMessage = '';
    if (stillSelected()) {
      if (rejection) {
        finalMessage = scanErrors[rejection];
        if ([403,404,409].includes(rejection)) await loadSelection(id);
      } else {
        const verified = await loadSelection(id);
        if (verified && selection?.detail.id === id && selection.passes.get(cp.id)?.position === cp.position) {
          finalMessage = acknowledged === 'already_passed' ? 'КП уже был отмечен. Запись подтверждена.' :
            acknowledged === 'success' ? 'Отметка на КП подтверждена.' : 'Отметка найдена в данных сервера.';
        } else finalMessage = 'Результат не подтверждён. Обновите данные перед продолжением.';
      }
    }
    scanBusy = false;
    if (!expired()) {
      updateScanControls();
      if (selectedId === id && finalMessage) $('scan-state').textContent = finalMessage;
    }
  }
}

function canPay() {
  return listReady && selection && selection.detail.payment_status === 'unpaid' &&
    participants.some(p => p.id === selectedId && p.payment_status === 'unpaid') &&
    !paymentBusy && !uncertainPayments.has(selectedId);
}

function openPaymentModal() {
  if (!canPay() || expired()) return;
  paymentId = selectedId;
  $('pay-modal-desc').textContent = 'Подтвердите тестовую оплату только для участника: ' + person(selection.detail);
  $('btn-confirm-pay').disabled = false;
  toggle('payment-modal',true);
}

function closePaymentModal() {
  paymentId = null;
  $('pay-modal-desc').textContent = '';
  $('btn-confirm-pay').disabled = true;
  toggle('payment-modal',false);
}

async function confirmSimulationPayment() {
  if (!canPay() || expired() || paymentId !== selectedId) return;
  const id = paymentId;
  const method = document.querySelector('[name="pay-method"]:checked')?.value;
  if (!['sbp','card'].includes(method)) return;
  paymentBusy = true;
  uncertainPayments.add(id);
  closePaymentModal();
  clearSelection('Проверяем оплату…');
  detailRequest?.abort();
  let acknowledged = false;
  try {
    const response = await apiRequest('/api/v1/participants/' + id + '/pay',{
      method:'POST',body:{payment_method:method},signal:AbortSignal.timeout(12000)
    });
    acknowledged = response?.status === 'success' && text(response.payment_id);
  } catch {
    // Even the backend's already-paid error needs a fresh readback.
  } finally {
    if (!expired()) await loadMyParticipants(selectedId);
    paymentBusy = false;
    if (!expired()) {
      $('btn-pay').disabled = $('ticket-pay').disabled = !canPay();
      const confirmed = !uncertainPayments.has(id);
      $('cabinet-message').textContent = confirmed ?
        (acknowledged ? 'Тестовая оплата подтверждена.' : 'Сервер подтверждает, что взнос оплачен.') :
        'Результат оплаты не подтверждён. Обновите данные перед дальнейшими действиями.';
    }
  }
}

function switchTab(tab) {
  if (!['team','tickets','diploma'].includes(tab)) return;
  if (tab !== 'tickets') {
    stopScanner();
    toggle('fs-ticket',false);
  }
  for (const id of ['team','tickets','diploma']) {
    toggle('tab-' + id, id === tab);
    $('tab-btn-' + id).classList.toggle('border-[#ea580c]', id === tab);
    $('tab-btn-' + id).classList.toggle('text-[#ea580c]', id === tab);
    $('tab-btn-' + id).classList.toggle('border-transparent', id !== tab);
  }
}


function openOnboardingModal() { if (!expired()) toggle('onboarding-wizard-modal',true); }
function closeOnboardingModal() { toggle('onboarding-wizard-modal',false); }
function openModal() { if (!expired()) toggle('participant-modal',true); }
function closeModal() { toggle('participant-modal',false); }

function startFreshRegistration() {
  $('wizard-form').reset();
  $('wiz-members-list').replaceChildren();
  toggleWizardFamilyFields(false);
  openOnboardingModal();
}

function toggleWizardFamilyFields(family) {
  toggle('wiz-extra-members-box',family);
  $('wiz-extra-members-box').querySelectorAll('input,select').forEach(field => { field.disabled = !family; });
}

function routeOptions(select) {
  select.replaceChildren(new Option('Выберите маршрут',''));
  for (const route of routes.filter(r => r.is_active)) select.append(new Option(routeLabel(route),String(route.id)));
}

function addWizardMemberRow() {
  const row = document.createElement('div');
  row.className = 'bg-white p-3 rounded-xl border border-stone-200 grid grid-cols-1 sm:grid-cols-2 gap-2';
  row.innerHTML = '<label>Фамилия<input required class="wiz-extra-surname block w-full rounded border p-2"></label>' +
    '<label>Имя<input required class="wiz-extra-name block w-full rounded border p-2"></label>' +
    '<label>Дата рождения<input type="date" required class="wiz-extra-birth block w-full rounded border p-2"></label>' +
    '<label>Пол<select required class="wiz-extra-gender block w-full rounded border p-2"><option value="">Выберите пол</option><option value="male">Мужской</option><option value="female">Женский</option></select></label>' +
    '<label>Маршрут<select required class="wiz-extra-route block w-full rounded border p-2"></select></label>' +
    '<button type="button" class="underline">Удалить спутника</button>';
  routeOptions(row.querySelector('select.wiz-extra-route'));
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('wiz-members-list').append(row);
}

function registrationFields(form, wizard) {
  const prefix = wizard ? 'wiz-' : 'f-';
  const value = key => $(prefix + key).value.trim();
  const radio = name => form.querySelector('[name="' + name + '"]:checked')?.value;
  const main = {
    surname:value('surname'),name:value('name'),middle_name:value('patronymic') || null,
    phone_number:value('phone'),email:value('email'),date_of_birth:value('birth'),
    gender:wizard ? value('gender') : radio('gender'),
    route_id:Number(radio(wizard ? 'wiz-route' : 'route'))
  };
  const members = [main];
  if (wizard && radio('wiz-reg-type') === 'family') {
    for (const row of $('wiz-members-list').children) {
      const get = name => row.querySelector('.wiz-extra-' + name).value.trim();
      members.push({surname:get('surname'),name:get('name'),middle_name:null,
        phone_number:main.phone_number,email:main.email,date_of_birth:get('birth'),
        gender:get('gender'),route_id:Number(get('route'))});
    }
  }
  return members;
}

async function submitRegistration(event, wizard) {
  event.preventDefault();
  const form = event.currentTarget;
  if (registrationBusy || expired() || !form.reportValidity()) return;
  if (registrationUncertain) {
    MPToast.show('Предыдущая регистрация не подтверждена. Сверьте список участников перед новым вводом.', 'warn');
    return;
  }
  const members = registrationFields(form,wizard);
  const valid = item => text(item.surname) && text(item.name) && text(item.phone_number) && text(item.email) &&
    /^\d{4}-\d\d-\d\d$/.test(item.date_of_birth) && ['male','female'].includes(item.gender) &&
    routes.some(route => route.id === item.route_id && route.is_active);
  if (!members.every(valid)) {
    MPToast.show('Заполните все добавленные анкеты и выберите действующие маршруты.', 'warn');
    return;
  }
  registrationBusy = true;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await apiRequest('/api/v1/participants/register', {
      method:'POST',body:{participants:members},signal:AbortSignal.timeout(12000)
    });
    const created = result?.participants;
    if (!positiveId(result?.registration_id) || !Array.isArray(created) || created.length !== members.length ||
        !created.every(item => positiveId(item?.id) && text(item.form_id)) ||
        new Set(created.map(item => item.id)).size !== created.length) throw new Error();
    if (expired()) return;
    form.reset();
    if (wizard) {
      $('wiz-members-list').replaceChildren();
      toggleWizardFamilyFields(false);
      closeOnboardingModal();
    } else closeModal();
    const listed = await loadMyParticipants(created.length === 1 ? created[0].id : null);
    if (!listed || !created.every(item => participants.some(p => p.id === item.id && p.form_id === item.form_id))) {
      registrationUncertain = true;
      if (!expired()) $('cabinet-message').textContent = 'Регистрация требует сверки со списком участников. Не повторяйте отправку.';
      return;
    }
    $('cabinet-message').textContent = 'Регистрация подтверждена. Для тестовой оплаты выберите участника.';
  } catch (error) {
    if (expired()) return;
    if ([400,403,422].includes(error.status)) {
      MPToast.show('Регистрация отклонена. Проверьте данные.', 'warn');
    } else {
      registrationUncertain = true;
      await loadMyParticipants();
      if (!expired()) MPToast.show('Исход регистрации неизвестен. Сверьте список перед повторным вводом.', 'warn');
    }
  } finally {
    registrationBusy = false;
    submit.disabled = false;
  }
}

function submitOnboardingRegistration(event) { return submitRegistration(event,true); }
function saveParticipant(event) { return submitRegistration(event,false); }

function renderRoutePickers() {
  for (const [index,id] of ['wiz-routes-box','f-routes-box'].entries()) {
    const box = $(id);
    box.replaceChildren();
    for (const route of routes.filter(item => item.is_active)) {
      const label = document.createElement('label');
      label.className = 'cursor-pointer border rounded-xl p-2 text-sm break-words has-[:checked]:border-[#ea580c] has-[:checked]:bg-orange-50';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = index === 0 ? 'wiz-route' : 'route';
      input.value = route.id;
      label.append(input, ' ' + routeLabel(route));
      box.append(label);
    }
    if (!box.children.length) box.textContent = 'Список действующих маршрутов недоступен.';
  }
}

async function loadRoutes() {
  routesRequest?.abort();
  const request = new AbortController();
  routesRequest = request;
  try {
    const result = await apiRequest('/api/v1/routes',{auth:false,
      signal:AbortSignal.any([request.signal,AbortSignal.timeout(12000)])});
    if (routesRequest !== request || expired()) return;
    if (Array.isArray(result?.routes) && result.routes.every(r => r && positiveId(r.id) && text(r.name) &&
        typeof r.is_active === 'boolean') && new Set(result.routes.map(r => r.id)).size === result.routes.length) {
      routes = result.routes;
    } else routes = [];
  } catch {
    if (routesRequest !== request || expired()) return;
    routes = [];
  }
  renderRoutePickers();
  if (selection) {
    selection.route = routes.find(route => route.id === selection.detail.route_id);
    $('progress-list').replaceChildren();
    renderSelection();
  }
}

function preselectRoute(routeParam) {
  if (!routeParam) return;
  const value = /^\d+$/.test(routeParam) ? Number(routeParam) : NaN;
  const choices = routes.filter(route => route.is_active && route.distance === value);
  if (choices.length !== 1) {
    MPToast.show(choices.length > 1
      ? 'Подходят маршруты разных сезонов. Выберите маршрут вручную.'
      : 'Действующий маршрут с такой дистанцией не найден. Выберите маршрут вручную.', 'warn');
    return;
  }
  for (const name of ['wiz-route','route']) {
    const input = document.querySelector('input[name="' + name + '"][value="' + choices[0].id + '"]');
    if (input) input.checked = true;
  }
}

$('cabinet-refresh').addEventListener('click', async () => {
  if (expired() || registrationBusy || paymentBusy) return;
  await Promise.all([loadMyParticipants(), loadRoutes()]);
});
$('scan-form').addEventListener('submit', event => {
  event.preventDefault();
  stopScanner();
  verifyScanCode($('scan-code').value);
});
$('scan-code').addEventListener('input', () => { scanCandidate = null; updateScanControls(); });
$('scan-confirm').addEventListener('click', confirmScan);
$('scan-camera').addEventListener('click', () => startScanner());
$('scan-close').addEventListener('click', stopScanner);
$('scan-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file && file.size <= 10 * 1024 * 1024) startScanner(file);
  else if (file) $('scan-state').textContent = 'Выберите изображение до 10 МБ.';
});
$('award-download').addEventListener('click',downloadAward);

for (const [id,close] of [['participant-modal',closeModal],['onboarding-wizard-modal',closeOnboardingModal],
  ['fs-ticket',toggleFullscreenTicket]]) {
  $(id).addEventListener('click',event => { if (event.target === $(id)) close(); });
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  stopScanner();
  closeModal();
  closeOnboardingModal();
  closePaymentModal();
  toggle('fs-ticket',false);
});
window.addEventListener('pagehide', stopScanner);
document.addEventListener('mp-auth-invalidated', () => {
  listRequest?.abort();
  detailRequest?.abort();
  routesRequest?.abort();
  listRequest = detailRequest = routesRequest = null;
  participants = [];
  routes = [];
  listReady = false;
  selectedId = null;
  clearSelection('');
  renderMembers();
  $('user-header-info').textContent = '';
  $('wizard-form').reset();
  $('add-form').reset();
  $('wiz-members-list').replaceChildren();
  closeOnboardingModal();
  closeModal();
});

window.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth();
  if (!user) return;
  $('user-header-info').textContent = 'Вы вошли как: ' + user.username;
  const params = new URLSearchParams(location.search);
  if (params.has('denied')) {
    $('denied-page').textContent = params.get('denied');
    toggle('denied-banner',true);
  }
  await Promise.all([loadRoutes(),loadMyParticipants()]);
  if (expired()) return;
  preselectRoute(params.get('route'));
  if (params.has('route') || params.get('new') === '1' || params.get('register') === '1') openOnboardingModal();
});
