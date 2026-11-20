from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.database import get_db
from mayprogulka.database.models import User
from mayprogulka.models.marker import MarkerAssignmentsResponse
from mayprogulka.routes.v1.auth.service import require_marker
from .service import MarkerService

router = APIRouter(prefix="/marker", tags=["marker"])


@router.get(
    "/checkpoints",
    response_model=MarkerAssignmentsResponse,
    openapi_extra={"x-roles": ["marker", "organizer", "admin"]},
)
@router.get(
    "/assignments",
    response_model=MarkerAssignmentsResponse,
    include_in_schema=False,
    openapi_extra={"x-roles": ["marker", "organizer", "admin"]},
)
async def get_my_checkpoints(
    route_id: int | None = Query(default=None),
    current_user: User = Depends(require_marker),
    db: AsyncSession = Depends(get_db),
):
    """
    Контрольные пункты, доступные текущему пользователю.

    Маркер видит только назначенные ему КП; организатор и администратор —
    все КП. Необязательный ``route_id`` ограничивает список маршрутом.
    """
    return await MarkerService.list_checkpoints(
        db,
        current_user,
        route_id=route_id,
    )
