from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException
import uuid

from database.models import Participant, Route, Map
from mayprogulka.models.typist import (
    PaperFormRequest,
    PaperFormResponse,
    MatchRequest,
    MatchResponse,
    UnlinkedMapResponse,
)


def generate_form_id() -> str:
    """Генерация уникального номера анкеты."""
    # Формат: MP2026-XXXXXX (где XXXXXX — случайные цифры)
    unique_part = str(uuid.uuid4().int)[:6].zfill(6)
    return f"MP2026-{unique_part}"


class TypistService:
    
    @staticmethod
    async def create_from_paper_form(
        db: AsyncSession,
        data: PaperFormRequest
    ) -> PaperFormResponse:
        """
        Создание участника с бумажной анкеты на старте.
        Участник сразу создаётся с payment_status="paid".
        """
        # Проверяем, что маршрут существует и активен
        result = await db.execute(
            select(Route).where(Route.id == data.route_id)
        )
        route = result.scalar_one_or_none()
        
        if not route:
            raise HTTPException(status_code=404, detail="Маршрут не найден")
        
        if not route.is_active:
            raise HTTPException(status_code=400, detail="Маршрут не активен")
        
        # Генерируем уникальный form_id
        form_id = generate_form_id()
        
        # Создаём участника с оплаченным статусом
        participant = Participant(
            user_id=0,  # Временный пользователь для бумажных анкет
            route_id=data.route_id,
            form_id=form_id,
            surname=data.surname,
            name=data.name,
            middle_name=data.middle_name,
            date_of_birth=data.date_of_birth,
            gender=data.gender,
            phone_number=data.phone_number,
            email=data.email,
            payment_status="paid",  # Сразу оплачено!
            has_started=False,
            has_finished=False,
        )
        
        db.add(participant)
        await db.commit()
        await db.refresh(participant)
        
        return PaperFormResponse(
            participant_id=participant.id,
            form_id=form_id,
            payment_status="paid",
        )
    
    @staticmethod
    async def match_map_to_participant(
        db: AsyncSession,
        data: MatchRequest
    ) -> MatchResponse:
        """
        Сопоставление карты с участником по номеру анкеты (form_id).
        Это ключевая операция: связывает физическую карту (barcode) с участником.
        """
        # 1. Ищем карту по barcode
        result = await db.execute(
            select(Map).where(Map.barcode == data.barcode)
        )
        map_obj = result.scalar_one_or_none()
        
        if not map_obj:
            raise HTTPException(status_code=404, detail="Карта не найдена")
        
        # 2. Проверяем, не привязана ли уже карта
        if map_obj.participant_id is not None:
            raise HTTPException(
                status_code=400,
                detail=f"Карта уже привязана к участнику с id {map_obj.participant_id}"
            )
        
        # 3. Ищем участника по номеру анкеты (form_id)
        result = await db.execute(
            select(Participant).where(Participant.form_id == data.form_id)
        )
        participant = result.scalar_one_or_none()
        
        if not participant:
            raise HTTPException(
                status_code=404,
                detail=f"Участник с номером анкеты '{data.form_id}' не найден"
            )
        
        # 4. Привязываем карту к участнику
        map_obj.participant_id = participant.id
        await db.commit()
        await db.refresh(map_obj)
        
        # Конвертируем в формат для typist
        return MatchResponse(
            status="match",
            barcode=data.barcode,
            participant_id=participant.id,
            participant_name=participant.name,
            message="Карта привязана к анкете!",
        )

    @staticmethod
    async def get_unlinked_maps(
        db: AsyncSession,
        limit: int = 100
    ) -> list[UnlinkedMapResponse]:
        """
        Получение списка непривязанных карт.
        """
        result = await db.execute(
            select(Map)
            .where(Map.participant_id.is_(None))
            .limit(limit)
        )
        maps = result.scalars().all()
        
        # Конвертируем в формат для typist
        return [
            UnlinkedMapResponse(
                id=m.id,
                barcode=m.barcode,
                participant_id=m.participant_id
            )
            for m in maps
        ]