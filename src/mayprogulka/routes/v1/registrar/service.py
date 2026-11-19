from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from mayprogulka.database.models import Participant, Route
from mayprogulka.models.registrar import RegistrarFormItem, RegistrarFormListResponse


class RegistrarService:

    @staticmethod
    def _to_item(participant: Participant, route: Route) -> RegistrarFormItem:
        return RegistrarFormItem(
            participant_id=participant.id,
            form_id=participant.form_id,
            surname=participant.surname,
            name=participant.name,
            middle_name=participant.middle_name,
            date_of_birth=participant.date_of_birth,
            gender=participant.gender,
            phone_number=participant.phone_number,
            email=participant.email,
            route_id=route.id,
            route_name=route.name,
            route_year=route.year,
            payment_status=participant.payment_status,
            has_started=participant.has_started,
            has_finished=participant.has_finished,
            map_barcode=participant.maps[0].barcode if participant.maps else None,
        )

    @staticmethod
    async def get_by_form_id(
        db: AsyncSession,
        form_id: str,
    ) -> RegistrarFormItem:
        """Найти анкету по её номеру. Регистратор только читает данные."""
        result = await db.execute(
            select(Participant, Route)
            .join(Route, Participant.route_id == Route.id)
            .options(selectinload(Participant.maps))
            .where(Participant.form_id == form_id)
        )
        row = result.one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Анкета не найдена")
        participant, route = row
        return RegistrarService._to_item(participant, route)

    @staticmethod
    async def search(
        db: AsyncSession,
        query: str | None = None,
        route_id: int | None = None,
        limit: int = 50,
    ) -> RegistrarFormListResponse:
        """Поиск анкет на экране старта по номеру, ФИО, телефону или email."""
        conditions = []
        if query:
            pattern = f"%{query.strip()}%"
            conditions.append(
                or_(
                    Participant.form_id.ilike(pattern),
                    Participant.surname.ilike(pattern),
                    Participant.name.ilike(pattern),
                    Participant.phone_number.ilike(pattern),
                    Participant.email.ilike(pattern),
                )
            )
        if route_id is not None:
            conditions.append(Participant.route_id == route_id)

        count_query = select(func.count(Participant.id))
        data_query = (
            select(Participant, Route)
            .join(Route, Participant.route_id == Route.id)
            .options(selectinload(Participant.maps))
        )
        for condition in conditions:
            count_query = count_query.where(condition)
            data_query = data_query.where(condition)

        total = (await db.execute(count_query)).scalar_one()
        result = await db.execute(
            data_query.order_by(Participant.surname, Participant.name).limit(limit)
        )

        return RegistrarFormListResponse(
            forms=[
                RegistrarService._to_item(participant, route)
                for participant, route in result.all()
            ],
            total=total,
            limit=limit,
        )
