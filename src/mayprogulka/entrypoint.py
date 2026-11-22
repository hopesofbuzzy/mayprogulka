from fastapi import FastAPI, APIRouter
from mayprogulka.routes.v1.auth.router import router as auth_router
from mayprogulka.routes.v1.participants.router import router as participants_router
from mayprogulka.routes.v1.routes.router import router as routes_router
from mayprogulka.routes.v1.checkpoints.router import router as checkpoints_router
from mayprogulka.routes.v1.maps.router import router as maps_router
from mayprogulka.routes.v1.typist.router import router as typist_router
from mayprogulka.routes.v1.scans.router import router as scans_router
from mayprogulka.routes.v1.users.router import router as users_router
from mayprogulka.routes.v1.registrar.router import router as registrar_router
from mayprogulka.routes.v1.marker.router import router as marker_router
from mayprogulka.routes.v1.organizer.router import router as organizer_router
from contextlib import asynccontextmanager
from fastapi.openapi.utils import get_openapi
from mayprogulka.database.database import create_db, create_default_admin
from mayprogulka.openapi_contract import augment_openapi

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
api_router.include_router(checkpoints_router)
api_router.include_router(maps_router)
api_router.include_router(typist_router)
api_router.include_router(scans_router)
api_router.include_router(users_router)
api_router.include_router(registrar_router)
api_router.include_router(marker_router)
api_router.include_router(organizer_router)

app.include_router(api_router)


def custom_openapi() -> dict:
    """Собрать OpenAPI и дополнить его RBAC-контрактом."""

    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        routes=app.routes,
    )
    app.openapi_schema = augment_openapi(schema)
    return app.openapi_schema


app.openapi = custom_openapi