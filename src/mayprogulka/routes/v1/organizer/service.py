from fastapi import HTTPException
from sqlalchemy import case, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from mayprogulka.database.models import (
    Checkpoint,
    CheckpointPass,
    Participant,
    Route,
)
from mayprogulka.models.organizer import (
    CheckpointStats,
    EventStatsResponse,
    OrganizerParticipantItem,
    OrganizerParticipantListResponse,
    RouteStats,
    StatsTotals,
)


class OrganizerService:

    @staticmethod
    async def get_stats(
        db: AsyncSession,
        route_id: int | None = None,
    ) -> EventStatsResponse:
        """Сводная статистика мероприятия (только для организатора/админа)."""
        if route_id is not None:
            route_result = await db.execute(
                select(Route.id).where(Route.id == route_id)
            )
            if route_result.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail="Маршрут не найден")

        routes_query = (
            select(
                Route.id,
                Route.name,
                func.count(Participant.id),
                func.coalesce(
                    func.sum(case((Participant.payment_status == "paid", 1), else_=0)),
                    0,
                ),
                func.coalesce(
                    func.sum(case((Participant.has_started.is_(True), 1), else_=0)),
                    0,
                ),
                func.coalesce(
                    func.sum(case((Participant.has_finished.is_(True), 1), else_=0)),
                    0,
                ),
            )
            .outerjoin(Participant, Participant.route_id == Route.id)
            .group_by(Route.id, Route.name)
            .order_by(Route.year.desc(), Route.name)
        )
        if route_id is not None:
            routes_query = routes_query.where(Route.id == route_id)

        rows = (await db.execute(routes_query)).all()
        route_stats: list[RouteStats] = []
        for current_route_id, route_name, registered, paid, started, finished in rows:
            started = int(started)
            finished = int(finished)
            route_stats.append(
                RouteStats(
                    route_id=current_route_id,
                    route_name=route_name,
                    registered=int(registered),
                    paid=int(paid),
                    started=started,
                    finished=finished,
                    on_route=max(started - finished, 0),
                )
            )

        totals = StatsTotals(
            registered=sum(item.registered for item in route_stats),
            paid=sum(item.paid for item in route_stats),
            started=sum(item.started for item in route_stats),
            finished=sum(item.finished for item in route_stats),
            on_route=sum(item.on_route for item in route_stats),
        )

        checkpoints_query = (
            select(
                Checkpoint.id,
                Checkpoint.route_id,
                Route.name,
                Checkpoint.name,
                Checkpoint.order,
                func.count(distinct(CheckpointPass.participant_id)),
            )
            .join(Route, Checkpoint.route_id == Route.id)
            .outerjoin(CheckpointPass, CheckpointPass.checkpoint_id == Checkpoint.id)
            .group_by(
                Checkpoint.id,
                Checkpoint.route_id,
                Route.name,
                Checkpoint.name,
                Checkpoint.order,
            )
            .order_by(Route.name, Checkpoint.order)
        )
        if route_id is not None:
            checkpoints_query = checkpoints_query.where(Checkpoint.route_id == route_id)

        checkpoint_rows = (await db.execute(checkpoints_query)).all()
        checkpoints = [
            CheckpointStats(
                checkpoint_id=checkpoint_id,
                route_id=current_route_id,
                route_name=route_name,
                name=checkpoint_name,
                order=order,
                passed=int(passed),
            )
            for checkpoint_id, current_route_id, route_name, checkpoint_name, order, passed
            in checkpoint_rows
        ]

        return EventStatsResponse(
            totals=totals,
            routes=route_stats,
            checkpoints=checkpoints,
        )

    @staticmethod
    async def list_participants(
        db: AsyncSession,
        route_id: int | None = None,
        payment_status: str | None = None,
        has_started: bool | None = None,
        has_finished: bool | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> OrganizerParticipantListResponse:
        """Список участников с фильтрами — для организатора мероприятия."""
        conditions = []
        if route_id is not None:
            conditions.append(Participant.route_id == route_id)
        if payment_status is not None:
            conditions.append(Participant.payment_status == payment_status)
        if has_started is not None:
            conditions.append(Participant.has_started.is_(has_started))
        if has_finished is not None:
            conditions.append(Participant.has_finished.is_(has_finished))
        if search:
            pattern = f"%{search.strip()}%"
            conditions.append(
                or_(
                    Participant.form_id.ilike(pattern),
                    Participant.surname.ilike(pattern),
                    Participant.name.ilike(pattern),
                    Participant.phone_number.ilike(pattern),
                    Participant.email.ilike(pattern),
                )
            )

        count_query = select(func.count(Participant.id))
        data_query = (
            select(Participant, Route.name)
            .join(Route, Participant.route_id == Route.id)
            .options(selectinload(Participant.maps))
        )
        for condition in conditions:
            count_query = count_query.where(condition)
            data_query = data_query.where(condition)

        total = (await db.execute(count_query)).scalar_one()
        result = await db.execute(
            data_query.order_by(Participant.surname, Participant.name)
            .limit(limit)
            .offset(offset)
        )

        return OrganizerParticipantListResponse(
            participants=[
                OrganizerParticipantItem(
                    participant_id=participant.id,
                    form_id=participant.form_id,
                    surname=participant.surname,
                    name=participant.name,
                    middle_name=participant.middle_name,
                    route_id=participant.route_id,
                    route_name=route_name,
                    payment_status=participant.payment_status,
                    has_started=participant.has_started,
                    has_finished=participant.has_finished,
                    map_barcode=participant.maps[0].barcode if participant.maps else None,
                    user_id=participant.user_id,
                    phone_number=participant.phone_number,
                    email=participant.email,
                )
                for participant, route_name in result.all()
            ],
            total=total,
            limit=limit,
            offset=offset,
        )
