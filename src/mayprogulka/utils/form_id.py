"""Генерация номера анкеты участника."""

from datetime import datetime
from uuid import uuid4


def generate_form_id(year: int | None = None) -> str:
    """Вернуть номер анкеты в формате ``MP{год}-{8 hex}``.

    Пример: ``MP2026-1a2b3c4d``. Номер уникален с практической точки
    зрения; окончательную уникальность обеспечивает индекс на
    ``participants.form_id``.
    """

    if year is None:
        year = datetime.now().year
    return f"MP{year}-{uuid4().hex[:8]}"
