from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.database import get_db
from mayprogulka.database.models import User
from mayprogulka.models.marker import (
    MarkerAssignmentUpdate,
    MarkerAssignmentsResponse,
    MarkerListResponse,
)
from mayprogulka.models.organizer import (
    EventStatsResponse,
    OrganizerParticipantListResponse,
)
from mayprogulka.routes.v1.auth.service import require_organizer
from mayprogulka.routes.v1.marker.service import MarkerService
from .service import OrganizerService

router = APIRouter(prefix="/organizer", tags=["organizer"])


@router.get("/stats", response_model=EventStatsResponse)
async def get_event_stats(
    route_id: int | None = None,
    current_user: User = Depends(require_organizer),
    db: AsyncSession = Depends(get_db),
):
    """
    Статистика мероприятия: зарегистрированы, оплатили, стартовали,
    финишировали, находятся на маршруте. Плюс разбивка по маршрутам и КП.
    """
    return await OrganizerService.get_stats(db, route_id=route_id)


@router.get("/participants", response_model=OrganizerParticipantListResponse)
async def list_participants(
    route_id: int | None = None,
    payment_status: str | None = Query(default=None, pattern="^(paid|unpaid)$"),
    has_started: bool | None = None,
    has_finished: bool | None = None,
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_organizer),
    db: AsyncSession = Depends(get_db),
):
    """Список участников с фильтрами — для организатора мероприятия."""
    return await OrganizerService.list_participants(
        db=db,
        route_id=route_id,
        payment_status=payment_status,
        has_started=has_started,
        has_finished=has_finished,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get("/markers", response_model=MarkerListResponse)
async def list_markers(
    current_user: User = Depends(require_organizer),
    db: AsyncSession = Depends(get_db),
):
    """Пользователи с ролью marker и количество назначенных им КП."""
    return await MarkerService.list_markers(db)


@router.get(
    "/markers/{marker_id}/assignments",
    response_model=MarkerAssignmentsResponse,
)
async def get_marker_assignments(
    marker_id: int,
    current_user: User = Depends(require_organizer),
    db: AsyncSession = Depends(get_db),
):
    """Какие КП назначены конкретному маркеру."""
    return await MarkerService.get_assignments(db, marker_id)


@router.put(
    "/markers/{marker_id}/assignments",
    response_model=MarkerAssignmentsResponse,
)
async def replace_marker_assignments(
    marker_id: int,
    data: MarkerAssignmentUpdate,
    current_user: User = Depends(require_organizer),
    db: AsyncSession = Depends(get_db),
):
    """
    Полностью заменить набор КП, назначенных маркеру.

    Организатор может назначить маркеру только существующие КП.
    Пользователь должен уже иметь роль marker.
    """
    return await MarkerService.replace_assignments(
        db,
        marker_id=marker_id,
        checkpoint_ids=data.checkpoint_ids,
    )
