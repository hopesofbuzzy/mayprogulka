from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import uuid

from database.database import get_db
from database.models import User, Participant, Route
from mayprogulka.models.participants import (
    ParticipantRegisterRequest,
    ParticipantRegisterResponse,
    ParticipantItem,
    ParticipantListResponse,
    ParticipantListItem,
    PaymentRequest,
    PaymentResponse,
)
from mayprogulka.routes.v1.auth.service import get_current_user, require_admin

router = APIRouter(prefix="/participants", tags=["participants"])


def generate_form_id() -> str:
    """Генерация уникального номера анкеты."""
    # Формат: MP2026-XXXXXX (где XXXXXX — случайные цифры)
    unique_part = str(uuid.uuid4().int)[:6].zfill(6)
    return f"MP2026-{unique_part}"


@router.post("/register", response_model=ParticipantRegisterResponse, status_code=201)
async def register_participants(
    data: ParticipantRegisterRequest,
    current_user: User = Depends(get_current_user),
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


@router.get("/my", response_model=ParticipantListResponse)
async def get_my_participants(
    route_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Получить список своих участников."""
    
    # Строим запрос с JOIN на Route для получения названия маршрута
    query = (
        select(Participant, Route.name.label("route_name"))
        .join(Route, Participant.route_id == Route.id)
        .options(selectinload(Participant.maps))
        .where(Participant.user_id == current_user.id)
    )
    
    if route_id:
        query = query.where(Participant.route_id == route_id)
    
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
    
    return ParticipantListResponse(participants=participants)


@router.post("/{participant_id}/pay", response_model=PaymentResponse)
async def pay_for_participant(
    participant_id: int,
    data: PaymentRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Оплата участия.
    
    ЗАГЛУШКА: В реальном проекте здесь будет интеграция с платежным шлюзом.
    Сейчас просто меняем статус на "paid" и возвращаем успех.
    """
    
    # 1. Находим участника
    result = await db.execute(
        select(Participant).where(
            Participant.id == participant_id,
            Participant.user_id == current_user.id  # Только свои участники
        )
    )
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