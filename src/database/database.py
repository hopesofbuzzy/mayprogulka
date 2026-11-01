
from pathlib import Path

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy import select
from sqlalchemy.orm import DeclarativeBase


# Путь к файлу базы данных.
DB_PATH = Path(__file__).resolve().parent / "database.db"

# Подключение к SQLite.
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH.as_posix()}"

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin"
ADMIN_EMAIL = "admin@example.com"

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

# Создание учётной записи админа
async def create_default_admin():
    """Создание администратора по умолчанию, если его нет."""
    from database.models import User
    from mayprogulka.routes.v1.auth.service import get_password_hash

    async with AsyncSessionLocal() as session:
        # Проверяем, есть ли уже админ
        result = await session.execute(
            select(User).where(User.username == ADMIN_USERNAME)
        )
        existing_admin = result.scalar_one_or_none()
        
        if existing_admin:
            print(f"✓ Админ '{ADMIN_USERNAME}' уже существует")
            return
        
        # Создаем админа
        admin = User(
            username=ADMIN_USERNAME,
            email=ADMIN_EMAIL,
            hashed_password=get_password_hash(ADMIN_PASSWORD),
            role="admin",
            is_active=True,
        )
        session.add(admin)
        await session.commit()
        await session.refresh(admin)
        
        print(f"✓ Создан админ по умолчанию: {ADMIN_USERNAME} / {ADMIN_PASSWORD}")