from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.enums import Role, role_value
from mayprogulka.database.models import (
    Checkpoint,
    MarkerAssignment,
    Route,
    User,
)
from mayprogulka.models.marker import (
    MarkerAssignmentsResponse,
    MarkerCheckpointItem,
    MarkerListItem,
    MarkerListResponse,
)


class MarkerService:

    @staticmethod
    async def get_assignments(
        db: AsyncSession,
        marker_id: int,
    ) -> MarkerAssignmentsResponse:
        """Вернуть назначенные маркеру КП вместе с данными маршрута."""
        result = await db.execute(
            select(Checkpoint, Route.name)
            .join(Route, Checkpoint.route_id == Route.id)
            .join(MarkerAssignment, MarkerAssignment.checkpoint_id == Checkpoint.id)
            .where(MarkerAssignment.user_id == marker_id)
            .order_by(Route.name, Checkpoint.order)
        )

        return MarkerAssignmentsResponse(
            marker_id=marker_id,
            checkpoints=[
                MarkerCheckpointItem(
                    checkpoint_id=checkpoint.id,
                    route_id=checkpoint.route_id,
                    route_name=route_name,
                    name=checkpoint.name,
                    address=checkpoint.address,
                    coordinates=checkpoint.coordinates,
                    order=checkpoint.order,
                    is_start=checkpoint.is_start,
                    is_finish=checkpoint.is_finish,
                )
                for checkpoint, route_name in result.all()
            ],
        )

    @staticmethod
    async def list_checkpoints(
        db: AsyncSession,
        actor: User,
        route_id: int | None = None,
    ) -> MarkerAssignmentsResponse:
        """КП, доступные актору.

        Маркер видит только назначенные ему КП. Организатор и
        администратор видят все КП (с необязательным фильтром route_id).
        """
        query = (
            select(Checkpoint, Route.name)
            .join(Route, Checkpoint.route_id == Route.id)
        )

        if role_value(actor.role) == Role.MARKER.value:
            query = query.join(
                MarkerAssignment,
                MarkerAssignment.checkpoint_id == Checkpoint.id,
            ).where(MarkerAssignment.user_id == actor.id)

        if route_id is not None:
            query = query.where(Checkpoint.route_id == route_id)

        result = await db.execute(query.order_by(Route.name, Checkpoint.order))

        return MarkerAssignmentsResponse(
            marker_id=actor.id,
            checkpoints=[
                MarkerCheckpointItem(
                    checkpoint_id=checkpoint.id,
                    route_id=checkpoint.route_id,
                    route_name=route_name,
                    name=checkpoint.name,
                    address=checkpoint.address,
                    coordinates=checkpoint.coordinates,
                    order=checkpoint.order,
                    is_start=checkpoint.is_start,
                    is_finish=checkpoint.is_finish,
                )
                for checkpoint, route_name in result.all()
            ],
        )

    @staticmethod
    async def list_markers(db: AsyncSession) -> MarkerListResponse:
        """Список пользователей с ролью marker и числом назначенных КП."""
        result = await db.execute(
            select(
                User.id,
                User.username,
                User.email,
                User.is_active,
                func.count(MarkerAssignment.id),
            )
            .outerjoin(MarkerAssignment, MarkerAssignment.user_id == User.id)
            .where(User.role == Role.MARKER.value)
            .group_by(User.id, User.username, User.email, User.is_active)
            .order_by(User.username)
        )

        return MarkerListResponse(
            markers=[
                MarkerListItem(
                    user_id=user_id,
                    username=username,
                    email=email,
                    is_active=is_active,
                    checkpoints_count=checkpoints_count,
                )
                for user_id, username, email, is_active, checkpoints_count in result.all()
            ]
        )

    @staticmethod
    async def replace_assignments(
        db: AsyncSession,
        marker_id: int,
        checkpoint_ids: list[int],
    ) -> MarkerAssignmentsResponse:
        """Полностью заменить набор КП, назначенных маркеру."""
        result = await db.execute(select(User).where(User.id == marker_id))
        marker = result.scalar_one_or_none()
        if marker is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        if role_value(marker.role) != Role.MARKER.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Сначала назначьте пользователю роль marker",
            )

        unique_ids = list(dict.fromkeys(checkpoint_ids))
        if unique_ids:
            found = await db.execute(
                select(Checkpoint.id).where(Checkpoint.id.in_(unique_ids))
            )
            found_ids = set(found.scalars().all())
            missing = [checkpoint_id for checkpoint_id in unique_ids if checkpoint_id not in found_ids]
            if missing:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Контрольные пункты не найдены: {missing}",
                )

        await db.execute(
            delete(MarkerAssignment).where(MarkerAssignment.user_id == marker_id)
        )
        db.add_all(
            [
                MarkerAssignment(user_id=marker_id, checkpoint_id=checkpoint_id)
                for checkpoint_id in unique_ids
            ]
        )
        await db.commit()

        return await MarkerService.get_assignments(db, marker_id)

    @staticmethod
    async def ensure_checkpoint_access(
        db: AsyncSession,
        user: User,
        checkpoint_id: int,
    ) -> None:
        """Проверить доступ к КП.

        Маркер — только назначенные КП (иначе 403). Организатор и
        администратор сканируют на любом КП.
        """
        if role_value(user.role) in {Role.ADMIN.value, Role.ORGANIZER.value}:
            return

        result = await db.execute(
            select(MarkerAssignment.id).where(
                MarkerAssignment.user_id == user.id,
                MarkerAssignment.checkpoint_id == checkpoint_id,
            )
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Этот контрольный пункт не назначен вам",
            )

    # Старое имя оставлено для совместимости с существующим кодом.
    ensure_can_scan = ensure_checkpoint_access
