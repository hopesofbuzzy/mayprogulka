from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import and_, case, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from mayprogulka.database.enums import Role
from mayprogulka.database.models import (
    Checkpoint,
    CheckpointAssignment,
    CheckpointPass,
    CheckpointPositions,
    Participant,
    Route,
    User,
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
        year: int | None = None,
    ) -> EventStatsResponse:
        """Сводная статистика мероприятия (организатор/админ).

        Totals считается одним агрегирующим запросом, разбивка по
        маршрутам — вторым. Циклов с запросами внутри нет.
        """
        if route_id is not None:
            route_result = await db.execute(
                select(Route.id).where(Route.id == route_id)
            )
            if route_result.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail="Маршрут не найден")

        participant_filters = []
        if route_id is not None:
            participant_filters.append(Participant.route_id == route_id)
        if year is not None:
            participant_filters.append(
                Participant.route_id.in_(select(Route.id).where(Route.year == year))
            )

        totals_row = (
            await db.execute(
                select(
                    func.count(Participant.id),
                    func.coalesce(
                        func.sum(
                            case((Participant.payment_status == "paid", 1), else_=0)
                        ),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case((Participant.has_started.is_(True), 1), else_=0)
                        ),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case((Participant.has_finished.is_(True), 1), else_=0)
                        ),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    and_(
                                        Participant.has_started.is_(True),
                                        Participant.has_finished.is_(False),
                                    ),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                ).where(*participant_filters)
            )
        ).one()
        registered, paid, started, finished, on_route = (int(value) for value in totals_row)

        totals = StatsTotals(
            registered=registered,
            paid=paid,
            started=started,
            finished=finished,
            on_route=on_route,
        )

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
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    Participant.has_started.is_(True),
                                    Participant.has_finished.is_(False),
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
            )
            .outerjoin(Participant, Participant.route_id == Route.id)
            .group_by(Route.id, Route.name, Route.year)
            .order_by(Route.year.desc(), Route.name)
        )
        if route_id is not None:
            routes_query = routes_query.where(Route.id == route_id)
        if year is not None:
            routes_query = routes_query.where(Route.year == year)

        rows = (await db.execute(routes_query)).all()
        route_stats = [
            RouteStats(
                route_id=current_route_id,
                route_name=route_name,
                registered=int(registered),
                paid=int(paid),
                started=int(started),
                finished=int(finished),
                on_route=int(on_route),
            )
            for (
                current_route_id,
                route_name,
                registered,
                paid,
                started,
                finished,
                on_route,
            ) in rows
        ]

        checkpoints_query = (
            select(
                Checkpoint.id,
                Checkpoint.route_id,
                Route.name,
                Checkpoint.name,
                CheckpointPositions.position,
                func.count(distinct(CheckpointPass.participant_id)),
            )
            .join(Route, Checkpoint.route_id == Route.id)
            .join(
                CheckpointPositions,
                and_(
                    CheckpointPositions.checkpoint_id == Checkpoint.id,
                    CheckpointPositions.route_id == Checkpoint.route_id,
                ),
            )
            .outerjoin(CheckpointPass, CheckpointPass.checkpoint_id == Checkpoint.id)
            .group_by(
                Checkpoint.id,
                Checkpoint.route_id,
                Route.name,
                Checkpoint.name,
                CheckpointPositions.position,
            )
            .order_by(Route.name, CheckpointPositions.position)
        )
        if route_id is not None:
            checkpoints_query = checkpoints_query.where(Checkpoint.route_id == route_id)
        if year is not None:
            checkpoints_query = checkpoints_query.where(Route.year == year)

        checkpoint_rows = (await db.execute(checkpoints_query)).all()
        checkpoints = [
            CheckpointStats(
                checkpoint_id=checkpoint_id,
                route_id=current_route_id,
                route_name=route_name,
                name=checkpoint_name,
                position=position,
                passed=int(passed),
            )
            for checkpoint_id, current_route_id, route_name, checkpoint_name, position, passed
            in checkpoint_rows
        ]

        return EventStatsResponse(
            totals=totals,
            routes=route_stats,
            checkpoints=checkpoints,
        )

    @staticmethod
    async def assign_checkpoint(
        db: AsyncSession,
        checkpoint_id: int,
        user_id: int,
    ) -> dict:
        """Назначить маркера на КП. 404/422/409 по правилам."""
        checkpoint = (
            await db.execute(select(Checkpoint.id).where(Checkpoint.id == checkpoint_id))
        ).scalar_one_or_none()
        if checkpoint is None:
            raise HTTPException(status_code=404, detail="Контрольный пункт не найден")

        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        if user.role != Role.MARKER.value:
            raise HTTPException(
                status_code=422,
                detail="Назначать на КП можно только пользователя с ролью marker",
            )

        existing = (
            await db.execute(
                select(CheckpointAssignment.id).where(
                    CheckpointAssignment.checkpoint_id == checkpoint_id,
                    CheckpointAssignment.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail="Маркер уже назначен на этот контрольный пункт",
            )

        assignment = CheckpointAssignment(
            checkpoint_id=checkpoint_id,
            user_id=user_id,
        )
        db.add(assignment)
        await db.commit()
        await db.refresh(assignment)
        return {
            "id": assignment.id,
            "checkpoint_id": assignment.checkpoint_id,
            "user_id": assignment.user_id,
        }

    @staticmethod
    async def unassign_checkpoint(
        db: AsyncSession,
        checkpoint_id: int,
        user_id: int,
    ) -> None:
        """Снять назначение маркера с КП (404, если назначения нет)."""
        result = await db.execute(
            select(CheckpointAssignment).where(
                CheckpointAssignment.checkpoint_id == checkpoint_id,
                CheckpointAssignment.user_id == user_id,
            )
        )
        assignment = result.scalar_one_or_none()
        if assignment is None:
            raise HTTPException(status_code=404, detail="Назначение не найдено")

        await db.delete(assignment)
        await db.commit()

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
