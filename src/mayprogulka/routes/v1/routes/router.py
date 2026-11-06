from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db
from database.models import User
from mayprogulka.routes.v1.auth.service import require_admin
from mayprogulka.models.routes import (
    RouteCreateRequest,
    RouteUpdateRequest,
    RouteResponse,
    RouteListResponse,
    MapUploadResponse,
)
from .service import RouteService

router = APIRouter(tags=["routes"])


# ==================== ПУБЛИЧНЫЕ ЭНДПОИНТЫ ====================

@router.get("/routes", response_model=RouteListResponse)
async def get_routes(db: AsyncSession = Depends(get_db)):
    """Получить список всех доступных маршрутов."""
    routes = await RouteService.get_all_routes(db)
    return RouteListResponse(routes=[
            RouteResponse.model_validate(route, from_attributes=True)
            for route in routes
        ])

# ==================== АДМИНСКИЕ ЭНДПОИНТЫ ====================

@router.post(
    "/admin/routes",
    response_model=RouteResponse,
    status_code=201,
    tags=["admin"],
)
async def create_route(
    data: RouteCreateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Создать новый маршрут (только для админов)."""
    route = await RouteService.create_route(
        db=db,
        year=data.year,
        name=data.name,
        distance=data.distance,
        description=data.description,
        is_active=data.is_active,
    )
    return route


@router.put(
    "/admin/routes/{route_id}",
    response_model=RouteResponse,
    tags=["admin"],
)
async def update_route(
    route_id: int,
    data: RouteUpdateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Обновить данные маршрута (только для админов)."""
    update_data = data.model_dump(exclude_unset=True)
    route = await RouteService.update_route(db, route_id, update_data)
    return route


@router.delete(
    "/admin/routes/{route_id}",
    status_code=204,
    tags=["admin"],
)
async def delete_route(
    route_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Удалить или архивировать маршрут (только для админов)."""
    await RouteService.delete_route(db, route_id)
    return None


@router.post(
    "/routes/{route_id}/map",
    response_model=MapUploadResponse,
)
async def upload_route_map(
    route_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Загрузить файл карты маршрута."""
    map_url = await RouteService.upload_map_file(db, route_id, file)
    return MapUploadResponse(map_url=map_url)