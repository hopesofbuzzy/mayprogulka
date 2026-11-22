"""Генерация штрихкода чекпоинта."""

from datetime import datetime
from uuid import uuid4


def generate_checkpoint_barcode(year: int | None = None) -> str:
    """Вернуть штрихкод контрольного пункта в формате ``C{год}-{8 hex}``.

    Пример: ``C2026-1a2b3c4d``. Номер уникален с практической точки
    зрения; окончательную уникальность обеспечивает индекс на
    ``checkpoints.barcode``.
    """

    if year is None:
        year = datetime.now().year
    return f"C{year}-{uuid4().hex[:8]}"
