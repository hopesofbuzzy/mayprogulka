"""Сгенерировать OpenAPI-контракт из приложения.

Используется и для проверки расхождений, и для обновления файлов в
``contracts/``. Контракт детерминирован: повторный запуск даёт тот же JSON.
"""

from __future__ import annotations

import json
from pathlib import Path

from mayprogulka.entrypoint import app

ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    ROOT / "contracts" / "openapi.current.json",
    ROOT / "contracts" / "openapi.roles.json",
    ROOT / "src" / "contracts" / "openapi.current.json",
)


def main() -> None:
    schema = app.openapi()
    payload = json.dumps(schema, ensure_ascii=False, indent=2) + "\n"
    for target in TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload, encoding="utf-8")
        print(f"OK {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
