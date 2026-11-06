from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db
from mayprogulka.routes.v1.auth.service import require_admin
from mayprogulka.models.maps import (
    MapCreateRequest,
    MapResponse,
    MapListResponse,
    BatchMapCreateRequest,
    BatchMapResponse,
    MapMatchRequest,
    MapMatchResponse,
    MapInfoResponse,
)
from .service import MapService

router = APIRouter(prefix="/admin/maps", tags=["admin", "maps"])


@router.post("", response_model=MapResponse, status_code=201)
async def create_map(
    data: MapCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Создать карту (participant_id опционален)."""
    return await MapService.create(db, data)


@router.post("/batch", response_model=BatchMapResponse, status_code=201)
async def create_maps_batch(
    data: BatchMapCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Массовое создание карт (только barcode, без привязки)."""
    return await MapService.create_batch(db, data)


@router.get("/{barcode}", response_model=MapInfoResponse)
async def get_map_info(
    barcode: str,
    db: AsyncSession = Depends(get_db),
):
    """Получить информацию о карте (работает даже если не привязана)."""
    return await MapService.get_by_barcode(db, barcode)
