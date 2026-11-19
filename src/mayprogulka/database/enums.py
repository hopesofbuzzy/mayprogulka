"""Роли пользователей и правила их использования.

Роль хранится в таблице users в виде строки и дополнительно ограничена
CHECK-констрейнтом на уровне базы данных (см. database/models.py).
"""

from enum import Enum


class Role(str, Enum):
    """Шесть ролей системы.

    ``participant`` не является ролью: участник мероприятия — это запись
    в таблице participants, которая принадлежит пользователю (user).
    """

    USER = "user"
    TYPIST = "typist"
    REGISTRAR = "registrar"
    MARKER = "marker"
    ORGANIZER = "organizer"
    ADMIN = "admin"


#: Полный список допустимых значений для БД и валидации.
ALL_ROLES: tuple[str, ...] = tuple(role.value for role in Role)

#: Роли, которые организатор может назначать (администратора — нельзя).
ORGANIZER_ASSIGNABLE_ROLES: tuple[Role, ...] = (
    Role.USER,
    Role.TYPIST,
    Role.REGISTRAR,
    Role.MARKER,
    Role.ORGANIZER,
)

#: Роли, которые относятся к персоналу мероприятия.
STAFF_ROLES: tuple[Role, ...] = (
    Role.TYPIST,
    Role.REGISTRAR,
    Role.MARKER,
    Role.ORGANIZER,
    Role.ADMIN,
)


def role_value(role: Role | str) -> str:
    """Вернуть строковое значение роли (для сравнения с БД)."""

    return role.value if isinstance(role, Role) else str(role)
