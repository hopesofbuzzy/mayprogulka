"""Генерация штрихкода карты."""

from datetime import datetime
from uuid import uuid4


def generate_map_barcode(year: int | None = None) -> str:
    """Вернуть штрихкод карты в формате ``M{год}-{8 hex}``.

    Пример: ``M2026-1a2b3c4d1a2b3c4d``. Номер уникален с практической точки
    зрения; окончательную уникальность обеспечивает индекс на
    ``participants.form_id``.
    """

    if year is None:
        year = datetime.now().year
    return f"MP{year}-{uuid4().hex[:16]}"
