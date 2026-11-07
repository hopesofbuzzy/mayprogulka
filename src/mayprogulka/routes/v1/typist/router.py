from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db
from database.models import User
from mayprogulka.routes.v1.auth.service import require_role
from mayprogulka.models.typist import (
    PaperFormRequest,
    PaperFormResponse,
    MatchRequest,
    MatchResponse,
    UnlinkedMapListResponse,
)
from .service import TypistService

router = APIRouter(prefix="/typist", tags=["typist"])


@router.post("/paper-form", response_model=PaperFormResponse, status_code=201)
async def create_from_paper_form(
    data: PaperFormRequest,
    current_user: User = Depends(require_role("typist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Ввод данных с бумажной анкеты на старте.
    Создаёт участника с payment_status="paid" сразу.
    """
    return await TypistService.create_from_paper_form(db, data)


@router.post("/match", response_model=MatchResponse)
async def match_map_to_participant(
    data: MatchRequest,
    current_user: User = Depends(require_role("typist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Сопоставление карты с участником по номеру анкеты.
    Связывает barcode карты с form_id участника.
    """
    return await TypistService.match_map_to_participant(db, data)


@router.get("/unlinked", response_model=UnlinkedMapListResponse)
async def get_unlinked_maps(
    limit: int = 100,
    current_user: User = Depends(require_role("typist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Получение списка непривязанных карт.
    Показывает карты, которые ещё не сопоставлены с участниками.
    """
    maps = await TypistService.get_unlinked_maps(db, limit)
    return UnlinkedMapListResponse(maps=maps)