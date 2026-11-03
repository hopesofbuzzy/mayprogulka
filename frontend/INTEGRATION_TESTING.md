# Frontend: изолированные проверки и будущий read-only FastAPI preflight

TASK-11. **Real FastAPI: NOT_RUN. Реальных запросов к FastAPI и записей в БД в этой итерации нет.** Продуктовый копирайт не повышает готовность сервера. Browser/mock PASS, read-only schema/routes PASS и конкретный live write smoke — разные уровни доказательств.

## 1. Обычное приложение и размещение

Обычный dev: браузер → относительный /api/v1 → существующий Vite /api proxy → API_PROXY_TARGET (из локального env либо существующий default127.0.0.1:8000). Запросы используют один openapi-fetch client с credentials:omit; public GET routes/checkpoints без Bearer, private requests с memory-only текущими credentials/epoch. Нет API→fixtures fallback, fake login или localStorage режима.

Production: браузер → сервер размещения → /api/v1/* в FastAPI; assets в статические файлы; UI URL в SPA index.html. Dev proxy в production не существует. Vite preview явно имеет proxy:{} и также не пересылает API; ошибочный HTML вместо JSON приводит к ошибке UI. Настройка реального reverse proxy/HTTPS/CORS/cache/SPA fallback — ответственность окружения, в TASK-11 не менялась.

Инварианты не менялись: точные DTO/пути OpenAPI, роли admin/typist, 401/epoch/private cleanup, strings barcode/form_id, safe map/PDF URL, пустой PDF allowlist, no blind retry и no optimistic irreversible state. Раздел «Оплата участия» меняет только серверную отметку без списания денег; paid не является финансовым подтверждением. Batch default-OFF, требует одновременно MODE=e2e и VITE_ENABLE_CHECKPOINT_BATCH=true.

## 2. Локальная приёмка без FastAPI

Из frontend, Node26.x/npm:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run api:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test
npm.cmd run test:preflight
node --test scripts/runtime-readiness.test.mjs
npm.cmd run test:e2e
npx.cmd playwright test --config playwright.batch-off.config.ts
npx.cmd playwright test --config playwright.normal.config.ts
```

В POSIX — npm/npx без .cmd. При уже установленных зависимостях повторный ci/install для обычной проверки не нужен. Lock/dependencies TASK-11 не меняет.

Основная Playwright-конфигурация поднимает собственный Vite127.0.0.1:4179 --strictPort --mode e2e, reuseExistingServer:false, 2workers/retries0. Проекты1280×720/390×844/360×800/768×1024. Занятый порт — ошибка; не завершайте чужие процессы и не подключайтесь к случайному dev server.

Auto fixture разрешает только конкретные известные HTTP methods/paths и валидирует DTO/текущий синтетический Bearer; неизвестная API/внешняя сеть блокируется и проваливает тест, без fallback/route.fetch. e2e proxy пуст, service workers заблокированы. Batch разрешается только этому процессу. Fixture назначает ID/count только как контролируемый «сервер», frontend не вычисляет успешные строки из errors[].

Production-off: заранее собранный dist через Vite preview4179; batch скрыт, singleton UI доступен. Normal-runtime: настоящий development mode4181 с намеренно выставленным batch=true; API transport abort перехватывается в браузере **до proxy**, доказывая error без фиктивного каталога. Остальные данные этого теста тоже только intercepted synthetic responses. Ни один сценарий не связывается с FastAPI.

runtime-readiness.test.mjs: конфигурационные проверки Vite без server.listen и проверка графа runtime imports, исключающая tests/fixtures/mock scripts/storage/DEV fallback. Тестовый dev-target — лишь значение в памяти, соединения к нему нет. test:preflight использует контролируемый fetch, без живой сети.

Артефакты основного набора по прежней конфигурации сначала task-05-artifacts; финальная копия TASK-11 в ../local_docs/task-11-artifacts. Normal outputs сразу там; off outputs по прежнему task-10-artifacts и копируются. Trace/HAR/video off. Не включать их на живом окружении без отдельной политики обезличивания. Не сохранять токены/пароли, реальные ФИО/контакты, raw HTTP bodies, payment IDs/PDF URLs в доказательствах.

## 3. Допуск к будущему read-only probe

Сначала владелец окружения подтверждает:

| Условие | Требование |
|---|---|
| Origin | Точный согласованный HTTP(S) test origin без path/query/fragment/credentials |
| Назначение | Отдельная тестовая БД/окружение; нет production/реальных клиентских данных |
| Ответственный | Кто разрешает проверку и принимает результаты |
| Secrets/security | Устранены фиксированные backend secrets, проверена политика публикации schema/docs и защита опасных admin/maps |
| Контракт | Live /openapi.json сравнивается с tracked 3.1.0/API0.1.0, 20paths/22operations |
| Полномочия | Read-only допуск не является разрешением login/POST/PUT/DELETE |
| Доказательства | Только code/MIME/счётчики/имена несовпавших полей, без содержимого записей и credentials |

**В TASK-11 origin не предоставлен; команды ниже не выполнялись.** Не выбирайте пример8000 за владельца стенда.

PowerShell, только после утверждения фактического origin:

```powershell
$env:LIVE_API_ORIGIN = '<APPROVED_TEST_ORIGIN>'
npm.cmd run integration:preflight
$LASTEXITCODE
Remove-Item Env:LIVE_API_ORIGIN
```

Git Bash на Windows:

```bash
LIVE_API_ORIGIN='<APPROVED_TEST_ORIGIN>' npm.cmd run integration:preflight
echo $?
```

POSIX:

```sh
LIVE_API_ORIGIN='<APPROVED_TEST_ORIGIN>' npm run integration:preflight
echo $?
```

Подставляется согласованный origin, не буквальный placeholder. Нет Bearer/cookies и login. Probe выполняет **только** GET /openapi.json и GET /api/v1/routes, redirect:error, timeout4s, без retry. Не вызывается автоматически test/build/E2E и не пишет schema/types/БД.

Первый GET сравнивает версии, наличие всех 22 известных операций, их requestBody/responses/parameters и эффективный security (включая наследование от корня), общие параметры пути и все ожидаемые components, включая 36 schemas. Документирующие title/description/examples не сравниваются; одноимённые поля DTO сохраняются при сравнении. Добавочные операции и components разрешены: например, четыре новых POST scans при неизменных известных контрактах дают COMPATIBLE_WITH_EXTRAS. Они перечисляются в added как extra-in-backend и не становятся функциями приложения. Изменения и удаления перечисляются в changed/missing и дают CONTRACT_MISMATCH. Локальный контракт остаётся 20 путей / 22 операции; generated types автоматически не обновляются.

Второй GET требует200 JSON {routes:RouteResponse[]} и проверяет обязательные типы/nullable поля. HTML/неверный JSON/DTO/редирект не считаются PASS. Содержимое routes не выводится. Семь P0 операций остаются отдельной контрольной группой локального контракта; сравнение внешней схемы больше не ограничивается ими. Сравнение структур консервативное: изменение известной схемы требует ревью, даже если сервер считает его совместимым.

| Статус | Смысл |
|---|---|
| NOT_RUN | Нет explicit origin или проверка не выполнялась; без origin exit2 и без сети |
| BLOCKED | Некорректный origin/неподтверждённый допуск, без записи |
| UNREACHABLE | Нет соединения/timeout, ненулевой exit; это не отсутствие функции |
| CONTRACT_MISMATCH | Разошлись версии/операции/структуры; контракт не переписывать автоматически |
| COMPATIBLE_WITH_EXTRAS | Все известные контракты сохранены; дополнительные серверные операции перечислены, но не реализованы фронтендом. Это успех сравнения схемы, не проверка поведения этих методов |
| PASS_LIVE | Успех именно read-only операции, которую реально проверили |
| FAIL_LIVE | Конкретная реальная операция дала неверное HTTP/JSON/поведение |

Probe может логировать PASS для двух чтений; в отчёте укажите, какие именно GET подтверждены, не повышайте остальные22 операции до verified. При отсутствующем schema endpoint сравнение остаётся NOT_RUN; работоспособность routes его не заменяет.

## 4. Будущий live smoke — не выполнять в TASK-11

После read-only gate команда отдельно предоставляет синтетические admin/participant/typist/organizer accounts и сценарии anonymous/expired, устраняет backend security blockers, проверяет negative RBAC для каждого метода. Особо H: POST admin/maps, POST admin/maps/batch, GET admin/maps/{barcode} и POST routes/{id}/map. Наличие Python router/schema не подтверждает подключение сканов или защиту.

Каждый write требует отдельного письменного разрешения владельца тестовой БД, выбранных синтетических данных, плана очистки, диагностики unknown/дублей/partial и принимающего QA. Read-only preflight нельзя расширять скрытыми write smoke. Не создавайте роли/аккаунты, участников, оплату, карты или КП без допуска. Не переносите database код и не объединяйте ветки ради проверки frontend.

Открытые вопросы сохраняются в ../local_docs/TASK-06-BACKEND-QUESTIONS.md, TASK-08-BACKEND-QUESTIONS.md, TASK-09-BACKEND-QUESTIONS.md, TASK-10-BACKEND-QUESTIONS.md. Ключевые блокеры: реальные RBAC/secret handling, atomicity/idempotency, частичные PUT/null/false, DELETE history, полный GET, string coordinates/order/flags, batch count/errors/result identity, PDF host/path/auth/delivery и session TTL/revocation.

PDF allowlist остаётся пустой; подписанные/внешние URL, токен в query и повтор pay ради файла не допускаются. Успешный pay-response и paid из GET — отметка stub, не реальные деньги; серверная эксплуатация требует отдельной приёмки.

## 5. Отчётность

Для каждого сценария отдельно: операция, источник данных, что фактически запускалось, code/MIME/счётчики или причина NOT_RUN/BLOCKED. Свежие результаты TASK-11: ../local_docs/TASK-11-REPORT.md, TASK-11-API-READINESS.md, TASK-11-COPY-AUDIT.md и task-11-artifacts/summary.json.

```text
Frontend/mock checks: PASS / FAIL / NOT_RUN
Read-only FastAPI: PASS_LIVE / CONTRACT_MISMATCH / UNREACHABLE / NOT_RUN
Live writes: NOT_RUN / separately authorized result
```

TASK-11 не изменяет Python, database, OpenAPI/schema, мастер4.3, session/HTTP/PDF security или Git history. Все изменения агента остаются unstaged/uncommitted.
