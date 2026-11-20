from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.enums import (
    ORGANIZER_ASSIGNABLE_ROLES,
    Role,
    role_value,
)
from mayprogulka.database.models import User
from mayprogulka.models.users import (
    RoleOption,
    UserItem,
    UserListResponse,
)

ROLE_TITLES: dict[Role, str] = {
    Role.USER: "Пользователь",
    Role.TYPIST: "Наборщик анкет",
    Role.REGISTRAR: "Регистратор на старте",
    Role.MARKER: "Маркер КП",
    Role.ORGANIZER: "Организатор",
    Role.ADMIN: "Администратор",
}


class UserService:

    @staticmethod
    def _is_admin(actor: User) -> bool:
        return role_value(actor.role) == Role.ADMIN.value

    @staticmethod
    def assignable_roles(actor: User) -> list[RoleOption]:
        """Список ролей, которые актор вправе назначить."""
        if UserService._is_admin(actor):
            roles = list(Role)
        else:
            roles = list(ORGANIZER_ASSIGNABLE_ROLES)
        return [RoleOption(value=role, title=ROLE_TITLES[role]) for role in roles]

    @staticmethod
    async def list_users(
        db: AsyncSession,
        actor: User,
        role: Role | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> UserListResponse:
        """Список аккаунтов.

        Организатор не видит администраторов: он не может управлять ими.
        Администратор видит все аккаунты.
        """
        conditions = []
        if not UserService._is_admin(actor):
            conditions.append(User.role != Role.ADMIN.value)

        if role is not None:
            conditions.append(User.role == role_value(role))

        if search:
            pattern = f"%{search.strip()}%"
            conditions.append(
                or_(
                    User.username.ilike(pattern),
                    User.email.ilike(pattern),
                )
            )

        count_query = select(func.count(User.id))
        query = select(User)
        for condition in conditions:
            count_query = count_query.where(condition)
            query = query.where(condition)

        total = (await db.execute(count_query)).scalar_one()
        result = await db.execute(
            query.order_by(User.id).limit(limit).offset(offset)
        )
        users = result.scalars().all()

        return UserListResponse(
            users=[UserItem.model_validate(user) for user in users],
            total=total,
            limit=limit,
            offset=offset,
        )

    @staticmethod
    async def assign_role(
        db: AsyncSession,
        actor: User,
        user_id: int,
        new_role: Role,
    ) -> User:
        """Назначить роль пользователю с проверкой полномочий актора."""
        result = await db.execute(select(User).where(User.id == user_id))
        target = result.scalar_one_or_none()
        if target is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        if target.id == actor.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Нельзя изменить собственную роль",
            )

        target_role = role_value(target.role)
        new_role_value = role_value(new_role)

        if not UserService._is_admin(actor):
            if target_role == Role.ADMIN.value:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Организатор не может менять роль администратора",
                )
            if new_role_value == Role.ADMIN.value:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Организатор не может назначать администраторов",
                )
            if new_role not in ORGANIZER_ASSIGNABLE_ROLES:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Эта роль недоступна организатору",
                )

        # Нельзя оставить систему без активного администратора.
        if (
            target_role == Role.ADMIN.value
            and new_role_value != Role.ADMIN.value
            and target.is_active
        ):
            await UserService._ensure_not_last_active_admin(db, target.id)

        if target_role != new_role_value:
            target.role = new_role_value
            await db.commit()
            await db.refresh(target)

        return target

    @staticmethod
    async def set_active(
        db: AsyncSession,
        actor: User,
        user_id: int,
        is_active: bool,
    ) -> User:
        """Блокировка/разблокировка аккаунта. Только администратор."""
        if not UserService._is_admin(actor):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Управление активностью аккаунтов доступно администратору",
            )

        result = await db.execute(select(User).where(User.id == user_id))
        target = result.scalar_one_or_none()
        if target is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        if (
            role_value(target.role) == Role.ADMIN.value
            and target.is_active
            and not is_active
        ):
            await UserService._ensure_not_last_active_admin(db, target.id)

        if target.is_active != is_active:
            target.is_active = is_active
            await db.commit()
            await db.refresh(target)

        return target

    @staticmethod
    async def _ensure_not_last_active_admin(
        db: AsyncSession,
        exclude_user_id: int,
    ) -> None:
        result = await db.execute(
            select(func.count(User.id)).where(
                User.role == Role.ADMIN.value,
                User.is_active.is_(True),
                User.id != exclude_user_id,
            )
        )
        if result.scalar_one() == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Нельзя убрать последнего активного администратора",
            )
