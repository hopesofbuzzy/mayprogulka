# Сайт и система регистрации "Майской прогулки"

## Запуск
```bash
git clone https://github.com/hopesofbuzzy/mayprogulka.git
python -m venv .venv
pip install uv
# Запуск API-сервиса
uv run fastapi dev
# Для запуска случайного файла
uv run <файл>
# Для добавления библиотеки
uv add <библиотека>
```

## Структура
`src\mayprogulka\` - модули бэкенда.

`frontend\` - фронтенд.

`contracts\` - контракты и схемы.

`src\mayprogulka\entrypoint.py` - вход в бэкенд-приложение.

## Роли и API

Роли: `user`, `typist`, `registrar`, `marker`, `organizer`, `admin`.
`participant` — не роль, а запись участника в таблице `participants`.

Матрица прав и описание эндпоинтов: `contracts/api_contract.md`.
Машиночитаемый контракт: `contracts/openapi.roles.json`.
Те же схемы доступны в Swagger UI при запуске: `/docs`.

## Deployment
...
