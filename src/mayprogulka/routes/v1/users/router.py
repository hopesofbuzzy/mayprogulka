from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.database import get_db
from mayprogulka.database.enums import Role
from mayprogulka.database.models import User
from mayprogulka.models.users import (
    RoleUpdateRequest,
    RolesResponse,
    UserItem,
    UserListResponse,
    UserStatusUpdateRequest,
)
from mayprogulka.routes.v1.auth.service import require_admin, require_organizer
from .service import UserService

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=UserListResponse)
async def list_users(
    role: Role | None = None,
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_organizer),
    db: AsyncSession = Depends(get_db),
):
    """
    Список аккаунтов.

    Организатор видит всех, кроме администраторов, и не может ими управлять.
    Администратор видит все аккаунты.
    """
    return await UserService.list_users(
        db=db,
        actor=current_user,
        role=role,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get("/roles", response_model=RolesResponse)
async def list_available_roles(
    current_user: User = Depends(require_organizer),
):
    """Роли, которые текущий организатор/администратор вправе назначать."""
    return RolesResponse(roles=UserService.assignable_roles(current_user))


@router.patch("/{user_id}/role", response_model=UserItem)
async def assign_role(
    user_id: int,
    data: RoleUpdateRequest,
    current_user: User = Depends(require_organizer),
    db: AsyncSession = Depends(get_db),
):
    """
    Назначить роль пользователю.

    Организатор может назначать любые роли, кроме admin.
    Администратор может назначать любые роли, включая admin.
    Нельзя только убрать последнего активного администратора.
    """
    user = await UserService.assign_role(
        db=db,
        actor=current_user,
        user_id=user_id,
        new_role=data.role,
    )
    return UserItem.model_validate(user)


@router.patch("/{user_id}/status", response_model=UserItem)
async def set_user_status(
    user_id: int,
    data: UserStatusUpdateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Заблокировать или разблокировать аккаунт (только администратор)."""
    user = await UserService.set_active(
        db=db,
        actor=current_user,
        user_id=user_id,
        is_active=data.is_active,
    )
    return UserItem.model_validate(user)
