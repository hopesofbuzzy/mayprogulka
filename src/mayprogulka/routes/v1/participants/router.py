from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
import uuid

from mayprogulka.database.database import get_db
from mayprogulka.database.models import User, Participant, Route, Checkpoint, CheckpointPass, CheckpointPositions
from mayprogulka.database.enums import Role, role_value
from mayprogulka.models.participants import (
    ParticipantDetail,
    ParticipantRegisterRequest,
    ParticipantRegisterResponse,
    ParticipantItem,
    ParticipantListResponse,
    ParticipantListItem,
    ParticipantPassItem,
    ParticipantPassListResponse,
    ParticipantUpdateRequest,
    PaymentRequest,
    PaymentResponse,
)
from mayprogulka.routes.v1.auth.service import require_role, require_user
from mayprogulka.utils.form_id import generate_form_id

router = APIRouter(prefix="/participants", tags=["participants"])

# Карточку участника видят владелец, организатор и администратор.
require_participant_viewer = require_role(Role.USER, Role.ORGANIZER)


def _is_admin(user: User) -> bool:
    return role_value(user.role) == Role.ADMIN.value


def _is_staff_viewer(user: User) -> bool:
    """Организатор и администратор видят карточку любого участника."""

    return role_value(user.role) in {Role.ADMIN.value, Role.ORGANIZER.value}


def _form_pdf_url(participant: Participant) -> str | None:
    """PDF-анкета доступна только после оплаты.

    TODO: перегенерировать PDF при изменении анкеты после оплаты.
    """

    if participant.payment_status != "paid":
        return None
    return f"https://mayprogulka.ru/forms/{participant.form_id}.pdf"


@router.post(
    "/register",
    response_model=ParticipantRegisterResponse,
    status_code=201,
    openapi_extra={"x-roles": ["user", "admin"]},
)
async def register_participants(
    data: ParticipantRegisterRequest,
    current_user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Регистрация участника(ов) на мероприятие."""
    # 0. Создаем участников
    created_participants = []
    for participant_data in data.participants:
        # 1. Проверяем, что маршрут существует
        result = await db.execute(select(Route).where(Route.id == participant_data.route_id))
        route = result.scalar_one_or_none()
        if not route:
            raise HTTPException(status_code=404, detail="Маршрут не найден")
        # 2. Добавляем участника
        participant = Participant(
            **participant_data.model_dump(),  # Все поля из запроса
            user_id=current_user.id,          # Переопределяем/добавляем
            form_id=generate_form_id(),
            payment_status="unpaid",
        )
        db.add(participant)
        created_participants.append(participant)
    
    await db.commit()
    
    # 3. Обновляем, чтобы получить ID
    for participant in created_participants:
        await db.refresh(participant)
    
    # 4. Формируем ответ
    response_participants = [
        ParticipantItem(
            id=p.id,
            form_id=p.form_id,
            surname=p.surname,
            name=p.name,
            payment_status=p.payment_status,
        )
        for p in created_participants
    ]
    
    return ParticipantRegisterResponse(
        registration_id=created_participants[0].id,  # ID первого участника как ID регистрации
        participants=response_participants,
    )


@router.get(
    "/my",
    response_model=ParticipantListResponse,
    openapi_extra={"x-roles": ["user", "admin"]},
)
async def get_my_participants(
    route_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Получить список своих участников (с пагинацией)."""

    conditions = [Participant.user_id == current_user.id]
    if route_id:
        conditions.append(Participant.route_id == route_id)

    total = (
        await db.execute(
            select(func.count(Participant.id)).where(*conditions)
        )
    ).scalar_one()

    # Строим запрос с JOIN на Route для получения названия маршрута
    query = (
        select(Participant, Route.name.label("route_name"))
        .join(Route, Participant.route_id == Route.id)
        .options(selectinload(Participant.maps))
        .where(*conditions)
        .order_by(Participant.id)
        .limit(limit)
        .offset(offset)
    )

    result = await db.execute(query)
    rows = result.all()

    participants = []
    for participant, route_name in rows:
        # Получаем barcode карты (если есть)
        map_barcode = None
        if participant.maps:
            map_barcode = participant.maps[0].barcode

        participants.append(
            ParticipantListItem(
                id=participant.id,
                form_id=str(participant.form_id),
                surname=participant.surname,
                name=participant.name,
                route_name=route_name,
                payment_status=participant.payment_status,
                has_started=participant.has_started,
                has_finished=participant.has_finished,
                map_barcode=map_barcode,
            )
        )

    return ParticipantListResponse(
        participants=participants,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{participant_id}",
    response_model=ParticipantDetail,
    openapi_extra={"x-roles": ["user", "organizer", "admin"]},
)
async def get_participant(
    participant_id: int,
    current_user: User = Depends(require_participant_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Карточка участника.

    Владелец видит свою запись, организатор и администратор — любую.
    Чужая запись для обычного пользователя — 403.
    """

    result = await db.execute(
        select(Participant, Route.name)
        .join(Route, Participant.route_id == Route.id)
        .options(selectinload(Participant.maps))
        .where(Participant.id == participant_id)
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Участник не найден")

    participant, route_name = row
    if participant.user_id != current_user.id and not _is_staff_viewer(current_user):
        raise HTTPException(status_code=403, detail="Это чужая запись участника")

    return ParticipantDetail(
        id=participant.id,
        form_id=participant.form_id,
        user_id=participant.user_id,
        route_id=participant.route_id,
        route_name=route_name,
        surname=participant.surname,
        name=participant.name,
        middle_name=participant.middle_name,
        date_of_birth=participant.date_of_birth,
        gender=participant.gender,
        phone_number=participant.phone_number,
        email=participant.email,
        payment_status=participant.payment_status,
        has_started=participant.has_started,
        has_finished=participant.has_finished,
        started_at=participant.started_at,
        finished_at=participant.finished_at,
        map_barcode=participant.maps[0].barcode if participant.maps else None,
        form_pdf_url=_form_pdf_url(participant),
    )


@router.put(
    "/{participant_id}",
    response_model=ParticipantDetail,
    openapi_extra={"x-roles": ["user", "admin"]},
)
async def update_participant(
    participant_id: int,
    data: ParticipantUpdateRequest,
    current_user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Правка анкеты владельцем или администратором.

    После старта правка запрещена (409).
    """

    result = await db.execute(
        select(Participant)
        .options(selectinload(Participant.maps))
        .where(Participant.id == participant_id)
    )
    participant = result.scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=404, detail="Участник не найден")

    if participant.user_id != current_user.id and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Это чужая запись участника")

    if participant.has_started:
        raise HTTPException(
            status_code=409,
            detail="После старта анкету изменить нельзя",
        )

    update_data = data.model_dump(exclude_unset=True)
    if "route_id" in update_data and update_data["route_id"] is not None:
        route = (
            await db.execute(select(Route).where(Route.id == update_data["route_id"]))
        ).scalar_one_or_none()
        if route is None:
            raise HTTPException(status_code=404, detail="Маршрут не найден")

    for field, value in update_data.items():
        setattr(participant, field, value)

    await db.commit()
    await db.refresh(participant)

    route_name = (
        await db.execute(select(Route.name).where(Route.id == participant.route_id))
    ).scalar_one()

    # TODO: перегенерировать PDF-анкету, если она уже была выдана.
    return ParticipantDetail(
        id=participant.id,
        form_id=participant.form_id,
        user_id=participant.user_id,
        route_id=participant.route_id,
        route_name=route_name,
        surname=participant.surname,
        name=participant.name,
        middle_name=participant.middle_name,
        date_of_birth=participant.date_of_birth,
        gender=participant.gender,
        phone_number=participant.phone_number,
        email=participant.email,
        payment_status=participant.payment_status,
        has_started=participant.has_started,
        has_finished=participant.has_finished,
        started_at=participant.started_at,
        finished_at=participant.finished_at,
        map_barcode=participant.maps[0].barcode if participant.maps else None,
        form_pdf_url=_form_pdf_url(participant),
    )


@router.get(
    "/{participant_id}/passes",
    response_model=ParticipantPassListResponse,
    openapi_extra={"x-roles": ["user", "admin"]},
)
async def get_my_participant_passes(
    participant_id: int,
    current_user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Отметки о прохождении КП для своей записи участника.

    Участник видит только свои отметки. Администратор видит любые.
    """
    result = await db.execute(
        select(Participant).where(Participant.id == participant_id)
    )
    participant = result.scalar_one_or_none()

    is_admin = role_value(current_user.role) == Role.ADMIN.value
    if participant is None or (
        participant.user_id != current_user.id and not is_admin
    ):
        raise HTTPException(status_code=404, detail="Участник не найден")

    result = await db.execute(
        select(CheckpointPass, Checkpoint, CheckpointPositions.position)
        .join(Checkpoint, CheckpointPass.checkpoint_id == Checkpoint.id)
        .join(
            CheckpointPositions,
            (CheckpointPositions.checkpoint_id == Checkpoint.id)
            & (CheckpointPositions.route_id == participant.route_id),
        )
        .where(CheckpointPass.participant_id == participant.id)
        .order_by(CheckpointPass.passed_at)
    )

    return ParticipantPassListResponse(
        participant_id=participant.id,
        passes=[
            ParticipantPassItem(
                checkpoint_id=checkpoint.id,
                checkpoint_name=checkpoint.name,
                position=position,
                route_id=checkpoint.route_id,
                address=checkpoint.address,
                passed_at=checkpoint_pass.passed_at,
            )
            for checkpoint_pass, checkpoint, position in result.all()
        ],
    )


@router.post(
    "/{participant_id}/pay",
    response_model=PaymentResponse,
    openapi_extra={"x-roles": ["user", "admin"]},
)
async def pay_for_participant(
    participant_id: int,
    data: PaymentRequest,
    current_user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Оплата участия.
    
    ЗАГЛУШКА: В реальном проекте здесь будет интеграция с платежным шлюзом.
    Сейчас просто меняем статус на "paid" и возвращаем успех.
    """
    
    # 1. Находим участника. Администратор может оплатить любую запись.
    conditions = [Participant.id == participant_id]
    if not _is_admin(current_user):
        conditions.append(Participant.user_id == current_user.id)
    result = await db.execute(select(Participant).where(*conditions))
    participant = result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Участник не найден")
    
    if participant.payment_status == "paid":
        raise HTTPException(status_code=400, detail="Участие уже оплачено")
    
    # 2. Имитация платежа (ЗАГЛУШКА)
    # В реальности здесь:
    # - Создание платежа в ЮKassa/Тинькофф/Stripe
    # - Получение ссылки на оплату
    # - Ожидание подтверждения
    
    payment_id = f"pay_{uuid.uuid4().hex[:12]}"
    
    # 3. Меняем статус (в реальности это произойдет после подтверждения платежа)
    participant.payment_status = "paid"
    await db.commit()
    
    # 4. Генерация PDF-анкеты (ЗАГЛУШКА)
    # В реальности здесь генерация PDF с штрих-кодом
    form_pdf_url = f"https://mayprogulka.ru/forms/{participant.form_id}.pdf"
    
    return PaymentResponse(
        status="success",
        payment_id=payment_id,
        form_pdf_url=form_pdf_url,
    )