from pydantic import BaseModel, ConfigDict, EmailStr

from mayprogulka.database.enums import Role


class RoleOption(BaseModel):
    """Вариант роли для выпадающего списка в интерфейсе."""

    value: Role
    title: str


class RolesResponse(BaseModel):
    roles: list[RoleOption]


class UserItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: EmailStr
    role: Role
    is_active: bool


class UserListResponse(BaseModel):
    users: list[UserItem]
    total: int
    limit: int
    offset: int


class RoleUpdateRequest(BaseModel):
    """Назначение роли пользователю."""

    role: Role


class UserStatusUpdateRequest(BaseModel):
    """Блокировка/разблокировка аккаунта (только администратор)."""

    is_active: bool
