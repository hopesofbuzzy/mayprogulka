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

#: Иерархия ролей: ключ наследует перечисленные роли.
#: Администратор наследует организатора. На typist/registrar/marker
#: иерархия не распространяется: организатор получает их права только
#: там, где это явно указано в зависимости эндпоинта.
ROLE_HIERARCHY: dict[Role, tuple[Role, ...]] = {
    Role.ADMIN: (Role.ORGANIZER,),
}


def role_value(role: Role | str) -> str:
    """Вернуть строковое значение роли (для сравнения с БД)."""

    return role.value if isinstance(role, Role) else str(role)


def expand_roles(required_roles: tuple[Role | str, ...]) -> set[str]:
    """Раскрыть требуемые роли с учётом иерархии (транзитивно).

    Если требуется organizer, то admin тоже допускается. Если требуется
    registrar, а зависимость дополнительно включает organizer, то
    администратор также проходит проверку.
    """

    allowed: set[str] = set()

    def add_with_children(role: Role | str) -> None:
        value = role_value(role)
        if value in allowed:
            return
        allowed.add(value)
        for child, parents in ROLE_HIERARCHY.items():
            if value in {role_value(parent) for parent in parents}:
                add_with_children(child)

    for required in required_roles:
        add_with_children(required)

    return allowed
