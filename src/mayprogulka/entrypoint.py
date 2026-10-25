from fastapi import FastAPI
from .routes.v1.auth.route_auth import router as auth_router
from contextlib import asynccontextmanager
from database.database import engine, Base
from database.models import User, Participant, Route  # импортируй ВСЕ модели!

@asynccontextmanager
async def lifespan(app: FastAPI):
    # При старте создаем все таблицы
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # При завершении (если нужно) — очистка
app = FastAPI(title="May Progulka API")

# Регистрация роутов FastAPI Users
app.include_router(
    auth_router,
    prefix="/auth",
    tags=["auth"],
)