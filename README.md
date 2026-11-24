# Майская прогулка 2026 — Фронтенд (без бэкенда)

Чистая клиентская часть цифровой платформы **«Майская прогулка 2026»** (статические HTML/CSS/JS-модули и локальные библиотеки без серверного кода), подготовленная для интеграции со сторонним бэкендом.

---

## Быстрый запуск (локально)

Фронтенд не требует сборки (`npm build` не нужен) — это готовые статические страницы с подключением в один шаг.

Поднимите любой статический HTTP-сервер из корня репозитория:

```bash
# Вариант 1: Python
python -m http.server 8080

# Вариант 2: Node.js
npx serve -l 8080 .

# Вариант 3: VS Code Live Server / Nginx
```

Откройте в браузере: **http://localhost:8080/index.html**

> **Важно:** для работы камеры (сканер QR/штрихкодов, съёмка анкет) на мобильных устройствах браузеры требуют **HTTPS** или `localhost`. При открытии по локальному IP по HTTP используется fallback на нативную загрузку фото (`<input type="file">`).

---

## Состав модулей (3 контура, 7 экранов)

| Файл | Контур | Назначение | Основные API-запросы |
| :--- | :--- | :--- | :--- |
| `index.html` | Hub | Главная витрина экосистемы и навигация | — |
| `mayprogulka_festival.html` | I. Публичный | Фестивальный лендинг, таймер, 3D-значок, обзор дистанций | — |
| `route_selector.html` | I. Публичный | Интерактивный выбор маршрутов (10 / 17 / 33 / 50 км), КП и GPX | — |
| `user_cabinet.html` | II. Участник | Онлайн-регистрация (личная и семейная), оплата, QR-билеты, диплом | `GET /api/participants/{id}`, `POST /api/register`, `POST /api/registrar/mark-paid`, `POST /api/system/reset-db` |
| `registrar_terminal.html` | III. Служебный | Стартовый терминал выдачи физических карт за 2 секунды | `GET /api/participants/{lookup}`, `POST /api/registrar/mark-paid`, `POST /api/registrar/issue-card` |
| `marker_terminal.html` | III. Служебный | Мобильный офлайн-терминал маркёра КП в лесу + кнопка SOS | `GET /api/participants`, `POST /api/scans/batch`, `POST /api/safety/emergency` |
| `safety_dashboard.html` | III. Служебный | Ситуационный центр (Safety Engine): контроль заката, SOS, отчёт CSV | `GET /api/safety/alerts` (polling 3 сек) |
| `typist_station.html` | III. Служебный | Станция наборщика: распознавание бумажных анкет (AI-OCR) | `POST /api/ocr/recognize`, `POST /api/register` |

### Вспомогательные файлы и ресурсы

- `api_config.js` — **единая точка настройки адреса бэкенда** (`API_BASE_URL` и хелпер `mpApiUrl(path)`).
- `ecosystem_bar.js` — плавающая кнопка-переключатель между всеми 7 модулями в правом нижнем углу каждой страницы.
- `html5-qrcode.min.js`, `qrcode.min.js`, `jsbarcode.min.js` — локальные библиотеки генерации и сканирования QR-кодов и штрихкодов (`CODE128`), работают без интернета.
- `assets/sample_filled_test.png` — образец заполненного бланка анкеты для экрана наборщика (`typist_station.html`).
- `DESIGN_SYSTEM.md` — брендбук, цветовые токены и типографика.
- `BACKEND_INTEGRATION.md` — **подробная спецификация API-контрактов для бэкенд-разработчиков**.

---

## Как подключить свой бэкенд

Есть 3 способа (подробнее описано в [`BACKEND_INTEGRATION.md`](BACKEND_INTEGRATION.md)):

### Способ 1. Через `api_config.js` (если бэк на другом порту/домене)
Откройте `api_config.js` и укажите базовый URL вашего API:
```js
const DEFAULT_API_BASE_URL = 'http://localhost:8000'; // без завершающего слэша
```
Не забудьте разрешить CORS на бэкенде для домена/порта фронтенда.

### Способ 2. Без правки файлов — через URL-параметр в браузере
Откройте любую страницу с параметром `?api=...`:
```
http://localhost:8080/user_cabinet.html?api=http://localhost:8000
```
Значение сохранится в `localStorage` (`mp_api_base`) для всех страниц. Для сброса используйте `?api=reset`.

### Способ 3. Единый origin / Reverse Proxy (Nginx или отдача статики самим бэкендом)
Оставьте `DEFAULT_API_BASE_URL = ''` в `api_config.js`. Все запросы пойдут на относительный путь `/api/...` того же домена.

---

## Дальнейшее чтение

👉 Полные контракты всех 10 эндпоинтов, форматы JSON / `multipart/form-data`, коды ошибок (`400`, `404`, `409`), доменная модель и чеклист проверки: **[`BACKEND_INTEGRATION.md`](BACKEND_INTEGRATION.md)**.
