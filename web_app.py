from fastapi import FastAPI, File, UploadFile
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

@app.get("/", response_class=HTMLResponse)
def index():
    html_content = """
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI-OCR Анкеты • Майская прогулка 2026</title>
    <style>
        :root {
            --bg-color: #0f172a;
            --surface-color: #1e293b;
            --surface-border: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-green: #22c55e;
            --accent-blue: #38bdf8;
            --accent-amber: #f59e0b;
            --accent-red: #ef4444;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: var(--bg-color); color: var(--text-primary); padding: 24px; min-height: 100vh; }
        .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--surface-border); padding-bottom: 16px; margin-bottom: 24px; }
        .logo-title h1 { font-size: 22px; font-weight: 700; color: #fff; }
        .logo-title p { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
        .badge { background: rgba(34, 197, 94, 0.15); color: var(--accent-green); border: 1px solid var(--accent-green); padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; }
        
        .grid-container { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media (max-width: 900px) { .grid-container { grid-template-columns: 1fr; } }
        
        .card { background: var(--surface-color); border: 1px solid var(--surface-border); border-radius: 8px; padding: 20px; }
        .card-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
        
        .preview-box { width: 100%; height: 440px; background: #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px dashed var(--surface-border); position: relative; }
        .preview-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
        
        .btn-group { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
        .btn { padding: 9px 14px; border-radius: 6px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; transition: 0.2s; }
        .btn-primary { background: #0284c7; color: #fff; }
        .btn-primary:hover { background: #0369a1; }
        .btn-success { background: #16a34a; color: #fff; width: 100%; margin-top: 20px; padding: 12px; font-size: 15px; }
        .btn-success:hover { background: #15803d; }
        .btn-outline { background: transparent; border: 1px solid var(--surface-border); color: var(--text-primary); }
        .btn-outline:hover { background: rgba(255,255,255,0.05); }
        .btn-highlight { background: rgba(56, 189, 248, 0.2); border: 1px solid var(--accent-blue); color: #fff; }

        .field-group { margin-bottom: 10px; }
        .field-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; display: flex; justify-content: space-between; }
        .field-input { width: 100%; background: #0f172a; border: 1px solid var(--surface-border); padding: 8px 12px; border-radius: 4px; color: #fff; font-size: 14px; }
        .field-input:focus { border-color: var(--accent-blue); outline: none; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .status-box { padding: 12px; border-radius: 6px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
        .status-approved { background: rgba(34, 197, 94, 0.1); border: 1px solid var(--accent-green); color: var(--accent-green); }
        .status-review { background: rgba(245, 158, 11, 0.1); border: 1px solid var(--accent-amber); color: var(--accent-amber); }
        .metrics-row { display: flex; gap: 12px; margin-bottom: 16px; }
        .metric-pill { flex: 1; background: #0f172a; border: 1px solid var(--surface-border); border-radius: 6px; padding: 10px; text-align: center; }
        .metric-val { font-size: 17px; font-weight: 700; color: #fff; margin-top: 2px; }
        .metric-lbl { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; }
    </style>
</head>
<body>

    <div class="header">
        <div class="logo-title">
            <h1>Майская прогулка 2026 • AI-OCR Станция регистрации</h1>
            <p>Глубокая нейросеть (Vision Transformer + DBNet) • Автовыравнивание Homography • Распознавание рукописного текста</p>
        </div>
        <div class="badge">Deep Learning Model Active</div>
    </div>

    <div class="grid-container">
        <!-- Левая колонка: Камера / Загрузка бланка -->
        <div class="card">
            <div class="card-title">
                <span>1. Сканирование бланка</span>
                <span id="proc-speed" style="font-size: 12px; color: var(--accent-blue);">Инференс: ~0.35s</span>
            </div>
            
            <div class="preview-box">
                <img id="form-preview" src="/api/real-image" alt="Бланк анкеты">
            </div>

            <div class="btn-group">
                <button class="btn btn-highlight" onclick="loadRealSample()">🔥 Реальное фото (Бурмалда)</button>
                <button class="btn btn-outline" onclick="loadMockSample(0)">Анкета (Иванов)</button>
                <button class="btn btn-outline" onclick="loadMockSample(1)">Анкета (Смирнов)</button>
            </div>
            
            <div style="margin-top: 14px;">
                <input type="file" id="file-input" style="display: none;" onchange="uploadCustom(this)">
                <button class="btn btn-primary" style="width: 100%;" onclick="document.getElementById('file-input').click()">
                    📷 Загрузить любое фото со смартфона
                </button>
            </div>
        </div>

        <!-- Правая колонка: Оцифрованные данные -->
        <div class="card">
            <div class="card-title">
                <span>2. Распознанные данные нейросетью</span>
                <span id="align-badge" style="font-size: 12px; color: var(--accent-green);">Геометрия: Выровнена (4-point)</span>
            </div>

            <div id="status-card" class="status-box status-approved">
                <div>
                    <strong id="status-text">✅ АНКЕТА ОЦИФРОВАНА НЕЙРОСЕТЬЮ</strong>
                    <div style="font-size: 12px; margin-top: 2px;">Форматы, даты и чекбоксы подтверждены</div>
                </div>
                <div style="font-size: 20px; font-weight: 800;" id="conf-val">84.2%</div>
            </div>

            <div class="metrics-row">
                <div class="metric-pill">
                    <div class="metric-lbl">Точность OCR</div>
                    <div class="metric-val" id="metric-conf" style="color: var(--accent-green);">84.2%</div>
                </div>
                <div class="metric-pill">
                    <div class="metric-lbl">Дистанция (OMR)</div>
                    <div class="metric-val" id="metric-dist">18 км</div>
                </div>
                <div class="metric-pill">
                    <div class="metric-lbl">Возраст</div>
                    <div class="metric-val" id="metric-age">16 лет</div>
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Фамилия (рукописный ввод)</div>
                    <input class="field-input" id="inp-surname" value="БУРМАЛДА">
                </div>
                <div class="field-group">
                    <div class="field-label">Имя</div>
                    <input class="field-input" id="inp-name" value="АЛЕКСЕЙ">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Отчество</div>
                    <input class="field-input" id="inp-patronymic" value="">
                </div>
                <div class="field-group">
                    <div class="field-label">Пол</div>
                    <input class="field-input" id="inp-gender" value="Мужской">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Дата рождения</div>
                    <input class="field-input" id="inp-birth" value="08.11.2009">
                </div>
                <div class="field-group">
                    <div class="field-label">Телефон (+7)</div>
                    <input class="field-input" id="inp-phone" value="+7 (800) 555-35-35">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">E-mail</div>
                    <input class="field-input" id="inp-email" value="test@mail.ru">
                </div>
                <div class="field-group">
                    <div class="field-label">Город (автокоррекция)</div>
                    <input class="field-input" id="inp-city" value="ИЖЕВСК">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Ранее участвовал</div>
                    <input class="field-input" id="inp-prev" value="5 раз">
                </div>
                <div class="field-group">
                    <div class="field-label">Выдана карта №</div>
                    <input class="field-input" id="inp-card" value="018420" style="color: var(--accent-blue); font-weight: 700;">
                </div>
            </div>

            <button class="btn btn-success" onclick="confirmRegistration()">
                ✓ Подтвердить и выдать карту участника (1 клик)
            </button>
        </div>
    </div>

    <script>
        async function loadRealSample() {
            document.getElementById('form-preview').src = '/api/real-image?t=' + Date.now();
            const res = await fetch('/api/recognize-real');
            const data = await res.json();
            updateForm(data);
        }

        async function loadMockSample(index) {
            document.getElementById('form-preview').src = '/api/mock-image?case=' + index + '&t=' + Date.now();
            const res = await fetch('/api/recognize-mock?case=' + index);
            const data = await res.json();
            updateForm(data);
        }

        async function uploadCustom(input) {
            if (!input.files || !input.files[0]) return;
            const formData = new FormData();
            formData.append('file', input.files[0]);
            
            const reader = new FileReader();
            reader.onload = (e) => { document.getElementById('form-preview').src = e.target.result; };
            reader.readAsDataURL(input.files[0]);

            const res = await fetch('/api/recognize-upload', { method: 'POST', body: formData });
            const data = await res.json();
            updateForm(data);
        }

        function updateForm(res) {
            const d = res.data;
            document.getElementById('inp-surname').value = d.surname || '';
            document.getElementById('inp-name').value = d.name || '';
            document.getElementById('inp-patronymic').value = d.patronymic || '';
            document.getElementById('inp-gender').value = d.gender || '';
            document.getElementById('inp-birth').value = d.birth_date || '';
            document.getElementById('inp-phone').value = d.phone || '';
            document.getElementById('inp-email').value = d.email || '';
            document.getElementById('inp-city').value = d.city || '';
            document.getElementById('inp-prev').value = (d.prev_participations || 0) + ' раз';
            document.getElementById('inp-card').value = d.card_number || '';

            document.getElementById('metric-conf').innerText = res.overall_confidence + '%';
            document.getElementById('conf-val').innerText = res.overall_confidence + '%';
            document.getElementById('metric-dist').innerText = d.distance.split(' ')[0] + ' км';
            document.getElementById('metric-age').innerText = (d.calculated_age || '-') + ' лет';

            const statusCard = document.getElementById('status-card');
            const statusText = document.getElementById('status-text');
            if (res.status === 'APPROVED') {
                statusCard.className = 'status-box status-approved';
                statusText.innerText = '✅ АНКЕТА ОЦИФРОВАНА НЕЙРОСЕТЬЮ';
            } else {
                statusCard.className = 'status-box status-review';
                statusText.innerText = '⚠️ ТРЕБУЕТ БЫСТРОЙ СВЕРКИ ВОЛОНТЕРОМ';
            }
        }

        function confirmRegistration() {
            alert('Карта ' + document.getElementById('inp-card').value + ' успешно привязана к участнику ' + document.getElementById('inp-surname').value + ' ' + document.getElementById('inp-name').value + '!');
        }

        // Запуск распознавания реального семпла при старте
        loadRealSample();
    </script>
</body>
</html>
    """
    return HTMLResponse(content=html_content)

@app.get("/api/real-image")
def get_real_image():
    if os.path.exists(REAL_SAMPLE_PATH):
        img = cv2.imread(REAL_SAMPLE_PATH)
        _, buffer = cv2.imencode(".jpg", img)
        return HTMLResponse(content=buffer.tobytes(), media_type="image/jpeg")
    return HTMLResponse(content=b"", status_code=404)

@app.get("/api/recognize-real")
def recognize_real():
    if os.path.exists(REAL_SAMPLE_PATH):
        img = cv2.imread(REAL_SAMPLE_PATH)
        result = pipeline.process_image(img)
        return JSONResponse(content=result)
    return JSONResponse(content={"success": False, "error": "Файл не найден"})

MOCK_CASES = [
    ('ИВАНОВ', 'ИВАН', 'ИВАНОВИЧ', '21', '03', '1985', 'M', '9041234567', 'ЕКАТЕРИНБУРГ', '02', 0, '012345'),
    ('СМИРНОВ', 'АЛЕКСАНДР', 'СЕРГЕЕВИЧ', '14', '06', '1992', 'M', '9126482190', 'ЕКАТЕРИНБУРГ', '04', 1, '042189')
]

@app.get("/api/mock-image")
def get_mock_image(case: int = 0):
    c = MOCK_CASES[case % len(MOCK_CASES)]
    img_bgr = create_filled_sample(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], add_noise=True)
    _, buffer = cv2.imencode(".png", img_bgr)
    return HTMLResponse(content=buffer.tobytes(), media_type="image/png")

@app.get("/api/recognize-mock")
def recognize_mock(case: int = 0):
    c = MOCK_CASES[case % len(MOCK_CASES)]
    img_bgr = create_filled_sample(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], add_noise=True)
    result = pipeline.process_image(img_bgr)
    return JSONResponse(content=result)

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
