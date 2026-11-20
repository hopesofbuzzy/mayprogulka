from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.database import get_db
from mayprogulka.database.models import User
from mayprogulka.routes.v1.auth.service import require_typist
from mayprogulka.models.typist import (
    PaperFormRequest,
    PaperFormResponse,
    PaperFormUpdateRequest,
    MatchRequest,
    MatchResponse,
    UnlinkedMapListResponse,
)
from .service import TypistService

router = APIRouter(prefix="/typist", tags=["typist"])


@router.post(
    "/paper-form",
    response_model=PaperFormResponse,
    status_code=201,
    openapi_extra={"x-roles": ["typist", "admin"]},
)
async def create_from_paper_form(
    data: PaperFormRequest,
    current_user: User = Depends(require_typist),
    db: AsyncSession = Depends(get_db),
):
    """
    Ввод данных с бумажной анкеты на старте.
    Создаёт участника с payment_status="paid" сразу.
    """
    return await TypistService.create_from_paper_form(db, data)


@router.put(
    "/paper-form/{participant_id}",
    response_model=PaperFormResponse,
    openapi_extra={"x-roles": ["typist", "admin"]},
)
async def update_paper_form(
    participant_id: int,
    data: PaperFormUpdateRequest,
    current_user: User = Depends(require_typist),
    db: AsyncSession = Depends(get_db),
):
    """Правка бумажной анкеты до старта (после старта — 409)."""
    return await TypistService.update_paper_form(db, participant_id, data)


@router.post(
    "/match",
    response_model=MatchResponse,
    openapi_extra={"x-roles": ["typist", "admin"]},
)
async def match_map_to_participant(
    data: MatchRequest,
    current_user: User = Depends(require_typist),
    db: AsyncSession = Depends(get_db),
):
    """
    Сопоставление карты с участником по номеру анкеты.
    Связывает barcode карты с form_id участника.
    """
    return await TypistService.match_map_to_participant(db, data)


@router.get(
    "/unlinked",
    response_model=UnlinkedMapListResponse,
    openapi_extra={"x-roles": ["typist", "admin"]},
)
async def get_unlinked_maps(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_typist),
    db: AsyncSession = Depends(get_db),
):
    """
    Получение списка непривязанных карт.
    Показывает карты, которые ещё не сопоставлены с участниками.
    """
    maps, total = await TypistService.get_unlinked_maps(db, limit, offset)
    return UnlinkedMapListResponse(
        maps=maps,
        total=total,
        limit=limit,
        offset=offset,
    )
