from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.database import get_db
from mayprogulka.database.models import User
from mayprogulka.models.registrar import (
    IssueCardRequest,
    IssueCardResponse,
    RegistrarFormItem,
    RegistrarFormListResponse,
)
from mayprogulka.routes.v1.auth.service import require_registrar
from .service import RegistrarService

router = APIRouter(prefix="/registrar", tags=["registrar"])


@router.get(
    "/search",
    response_model=RegistrarFormListResponse,
    openapi_extra={"x-roles": ["registrar", "organizer", "admin"]},
)
@router.get(
    "/forms",
    response_model=RegistrarFormListResponse,
    include_in_schema=False,
    openapi_extra={"x-roles": ["registrar", "organizer", "admin"]},
)
async def search_forms(
    query: str | None = Query(default=None, max_length=100),
    route_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_registrar),
    db: AsyncSession = Depends(get_db),
):
    """
    Поиск анкет на старте: по номеру анкеты, ФИО, телефону или email.

    Регистратор только читает данные и выдаёт карту. Изменять анкеты,
    выдавать карты в системе и видеть статистику он не может.
    """
    return await RegistrarService.search(
        db=db,
        query=query,
        route_id=route_id,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/issue-card",
    response_model=IssueCardResponse,
    openapi_extra={"x-roles": ["registrar", "organizer", "admin"]},
)
async def issue_card(
    data: IssueCardRequest,
    current_user: User = Depends(require_registrar),
    db: AsyncSession = Depends(get_db),
):
    """Выдать карту и стартовать участника (идемпотентно)."""
    return await RegistrarService.issue_card(
        db,
        form_id=data.form_id
    )


@router.get(
    "/forms/{form_id}",
    response_model=RegistrarFormItem,
    openapi_extra={"x-roles": ["registrar", "organizer", "admin"]},
)
async def get_form(
    form_id: str,
    current_user: User = Depends(require_registrar),
    db: AsyncSession = Depends(get_db),
):
    """Получить анкету по номеру (например, после сканирования штрих-кода)."""
    return await RegistrarService.get_by_form_id(db, form_id)
