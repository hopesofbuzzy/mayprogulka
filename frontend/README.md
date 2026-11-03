# Майская прогулка — frontend

React/TypeScript strict, Vite, React Router Data Mode, CSS Modules, TanStack Query и один типизированный openapi-fetch клиент. Продуктовые требования — мастер-спецификация v4.3; HTTP/DTO — только `../contracts/openapi.current.json` (OpenAPI 3.1.0, API 0.1.0, 20 путей / 22 операции).

## Обычный запуск с API

Из `frontend/`, Node 26.x и npm:

```powershell
npm.cmd ci
npm.cmd run dev
```

В POSIX используйте npm/npx без .cmd. При необходимости скопируйте .env.example в локальный env и задайте **согласованный** API_PROXY_TARGET. Это dev-only настройка Vite proxy `/api`; по умолчанию существующий адрес — `http://127.0.0.1:8000`. Токены/пароли в env не помещать.

Обычное приложение получает данные через `/api/v1`: нет встроенного mock-каталога, фиктивного входа, fallback или service worker. Недоступный API даёт loading/error/empty по фактическому результату. Публичные routes/checkpoints идут без Bearer, credentials:omit. Приватные запросы используют текущий токен из памяти и session epoch; старый 401 не завершает новую сессию.

Вход и все приватные данные живут только в памяти вкладки. После reload нужен новый вход. Logout очищает приватный Query cache и результаты; серверного logout/refresh/revocation API нет. Токены и формы не сохраняются в URL, localStorage, sessionStorage, логах или публичных snapshots.

## Реализованные страницы

- Публичные: главная с обзором участия, /about, /routes, /routes/:routeId, /how-to, /faq, /login, /signup, 404. Главная и /about статичны и не запрашивают API. Общая навигация и футер ведут на существующие публичные страницы; редакционный футер скрыт на /account, /staff и их потомках. На телефоне после действий hero — компактная локальная SVG. Маршруты и КП — API-данные, без выдуманных дат/цен. map_url проходит прежнюю безопасную проверку; схема не является физической картой.
- Кабинет: /account, /account/participants/new, /account/participants/:id, /account/participants/:id/pay. Несколько участников с индивидуальным маршрутом, индексные 422, собственный список/карточка.
- Раздел **«Оплата участия»**: один заметный баннер до действия сообщает, что меняется только статус и деньги не списываются. Кнопка «Продолжить без списания», допустимые значения card/sbp без банковских реквизитов. Ответ операции отделён от свежей отметки участника. paid не объявляется финансовым подтверждением.
- Анкета для печати предлагается только по безопасной ссылке из фактического ответа. Production PDF allowlist **пуст** до согласования точных host/path и способа доступа; null/unsafe URL не дают активной ссылки. Email/повторный GET PDF/восстановление ссылки не реализованы.
- Только точный admin: /staff/routes и /staff/routes/:routeId/checkpoints; маршруты и одиночные КП, review, частичный PUT, точный ID для удаления. Публичный каталог не считается полным admin-реестром. Strict guard не доказывает серверный RBAC.
- Только точный typist: /staff/typist и /new, /match, /unlinked внутри него. Онлайн-анкета не создаётся повторно; номер бумажной анкеты назначается системой, затем вручную сопоставляется со строковым штрихкодом. Нули сохранены. Выборка карт до100, не полный реестр. Исправление/отмена сохранённой связи недоступны.

Роли не назначаются клиентом. Организаторская статистика, сканы, физические карты/admin maps, загрузка схем, история, настоящие платежи, CMS/SSR/PWA и следующие задания не реализованы.

## Записи и неизвестный результат

Нет автоматических повторов POST/PUT/DELETE. 408, timeout, abort, обрыв, 5xx или некорректный ответ не считаются ни успехом, ни доказательством отсутствия записи. Данные/маркер текущей сессии сохраняются, где это предусмотрено сценарием; нужны сверка и отдельное осознанное подтверждение. Оплата после любой отправки не предоставляет второй POST; unknown DELETE не переотправляется.

Успех требует точного HTTP/DTO, затем обновляется существующий общий или приватный GET. Нет оптимистической подмены необратимых статусов. Отказ обновления списка отделён от подтверждённой записи. Публичная выборка может быть неполной, отсутствие записи не снимает риск. Memory-only маркеры не являются аудитом и не переживают reload/logout. Version/ETag/idempotency API отсутствуют; concurrent edits остаются серверным ограничением.

## Batch КП: default OFF

`VITE_ENABLE_CHECKPOINT_BATCH=true` действует **только совместно с mode=e2e**. Обычные dev/production игнорируют случайный true; .env.example содержит false. Gate проверяется также перед запросом и не заменяет admin RBAC.

В изолированных тестах — один POST /api/v1/admin/checkpoints/batch, одинаковый route_id контейнера и каждой строки, opaque coordinates, ручной order, независимые bool. created_count/errors[] не дают ID или соответствия строкам. Partial/unknown можно отложить, они блокируют новое одиночное и пакетное CREATE того же маршрута до усиленного «Разобрано вне приложения»; это только локальная отметка, не доказательство отсутствия дублей. Исходная партия не повторяется.

Продуктовая batch-форма не содержит ярлыков окружения. Существующий `scripts/batch-mock-preview.mjs` — отдельный явно маркированный test-only Vite process: нужен явный opt-in, mode=e2e, API proxy отсутствует, banner находится вне React-формы. Он не импортируется normal runtime и не является способом подключения API. Новая общая demo-кнопка или fallback не добавлялись. Для продуктового просмотра используйте обычный dev с согласованным API, а не этот синтетический стенд.

## Проверки

```powershell
npm.cmd run api:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test
npm.cmd run test:preflight
node --test scripts/runtime-readiness.test.mjs
npx.cmd playwright install chromium
npm.cmd run test:e2e
npx.cmd playwright test --config playwright.batch-off.config.ts
npx.cmd playwright test --config playwright.normal.config.ts
```

Основной E2E: собственный Vite127.0.0.1:4179, strictPort, reuseExistingServer:false, mode=e2e, явный batch flag. Все API перехватывает строгая fixture, неизвестные API/внешняя сеть блокируются, без route.fetch/live fallback. Только синтетические данные, токены/пароли создаются в памяти теста. Trace/HAR/video отключены. Старые security assertions сохранены, меняются только ожидаемые продуктовые подписи.

Production-off конфигурация обслуживает предварительно собранный dist. Normal конфигурация использует обычный development mode на4181: транспортный отказ API моделируется **в браузере до proxy**, чтобы не обращаться к FastAPI; отдельно проверяется игнорирование случайного batch flag. Эти ответы принадлежат только автоматизированным тестам и не импортируются приложением.

3 Node readiness tests проверяют разрешённый dev proxy target, отсутствие proxy в e2e/preview и отсутствие достижимых fixtures/mock scripts/storage fallback в runtime import graph. Они не запускают API. Preflight tests также используют контролируемый fetch без живой сети.

Фактические результаты TASK-11, screenshots и список файлов: `../local_docs/TASK-11-REPORT.md`, `TASK-11-COPY-AUDIT.md`, `TASK-11-API-READINESS.md`, `task-11-artifacts/`. Исторические этапы — отдельные TASK-01…10 отчёты; их mock PASS не доказывает live.

## Production и будущая интеграция

`npm.cmd run build` создаёт статический dist. Vite preview обслуживает его **без API proxy**; это явно задано, поскольку Vite иначе наследует server.proxy. Preview не является production-сервером. Размещение должно отдельно маршрутизировать /api/v1/* в FastAPI, статические assets в файлы, клиентские URL в SPA index.html. Нельзя возвращать HTML приложения на API URL. Нужны согласованные HTTPS, reverse proxy, кеширование и SPA fallback; серверная конфигурация не менялась.

Текущий live-статус: **Real FastAPI: NOT_RUN**. TASK-11 не делает даже read-only вызов без утверждённого origin. `integration:preflight` требует LIVE_API_ORIGIN и выполняет только GET /openapi.json и GET /api/v1/routes без Bearer/cookies/редиректов/retry. Без origin — NOT_RUN, без сети. Команды Windows/Git Bash/POSIX и классификация результатов: [INTEGRATION_TESTING.md](./INTEGRATION_TESTING.md).

До write smoke команда предоставляет изолированные origin/БД/учётные записи, устраняет backend security blockers (admin maps и фиксированные секреты), сверяет live schema, проверяет отрицательный RBAC и даёт отдельное письменное разрешение на конкретные записи. Фронтенд не меняет Python/database/OpenAPI и не объединяет ветки.

## Структура и дизайн

app/pages/features/shared; отдельные routes/auth/participants/payments/typist/adminRoutes/adminCheckpoints/adminShared. Единственный client и generated schema.d.ts; api:check проверяет воспроизводимость без правки контракта.

Сохранены исходный hero, двухколоночная композиция на1280, локальные SVG/логотип, CSS Modules и forest/paper/coral. Локальная Roboto — выбранная близкая гарнитура, не доказанное название шрифта оригинала. Лицензия SIL OFL1.1: THIRD_PARTY_LICENSES.txt. Карты/фотографии/шрифты с внешних хостов не подключены.

AGENTS и local_docs игнорируются и не попадут автоматически в clone: инструкции, v4.3 и утверждённые references нужно передать отдельно. Git операции записи/истории агент не выполняет.
