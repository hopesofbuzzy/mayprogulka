# Задание по бд (составлялось ручками кроме блоков кода, рекомендую прочитать)
Твоя задача: построить архитектуру таблиц, собрать базу данных и инициализировать её. Будет круто заполнить тестовыми данными. Работать нужно в папке `src/database/`.
## Выбор базы данных
Для разработки можно sqlite, для продакшна строго PostgreSQL. Из этого следует, что нам нужна система, способная работать с разными бд вне зависимости от типа. Поэтому отодвигаем вопрос с базой, используем sqlite, но не пишем напрямую запросы. Пользуемся SQLalchemy.

**SQLalchemy** - это как ORM в Django. Он позволяет писать SQL запросы и описывать таблицы базы в виде python-кода.

Если будешь использовать сырой SQL, то учти, что для разных бд синтаксис может отличаться! Именно поэтому SQLalchemy в приоритете.

# Твои задачи
## 1. Инициализируй базу данных (на примере локального PostgresSQL сервера для бд)
Это целиком твоя задача.
```python
# ТВОЯ ЗАДАЧА
# database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base

# 1. Создаешь движок (подключение к БД,
# тут у нас для разработки будет sqlite)
DATABASE_URL = "postgresql+asyncpg://user:password@localhost/dbname"
engine = create_async_engine(DATABASE_URL, echo=False)

# 2. Создаешь фабрику сессий
AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# 3. Базовый класс для моделей
Base = declarative_base()

# 4. Функция для получения сессии в эндпоинтах
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
```

## 2. Спроектируй таблицы базы
Учти все требования из тз. Задавай вопросы заказчику, если есть проблемы.

## 3. Опиши модели таблиц по проекту
Твоя задача тут только в описании моделей таблиц. Используй SQLalchemy (уже установлен). Плюсы: независимость от конкретной базы данных
```python
# 1. Определяешь модель (один раз, в файле models.py)
from sqlalchemy import Column, Integer, String, DateTime
from database import Base

class Participant(Base):
    __tablename__ = 'participants'
    
    id = Column(Integer, primary_key=True)
    barcode = Column(String, unique=True, index=True)  # индекс для быстрого поиска
    name = Column(String)
    created_at = Column(DateTime)
```
Бонус (не тебе):
```python
# 2. Использование в эндпоинте (в файле routes.py) 
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db

router = APIRouter()

@router.post("/scan")
async def scan_barcode(barcode: str, db: AsyncSession = Depends(get_db)):
    # Ищем участника по штрих-коду
    result = await db.execute(
        select(Participant).where(Participant.barcode == barcode)
    )
    participant = result.scalar_one_or_none()
    
    if not participant:
        return {"error": "Участник не найден"}
    
    # Логируем прохождение КП
    scan_log = ScanLog(participant_id=participant.id, checkpoint_id=1)
    db.add(scan_log)
    await db.commit()
    
    return {"status": "ok", "participant": participant.name}
```

## 4. Реализуй систему миграций (опицонально)
Это уже опционально на самом деле.

**Alembic** - система миграций как в Django. Alembic позволяет инициализировать бд, хранить историю изменений архитектуры и не терять данные при обновлении.

```bash
# Добавляешь alembic в зависимости (уже сделано)
uv add alembic
# Далее запускай через "uv run alembic", а не просто "alembic"
# Инициализация Alembic (один раз)
alembic init alembic

# В alembic/env.py указываешь:
from database import Base
target_metadata = Base.metadata

# Создаешь первую миграцию
alembic revision --autogenerate -m "initial tables"

# Применяешь к БД для обновления
alembic upgrade head
```
И теперь при изменениях архитектуры никаких поломок у других членов команды.
```bash
git pull
alembic upgrade head
```

