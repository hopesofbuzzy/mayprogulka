from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.database import get_db
from mayprogulka.database.models import User
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
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Создать карту (participant_id опционален). Только администратор."""
    return await MapService.create(db, data)


@router.post("/batch", response_model=BatchMapResponse, status_code=201)
async def create_maps_batch(
    data: BatchMapCreateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Массовое создание карт (только barcode, без привязки). Только администратор."""
    return await MapService.create_batch(db, data)


@router.get("/{barcode}", response_model=MapInfoResponse)
async def get_map_info(
    barcode: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Получить информацию о карте. Только администратор."""
    return await MapService.get_by_barcode(db, barcode)
