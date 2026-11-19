# Сайт и система регистрации "Майской прогулки"

## Запуск
```bash
git clone https://github.com/hopesofbuzzy/mayprogulka.git
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

`src\mayprogulka\routes\v1\` - эндпоинты.

`src\mayprogulka\database` - база данных.

`src\mayprogulka\models` - pydantic-модели

`frontend\` - фронтенд.

`src\contracts\` - контракты и схемы.

`src\mayprogulka\entrypoint.py` - вход в бэкенд-приложение.

## Deployment
...