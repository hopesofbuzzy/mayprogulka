from fastapi import FastAPI, APIRouter
from mayprogulka.routes.v1.auth.router import router as auth_router
from mayprogulka.routes.v1.participants.router import router as participants_router
from mayprogulka.routes.v1.routes.router import router as routes_router
from contextlib import asynccontextmanager
from database.database import create_db, create_default_admin

@asynccontextmanager
async def lifespan(app: FastAPI):
    # При старте создаем все таблицы
    await create_db()
    await create_default_admin()
    yield

app = FastAPI(title="May Progulka API", lifespan=lifespan)

api_router = APIRouter(prefix="/api/v1")
# Регистрация роутов FastAPI Users
api_router.include_router(auth_router)
api_router.include_router(participants_router)
api_router.include_router(routes_router)

app.include_router(api_router)