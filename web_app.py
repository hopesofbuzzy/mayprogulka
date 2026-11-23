from fastapi import FastAPI, File, UploadFile, Query
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn
import cv2
import numpy as np
import base64
import os
from ocr_system.pipeline import FormOCRPipeline
from ocr_system.mock_filler import create_filled_sample

app = FastAPI(title="Mayprogulka AI-OCR Station")
pipeline = FormOCRPipeline()

REAL_SAMPLE_PATH = r"C:/Users/yulia/.gemini/antigravity/brain/716b16ca-a259-447f-848c-30e9c20c576a/.user_uploaded/media_1795443673179_eacf35dd.jpg"

MOCK_CASES = [
    ('ИВАНОВ', 'ИВАН', 'ИВАНОВИЧ', '21', '03', '1985', 'M', '9041234567', 'ЕКАТЕРИНБУРГ', '02', 0, '012345'),
    ('СМИРНОВ', 'АЛЕКСАНДР', 'СЕРГЕЕВИЧ', '14', '06', '1992', 'M', '9126482190', 'ЕКАТЕРИНБУРГ', '04', 1, '042189')
]

@app.get("/", response_class=HTMLResponse)
def index():
    html_content = """<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI-OCR Анкеты • Майская прогулка 2026</title>
    <style>
        :root {
            --bg-color: #090d16;
            --surface-color: #131b2e;
            --surface-card: #182238;
            --border-color: #263554;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --accent-blue: #38bdf8;
            --accent-green: #22c55e;
            --accent-amber: #f59e0b;
            --accent-red: #ef4444;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: var(--bg-color); color: var(--text-primary); padding: 24px; min-height: 100vh; }
        .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding-bottom: 16px; margin-bottom: 24px; }
        .logo-title h1 { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: -0.01em; }
        .logo-title p { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
        .badge { background: rgba(34, 197, 94, 0.12); color: var(--accent-green); border: 1px solid rgba(34, 197, 94, 0.3); padding: 5px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
        
        .grid-container { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 24px; }
        @media (max-width: 960px) { .grid-container { grid-template-columns: 1fr; } }
        
        .card { background: var(--surface-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 20px; display: flex; flex-direction: column; }
        .card-title { font-size: 15px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
        
        .action-bar { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
        .btn { padding: 11px 16px; border-radius: 6px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
        .btn-upload { background: #1e293b; border: 1px solid #3b82f6; color: #93c5fd; }
        .btn-upload:hover { background: #2563eb; color: #fff; }
        .btn-recognize { background: #16a34a; color: #fff; font-size: 14px; }
        .btn-recognize:hover:not(:disabled) { background: #15803d; }
        .btn-recognize:disabled { background: #334155; color: #64748b; cursor: not-allowed; }
        
        .preview-box { width: 100%; height: 430px; background: #070b12; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px dashed var(--border-color); position: relative; }
        .preview-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .preview-empty { text-align: center; color: var(--text-secondary); padding: 20px; }
        .preview-empty span { display: block; font-size: 36px; margin-bottom: 8px; }

        .presets-row { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border-color); }
        .presets-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 8px; font-weight: 600; }
        .preset-btns { display: flex; flex-wrap: wrap; gap: 8px; }
        .btn-preset { background: var(--surface-card); border: 1px solid var(--border-color); color: var(--text-secondary); font-size: 12px; padding: 6px 10px; border-radius: 4px; cursor: pointer; transition: 0.15s; }
        .btn-preset:hover { background: #1e293b; color: #fff; border-color: var(--accent-blue); }
        .btn-preset.active { border-color: var(--accent-blue); color: #fff; background: rgba(56, 189, 248, 0.12); }

        .status-box { padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--border-color); background: var(--surface-card); }
        .status-idle { border-color: var(--border-color); color: var(--text-secondary); }
        .status-loading { border-color: var(--accent-blue); background: rgba(56, 189, 248, 0.08); color: var(--accent-blue); }
        .status-approved { border-color: var(--accent-green); background: rgba(34, 197, 94, 0.1); color: var(--accent-green); }
        .status-review { border-color: var(--accent-amber); background: rgba(245, 158, 11, 0.1); color: var(--accent-amber); }

        .metrics-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 16px; }
        .metric-pill { background: var(--surface-card); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px 12px; text-align: center; }
        .metric-lbl { font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
        .metric-val { font-size: 16px; font-weight: 700; color: #fff; margin-top: 3px; font-variant-numeric: tabular-nums; }

        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
        .field-group { display: flex; flex-direction: column; }
        .field-label { font-size: 11px; color: var(--text-secondary); margin-bottom: 3px; font-weight: 500; }
        .field-input { background: #0a0f1d; border: 1px solid var(--border-color); padding: 8px 10px; border-radius: 4px; color: #fff; font-size: 13px; font-weight: 500; font-family: inherit; }
        .field-input:focus { border-color: var(--accent-blue); outline: none; }
        .field-input::placeholder { color: #475569; font-style: italic; }

        .btn-confirm { background: #0284c7; color: #fff; width: 100%; margin-top: 14px; padding: 11px; font-size: 14px; }
        .btn-confirm:hover { background: #0369a1; }
    </style>
</head>
<body>

    <div class="header">
        <div class="logo-title">
            <h1>Майская прогулка 2026 • AI-OCR Станция регистрации</h1>
            <p>Нейросетевая модель PP-OCRv6 Medium Cyrillic • Выравнивание Homography 4-point • Морфологический разбор рукописных коробочек</p>
        </div>
        <div class="badge">Model: PP-OCRv6 Medium ONNX</div>
    </div>

    <div class="grid-container">
        <!-- Левая колонка: Управление и превью -->
        <div class="card">
            <div class="card-title">
                <span>1. Загрузка бланка анкеты</span>
                <span id="align-state" style="font-size: 12px; color: var(--text-secondary);">Ожидание файла</span>
            </div>

            <!-- Раздельные кнопки Загрузить и Распознать -->
            <div class="action-bar">
                <input type="file" id="file-input" accept="image/*" style="display: none;" onchange="handleFileChosen(this)">
                <button class="btn btn-upload" onclick="document.getElementById('file-input').click()">
                    📁 1. Выбрать фото анкеты
                </button>
                <button class="btn btn-recognize" id="btn-run-ocr" onclick="runRecognition()" disabled>
                    ⚡ 2. Распознать анкету
                </button>
            </div>
            
            <div class="preview-box" id="preview-box">
                <div class="preview-empty" id="empty-state">
                    <span>📄</span>
                    <div>Нажмите <strong>«1. Выбрать фото анкеты»</strong><br>или выберите тестовый образец ниже</div>
                </div>
                <img id="form-preview" style="display: none;" alt="Бланк анкеты">
            </div>

            <div class="presets-row">
                <div class="presets-lbl">Или загрузить готовый тестовый образец в превью:</div>
                <div class="preset-btns">
                    <button class="btn-preset" id="btn-real" onclick="pickSample('real')">
                        🔥 Реальное фото (Бурмалда 05 раз)
                    </button>
                    <button class="btn-preset" id="btn-mock0" onclick="pickSample('mock0')">
                        Образец 1 (Иванов)
                    </button>
                    <button class="btn-preset" id="btn-mock1" onclick="pickSample('mock1')">
                        Образец 2 (Смирнов)
                    </button>
                </div>
            </div>
        </div>

        <!-- Правая колонка: Распознанные данные -->
        <div class="card">
            <div class="card-title">
                <span>2. Оцифрованные данные анкеты</span>
                <span id="speed-tag" style="font-size: 12px; color: var(--text-secondary);">Инференс: ~0.35s</span>
            </div>

            <div id="status-card" class="status-box status-idle">
                <div>
                    <strong id="status-text">⏸️ Ожидание запуска распознавания</strong>
                    <div id="status-sub" style="font-size: 11px; margin-top: 2px;">Загрузите фото и нажмите «2. Распознать анкету»</div>
                </div>
                <div style="font-size: 18px; font-weight: 800;" id="conf-val">—</div>
            </div>

            <div class="metrics-row">
                <div class="metric-pill">
                    <div class="metric-lbl">Точность OCR</div>
                    <div class="metric-val" id="metric-conf" style="color: var(--accent-blue);">—</div>
                </div>
                <div class="metric-pill">
                    <div class="metric-lbl">Дистанция (OMR)</div>
                    <div class="metric-val" id="metric-dist">—</div>
                </div>
                <div class="metric-pill">
                    <div class="metric-lbl">Возраст</div>
                    <div class="metric-val" id="metric-age">—</div>
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Фамилия</div>
                    <input class="field-input" id="inp-surname" placeholder="Ожидание...">
                </div>
                <div class="field-group">
                    <div class="field-label">Имя</div>
                    <input class="field-input" id="inp-name" placeholder="Ожидание...">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Отчество</div>
                    <input class="field-input" id="inp-patronymic" placeholder="Ожидание...">
                </div>
                <div class="field-group">
                    <div class="field-label">Пол</div>
                    <input class="field-input" id="inp-gender" placeholder="Ожидание...">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Дата рождения</div>
                    <input class="field-input" id="inp-birth" placeholder="Ожидание...">
                </div>
                <div class="field-group">
                    <div class="field-label">Телефон (+7)</div>
                    <input class="field-input" id="inp-phone" placeholder="Ожидание...">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">E-mail (рукописный ввод)</div>
                    <input class="field-input" id="inp-email" placeholder="Ожидание...">
                </div>
                <div class="field-group">
                    <div class="field-label">Город</div>
                    <input class="field-input" id="inp-city" placeholder="Ожидание...">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Ранее участвовал</div>
                    <input class="field-input" id="inp-prev" placeholder="Ожидание..." style="color: var(--accent-green); font-weight: 700;">
                </div>
                <div class="field-group">
                    <div class="field-label">Выдана карта №</div>
                    <input class="field-input" id="inp-card" placeholder="Ожидание..." style="color: var(--accent-blue); font-weight: 700;">
                </div>
            </div>

            <button class="btn btn-confirm" id="btn-confirm" onclick="confirmCard()" disabled>
                ✓ Подтвердить регистрацию и выдать карту
            </button>
        </div>
    </div>

    <script>
        let currentMode = null; // 'file', 'real', 'mock0', 'mock1'
        let selectedFile = null;

        function clearForm() {
            document.getElementById('inp-surname').value = '';
            document.getElementById('inp-name').value = '';
            document.getElementById('inp-patronymic').value = '';
            document.getElementById('inp-gender').value = '';
            document.getElementById('inp-birth').value = '';
            document.getElementById('inp-phone').value = '';
            document.getElementById('inp-email').value = '';
            document.getElementById('inp-city').value = '';
            document.getElementById('inp-prev').value = '';
            document.getElementById('inp-card').value = '';

            document.getElementById('metric-conf').innerText = '—';
            document.getElementById('conf-val').innerText = '—';
            document.getElementById('metric-dist').innerText = '—';
            document.getElementById('metric-age').innerText = '—';
            document.getElementById('btn-confirm').disabled = true;

            const sc = document.getElementById('status-card');
            sc.className = 'status-box status-idle';
            document.getElementById('status-text').innerText = '⏸️ Ожидание запуска распознавания';
            document.getElementById('status-sub').innerText = 'Нажмите «2. Распознать анкету»';
        }

        function showPreview(src) {
            document.getElementById('empty-state').style.display = 'none';
            const img = document.getElementById('form-preview');
            img.style.display = 'block';
            img.src = src;
            document.getElementById('btn-run-ocr').disabled = false;
        }

        function handleFileChosen(input) {
            if (!input.files || !input.files[0]) return;
            selectedFile = input.files[0];
            currentMode = 'file';
            
            // Снимаем подсветку пресетов
            document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));

            // Отображаем локальное превью
            const reader = new FileReader();
            reader.onload = (e) => { showPreview(e.target.result); };
            reader.readAsDataURL(selectedFile);

            clearForm();
            document.getElementById('align-state').innerText = 'Файл: ' + selectedFile.name;
        }

        function pickSample(type) {
            currentMode = type;
            selectedFile = null;

            document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
            if (type === 'real') {
                document.getElementById('btn-real').classList.add('active');
                showPreview('/api/real-image?t=' + Date.now());
                document.getElementById('align-state').innerText = 'Образец: Реальное фото';
            } else if (type === 'mock0') {
                document.getElementById('btn-mock0').classList.add('active');
                showPreview('/api/mock-image?case=0&t=' + Date.now());
                document.getElementById('align-state').innerText = 'Образец: Иванов';
            } else if (type === 'mock1') {
                document.getElementById('btn-mock1').classList.add('active');
                showPreview('/api/mock-image?case=1&t=' + Date.now());
                document.getElementById('align-state').innerText = 'Образец: Смирнов';
            }
            clearForm();
        }

        async function runRecognition() {
            if (!currentMode) return;

            const btn = document.getElementById('btn-run-ocr');
            const origText = btn.innerHTML;
            btn.innerHTML = '⏳ Нейросеть распознает...';
            btn.disabled = true;

            const sc = document.getElementById('status-card');
            sc.className = 'status-box status-loading';
            document.getElementById('status-text').innerText = '⏳ Идет нейросетевой инференс...';
            document.getElementById('status-sub').innerText = 'Выравнивание Homography • Полосный OCR PP-OCRv6';

            try {
                let res;
                if (currentMode === 'file' && selectedFile) {
                    const formData = new FormData();
                    formData.append('file', selectedFile);
                    const r = await fetch('/api/recognize-upload', { method: 'POST', body: formData });
                    res = await r.json();
                } else {
                    const r = await fetch('/api/recognize-sample?type=' + currentMode);
                    res = await r.json();
                }
                updateForm(res);
            } catch (err) {
                alert('Ошибка распознавания: ' + err);
            } finally {
                btn.innerHTML = origText;
                btn.disabled = false;
            }
        }

        function updateForm(res) {
            if (!res || !res.success) {
                alert('Ошибка обработки: ' + (res ? res.error : 'Неизвестно'));
                return;
            }

            const d = res.data;
            document.getElementById('inp-surname').value = d.surname || '';
            document.getElementById('inp-name').value = d.name || '';
            document.getElementById('inp-patronymic').value = d.patronymic || '';
            document.getElementById('inp-gender').value = d.gender || '';
            document.getElementById('inp-birth').value = d.birth_date || '';
            document.getElementById('inp-phone').value = d.phone || '';
            document.getElementById('inp-email').value = d.email || '';
            document.getElementById('inp-city').value = d.city || '';
            
            // Вывод количества участий с сохранением двузначного формата
            const prevStr = String(d.prev_participations || '00');
            document.getElementById('inp-prev').value = prevStr + ' раз';
            document.getElementById('inp-card').value = d.card_number || '018420';

            document.getElementById('metric-conf').innerText = res.overall_confidence + '%';
            document.getElementById('conf-val').innerText = res.overall_confidence + '%';
            document.getElementById('metric-dist').innerText = d.distance.split(' ')[0] + ' км';
            document.getElementById('metric-age').innerText = (d.calculated_age || '—') + ' лет';

            const sc = document.getElementById('status-card');
            if (res.status === 'APPROVED') {
                sc.className = 'status-box status-approved';
                document.getElementById('status-text').innerText = '✅ АНКЕТА ОЦИФРОВАНА НЕЙРОСЕТЬЮ';
                document.getElementById('status-sub').innerText = 'Форматы, даты и контрольные чекбоксы подтверждены';
            } else {
                sc.className = 'status-box status-review';
                document.getElementById('status-text').innerText = '⚠️ ТРЕБУЕТ СВЕРКИ ВОЛОНТЕРОМ';
                document.getElementById('status-sub').innerText = 'Проверьте неуверенно распознанные символы';
            }

            document.getElementById('btn-confirm').disabled = false;
        }

        function confirmCard() {
            const num = document.getElementById('inp-card').value;
            const sur = document.getElementById('inp-surname').value;
            const nam = document.getElementById('inp-name').value;
            alert('Карта № ' + num + ' успешно привязана к участнику: ' + sur + ' ' + nam);
        }

        // По умолчанию загружаем реальный образец только в превью (без автораспознавания)
        pickSample('real');
    </script>
</body>
</html>"""
    return HTMLResponse(content=html_content)

@app.get("/api/real-image")
def get_real_image():
    if os.path.exists(REAL_SAMPLE_PATH):
        img = cv2.imread(REAL_SAMPLE_PATH)
        _, buffer = cv2.imencode(".jpg", img)
        return HTMLResponse(content=buffer.tobytes(), media_type="image/jpeg")
    return HTMLResponse(content=b"", status_code=404)

@app.get("/api/mock-image")
def get_mock_image(case: int = 0):
    c = MOCK_CASES[case % len(MOCK_CASES)]
    img_bgr = create_filled_sample(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], add_noise=True)
    _, buffer = cv2.imencode(".png", img_bgr)
    return HTMLResponse(content=buffer.tobytes(), media_type="image/png")

@app.get("/api/recognize-sample")
def recognize_sample(type: str = Query("real")):
    if type == "real":
        if os.path.exists(REAL_SAMPLE_PATH):
            img = cv2.imread(REAL_SAMPLE_PATH)
            return JSONResponse(content=pipeline.process_image(img))
    elif type == "mock0":
        c = MOCK_CASES[0]
        img_bgr = create_filled_sample(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], add_noise=True)
        return JSONResponse(content=pipeline.process_image(img_bgr))
    elif type == "mock1":
        c = MOCK_CASES[1]
        img_bgr = create_filled_sample(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], add_noise=True)
        return JSONResponse(content=pipeline.process_image(img_bgr))
    return JSONResponse(content={"success": False, "error": f"Неизвестный тип: {type}"})

@app.post("/api/recognize-upload")
async def recognize_upload(file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    result = pipeline.process_image(img_bgr)
    return JSONResponse(content=result)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="127.0.0.1", port=port)
