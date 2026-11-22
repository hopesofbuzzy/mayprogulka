"""Идемпотентная миграция 001 для SQLite.

Что делает:
* добавляет participants.started_at / participants.finished_at;
* переводит устаревшую роль ``participant`` в ``user``;
* создаёт уникальный индекс на participants.form_id;
* создаёт частичный уникальный индекс maps(participant_id);
* создаёт индексы route_id и (has_started, has_finished).

Запуск:
    python scripts/migrate_001.py [путь_к_database.db]

При дубликатах form_id / participant_id скрипт печатает понятное
сообщение и завершается с кодом 1.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "mayprogulka"
    / "database"
    / "database.db"
)


def columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def add_column_if_missing(
    connection: sqlite3.Connection,
    table: str,
    column: str,
    definition: str,
) -> None:
    if column in columns(connection, table):
        return
    connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    print(f"+ {table}.{column}")


def report_duplicates(
    connection: sqlite3.Connection,
    table: str,
    column: str,
    where: str = "",
) -> bool:
    query = (
        f"SELECT {column}, COUNT(*) AS c FROM {table} {where} "
        f"GROUP BY {column} HAVING c > 1 ORDER BY c DESC LIMIT 10"
    )
    duplicates = connection.execute(query).fetchall()
    if not duplicates:
        return False
    print(
        f"ERROR: не удалось создать уникальный индекс: "
        f"в {table}.{column} есть дубликаты:",
        file=sys.stderr,
    )
    for value, count in duplicates:
        print(f"  {column}={value!r}: {count} записей", file=sys.stderr)
    print(
        "  Исправьте дубликаты вручную и запустите миграцию повторно.",
        file=sys.stderr,
    )
    return True


def migrate(db_path: Path) -> int:
    if not db_path.exists():
        print(f"ERROR: база не найдена: {db_path}", file=sys.stderr)
        return 1

    connection = sqlite3.connect(db_path)
    try:
        with connection:
            add_column_if_missing(
                connection, "participants", "started_at", "DATETIME"
            )
            add_column_if_missing(
                connection, "participants", "finished_at", "DATETIME"
            )
            add_column_if_missing(
                connection, "checkpoints", "barcode", "TEXT"
            )

            updated = connection.execute(
                "UPDATE users SET role = 'user' WHERE role = 'participant'"
            ).rowcount
            if updated:
                print(f"~ users.role participant -> user: {updated}")

            if report_duplicates(connection, "participants", "form_id"):
                return 1
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_participants_form_id "
                "ON participants(form_id)"
            )
            print("OK: индекс participants(form_id)")

            if report_duplicates(
                connection,
                "maps",
                "participant_id",
                "WHERE participant_id IS NOT NULL",
            ):
                return 1
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_maps_participant_id "
                "ON maps(participant_id) WHERE participant_id IS NOT NULL"
            )
            print("OK: частичный индекс maps(participant_id)")

            connection.execute(
                "CREATE INDEX IF NOT EXISTS ix_participants_route_id "
                "ON participants(route_id)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS ix_participants_started_finished "
                "ON participants(has_started, has_finished)"
            )
            print(
                "OK: индексы participants(route_id), "
                "participants(has_started, has_finished)"
            )

        print("OK: миграция 001 применена (идемпотентно)")
        return 0
    finally:
        connection.close()


def main() -> int:
    db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB
    return migrate(db_path)


if __name__ == "__main__":
    raise SystemExit(main())
