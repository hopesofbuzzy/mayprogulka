from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db
from database.models import User
from mayprogulka.routes.v1.auth.service import require_admin
from mayprogulka.models.checkpoints import (
    CheckpointCreateRequest,
    CheckpointUpdateRequest,
    CheckpointResponse,
    CheckpointListResponse,
    BatchCheckpointCreateRequest,
    BatchCheckpointResponse,
)
from mayprogulka.routes.v1.checkpoints.service import CheckpointService

router = APIRouter(tags=["checkpoints"])


# ==================== ПУБЛИЧНЫЕ ЭНДПОИНТЫ ====================

@router.get("/checkpoints", response_model=CheckpointListResponse)
async def get_checkpoints(
    route_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Получить список контрольных пунктов маршрута."""
    checkpoints = await CheckpointService.get_by_route(db, route_id)
    return CheckpointListResponse(checkpoints=checkpoints)


# ==================== АДМИНСКИЕ ЭНДПОИНТЫ ====================

@router.post(
    "/admin/checkpoints",
    response_model=CheckpointResponse,
    status_code=201,
    dependencies=[Depends(require_admin)],
)
async def create_checkpoint(
    data: CheckpointCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Создание нового контрольного пункта."""
    return await CheckpointService.create(db, data)


@router.put(
    "/admin/checkpoints/{checkpoint_id}",
    response_model=CheckpointResponse,
    dependencies=[Depends(require_admin)],
)
async def update_checkpoint(
    checkpoint_id: int,
    data: CheckpointUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Обновление данных контрольного пункта."""
    return await CheckpointService.update(db, checkpoint_id, data)


@router.delete(
    "/admin/checkpoints/{checkpoint_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
async def delete_checkpoint(
    checkpoint_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Удаление контрольного пункта (если нет отметок участников)."""
    await CheckpointService.delete(db, checkpoint_id)
    return None


@router.post(
    "/admin/checkpoints/batch",
    response_model=BatchCheckpointResponse,
    status_code=201,
    dependencies=[Depends(require_admin)],
)
async def create_checkpoints_batch(
    data: BatchCheckpointCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Массовое создание КП для маршрута."""
    return await CheckpointService.create_batch(db, data)