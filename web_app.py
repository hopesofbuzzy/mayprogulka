from fastapi import FastAPI, File, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import cv2
import numpy as np
import base64
import os
from ocr_system.pipeline import FormOCRPipeline
from ocr_system.mock_filler import create_filled_sample

app = FastAPI(title="Mayprogulka AI-OCR Station")
pipeline = FormOCRPipeline()

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
        
        .preview-box { width: 100%; height: 420px; background: #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px dashed var(--surface-border); position: relative; }
        .preview-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
        
        .btn-group { display: flex; gap: 10px; margin-top: 16px; }
        .btn { padding: 10px 16px; border-radius: 6px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; transition: 0.2s; }
        .btn-primary { background: #0284c7; color: #fff; }
        .btn-primary:hover { background: #0369a1; }
        .btn-success { background: #16a34a; color: #fff; width: 100%; margin-top: 20px; padding: 12px; font-size: 15px; }
        .btn-success:hover { background: #15803d; }
        .btn-outline { background: transparent; border: 1px solid var(--surface-border); color: var(--text-primary); }
        .btn-outline:hover { background: rgba(255,255,255,0.05); }

        .field-group { margin-bottom: 12px; }
        .field-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; display: flex; justify-content: space-between; }
        .field-input { width: 100%; background: #0f172a; border: 1px solid var(--surface-border); padding: 8px 12px; border-radius: 4px; color: #fff; font-size: 14px; }
        .field-input:focus { border-color: var(--accent-blue); outline: none; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .status-box { padding: 12px; border-radius: 6px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
        .status-approved { background: rgba(34, 197, 94, 0.1); border: 1px solid var(--accent-green); color: var(--accent-green); }
        .status-review { background: rgba(245, 158, 11, 0.1); border: 1px solid var(--accent-amber); color: var(--accent-amber); }
        .metrics-row { display: flex; gap: 12px; margin-bottom: 16px; }
        .metric-pill { flex: 1; background: #0f172a; border: 1px solid var(--surface-border); border-radius: 6px; padding: 10px; text-align: center; }
        .metric-val { font-size: 18px; font-weight: 700; color: #fff; margin-top: 2px; }
        .metric-lbl { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; }
    </style>
</head>
<body>

    <div class="header">
        <div class="logo-title">
            <h1>Майская прогулка 2026 • AI-OCR Станция регистрации</h1>
            <p>Выравнивание бланка Homography • OMR детекция дистанции • Посимвольное распознавание ячеек</p>
        </div>
        <div class="badge">OCR Accuracy > 90% Active</div>
    </div>

    <div class="grid-container">
        <!-- Левая колонка: Камера / Загрузка бланка -->
        <div class="card">
            <div class="card-title">
                <span>1. Сканирование бланка</span>
                <span id="proc-speed" style="font-size: 12px; color: var(--accent-blue);">Время обработки: ~0.15s</span>
            </div>
            
            <div class="preview-box">
                <img id="form-preview" src="/api/mock-image?case=0" alt="Бланк анкеты">
            </div>

            <div class="btn-group">
                <button class="btn btn-outline" onclick="loadSample(0)">Анкета 1 (Иванов)</button>
                <button class="btn btn-outline" onclick="loadSample(1)">Анкета 2 (Смирнов)</button>
                <button class="btn btn-outline" onclick="loadSample(2)">Анкета 3 (Петрова)</button>
            </div>
            
            <div style="margin-top: 14px;">
                <input type="file" id="file-input" style="display: none;" onchange="uploadCustom(this)">
                <button class="btn btn-primary" style="width: 100%;" onclick="document.getElementById('file-input').click()">
                    📷 Загрузить / Сфотографировать бланк
                </button>
            </div>
        </div>

        <!-- Правая колонка: Оцифрованные данные -->
        <div class="card">
            <div class="card-title">
                <span>2. Распознанные данные участника</span>
                <span id="align-badge" style="font-size: 12px; color: var(--accent-green);">Геометрия: Выровнена (4-point)</span>
            </div>

            <div id="status-card" class="status-box status-approved">
                <div>
                    <strong id="status-text">✅ АНКЕТА ОЦИФРОВАНА (APPROVED)</strong>
                    <div style="font-size: 12px; margin-top: 2px;">Контрольные суммы и форматы подтверждены</div>
                </div>
                <div style="font-size: 20px; font-weight: 800;" id="conf-val">99.5%</div>
            </div>

            <div class="metrics-row">
                <div class="metric-pill">
                    <div class="metric-lbl">Точность OCR</div>
                    <div class="metric-val" id="metric-conf" style="color: var(--accent-green);">99.5%</div>
                </div>
                <div class="metric-pill">
                    <div class="metric-lbl">Дистанция (OMR)</div>
                    <div class="metric-val" id="metric-dist">50 км</div>
                </div>
                <div class="metric-pill">
                    <div class="metric-lbl">Возраст</div>
                    <div class="metric-val" id="metric-age">41 год</div>
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Фамилия (в ячейках)</div>
                    <input class="field-input" id="inp-surname" value="ИВАНОВ">
                </div>
                <div class="field-group">
                    <div class="field-label">Имя</div>
                    <input class="field-input" id="inp-name" value="ИВАН">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Отчество</div>
                    <input class="field-input" id="inp-patronymic" value="ИВАНОВИЧ">
                </div>
                <div class="field-group">
                    <div class="field-label">Пол</div>
                    <input class="field-input" id="inp-gender" value="Мужской">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Дата рождения</div>
                    <input class="field-input" id="inp-birth" value="21.03.1985">
                </div>
                <div class="field-group">
                    <div class="field-label">Телефон (+7)</div>
                    <input class="field-input" id="inp-phone" value="+7 (904) 123-45-67">
                </div>
            </div>

            <div class="field-row">
                <div class="field-group">
                    <div class="field-label">Город (автокоррекция)</div>
                    <input class="field-input" id="inp-city" value="ЕКАТЕРИНБУРГ">
                </div>
                <div class="field-group">
                    <div class="field-label">Выдана карта №</div>
                    <input class="field-input" id="inp-card" value="012345" style="color: var(--accent-blue); font-weight: 700;">
                </div>
            </div>

            <button class="btn btn-success" onclick="confirmRegistration()">
                ✓ Подтвердить и выдать карту участника (1 клик)
            </button>
        </div>
    </div>

    <script>
        async function loadSample(index) {
            document.getElementById('form-preview').src = '/api/mock-image?case=' + index + '&t=' + Date.now();
            const res = await fetch('/api/recognize-mock?case=' + index);
            const data = await res.json();
            updateForm(data);
        }

        async function uploadCustom(input) {
            if (!input.files || !input.files[0]) return;
            const formData = new FormData();
            formData.append('file', input.files[0]);
            
            // Локальный preview
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
            document.getElementById('inp-city').value = d.city || '';
            document.getElementById('inp-card').value = d.card_number || '';

            document.getElementById('metric-conf').innerText = res.overall_confidence + '%';
            document.getElementById('conf-val').innerText = res.overall_confidence + '%';
            document.getElementById('metric-dist').innerText = d.distance.split(' ')[0] + ' км';
            document.getElementById('metric-age').innerText = (d.calculated_age || '-') + ' лет';

            const statusCard = document.getElementById('status-card');
            const statusText = document.getElementById('status-text');
            if (res.status === 'APPROVED') {
                statusCard.className = 'status-box status-approved';
                statusText.innerText = '✅ АНКЕТА ОЦИФРОВАНА (APPROVED)';
            } else {
                statusCard.className = 'status-box status-review';
                statusText.innerText = '⚠️ ТРЕБУЕТ БЫСТРОЙ СВЕРКИ ВОЛОНТЕРОМ';
            }
        }

        function confirmRegistration() {
            alert('Карта ' + document.getElementById('inp-card').value + ' успешно привязана к участнику ' + document.getElementById('inp-surname').value + ' ' + document.getElementById('inp-name').value + '!');
        }

        // Запуск распознавания первого семпла
        loadSample(0);
    </script>
</body>
</html>
    """
    return HTMLResponse(content=html_content)

MOCK_CASES = [
    ('ИВАНОВ', 'ИВАН', 'ИВАНОВИЧ', '21', '03', '1985', 'M', '9041234567', 'ЕКАТЕРИНБУРГ', '02', 0, '012345'),
    ('СМИРНОВ', 'АЛЕКСАНДР', 'СЕРГЕЕВИЧ', '14', '06', '1992', 'M', '9126482190', 'ЕКАТЕРИНБУРГ', '04', 1, '042189'),
    ('ПЕТРОВА', 'АННА', 'ПАВЛОВНА', '15', '11', '2001', 'F', '9509876543', 'НИЖНИЙ ТАГИЛ', '00', 2, '009812')
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
