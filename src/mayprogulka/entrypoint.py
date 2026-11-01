from fastapi import FastAPI
from mayprogulka.routes.v1.auth.router import router as auth_router
from mayprogulka.routes.v1.participants.router import router as participants_router
from contextlib import asynccontextmanager
from database.database import engine, Base
from database.models import User, Participant, Route, Map, Checkpoint  # импортируй ВСЕ модели!

@asynccontextmanager
async def lifespan(app: FastAPI):
    # При старте создаем все таблицы
    async with engine.begin() as conn:
        print("Создание таблиц!")
        await conn.run_sync(Base.metadata.create_all)
    yield
    # При завершении (если нужно) — очистка

app = FastAPI(title="May Progulka API", lifespan=lifespan)

# Регистрация роутов FastAPI Users
app.include_router(
    auth_router,
    prefix="/auth",
    tags=["auth"],
)
app.include_router(
    participants_router,
    prefix="/participants",
    tags=["participants"],
)