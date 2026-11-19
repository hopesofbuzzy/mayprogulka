from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.database import get_db
from mayprogulka.database.models import User
from mayprogulka.models.marker import MarkerAssignmentsResponse
from mayprogulka.routes.v1.auth.service import require_marker
from .service import MarkerService

router = APIRouter(prefix="/marker", tags=["marker"])


@router.get("/assignments", response_model=MarkerAssignmentsResponse)
async def get_my_assignments(
    current_user: User = Depends(require_marker),
    db: AsyncSession = Depends(get_db),
):
    """
    Контрольные пункты и маршруты, назначенные текущему маркеру.

    Маркер видит только свои КП и не имеет доступа к общей статистике.
    """
    return await MarkerService.get_assignments(db, current_user.id)
