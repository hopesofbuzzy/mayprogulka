
from pathlib import Path

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import DeclarativeBase


# Путь к файлу базы данных.
DB_PATH = Path(__file__).resolve().parent / "database.db"

# Подключение к SQLite.
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH.as_posix()}"

# Движок для работы с базой данных.
engine = create_async_engine(
    DATABASE_URL,
    echo=True,
)


# Фабрика асинхронных сессий.
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# Базовый класс для всех моделей.
class Base(DeclarativeBase):
    pass


# Создание таблиц.
async def create_db():
    # Импортируем модели, чтобы SQLAlchemy узнал о таблицах.
    import database.models

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


# Получение сессии для работы с БД.
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# Закрытие движка после завершения работы приложения.
async def close_db():
    await engine.dispose()
