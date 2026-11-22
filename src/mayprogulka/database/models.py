from datetime import date

from sqlalchemy import (
    String,
    Integer,
    Float,
    Boolean,
    Date,
    ForeignKey,
    DateTime,
    CheckConstraint,
    Index,
    UniqueConstraint,
    text,
)
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base
from .enums import ALL_ROLES, Role

_ROLE_CHECK = "role IN (" + ", ".join(f"'{role}'" for role in ALL_ROLES) + ")"

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(_ROLE_CHECK, name="ck_users_role"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    
    # Важно: поле называется hashed_password, а не password
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Роли: user, typist, registrar, marker, organizer, admin.
    # Значение дополнительно проверяется CHECK-констрейнтом ck_users_role.
    role: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=Role.USER.value,
        server_default=Role.USER.value,
    )

    participants: Mapped[list["Participant"]] = relationship(back_populates="user")

    # Контрольные пункты, назначенные маркеру.
    marker_assignments: Mapped[list["CheckpointAssignment"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

class Route(Base):
    """Маршрут соревнования или мероприятия."""

    __tablename__ = "routes"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    year: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    distance: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        String,
        nullable=True,
    )

    # Один маршрут может иметь множество участников.
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="route",
    )

    # Один маршрут может иметь множество контрольных пунктов.
    checkpoints: Mapped[list["Checkpoint"]] = relationship(
        back_populates="route",
        cascade="all, delete-orphan",
    )

    # Позиции контрольных пунктов на маршруте.
    checkpoint_positions: Mapped[list["CheckpointPositions"]] = relationship(
        back_populates="route",
        cascade="all, delete-orphan",
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True
    )

    map_url: Mapped[str] = mapped_column(
        String,
        nullable=True,
    )


class Checkpoint(Base):
    """Контрольный пункт, принадлежащий маршруту."""

    __tablename__ = "checkpoints"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    # Внешний ключ на маршрут.
    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id"),
        nullable=False,
    )

    barcode: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    address: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # Координаты храним строкой (TEXT в схеме), напр. "55.75,37.61".
    coordinates: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # Маршрут, которому принадлежит контрольный пункт.
    route: Mapped["Route"] = relationship(
        back_populates="checkpoints",
    )

    # Позиции этого КП на маршрутах.
    positions: Mapped[list["CheckpointPositions"]] = relationship(
        back_populates="checkpoint",
        cascade="all, delete-orphan",
    )

    # Отметки о прохождении этого пункта участниками.
    passes: Mapped[list["CheckpointPass"]] = relationship(
        back_populates="checkpoint",
        cascade="all, delete-orphan",
    )

    # Назначения КП маркерам.
    marker_assignments: Mapped[list["CheckpointAssignment"]] = relationship(
        back_populates="checkpoint",
        cascade="all, delete-orphan",
    )


class Participant(Base):
    """Данные участника конкретного маршрута."""

    __tablename__ = "participants"
    __table_args__ = (
        Index("uq_participants_form_id", "form_id", unique=True),
        Index("ix_participants_route_id", "route_id"),
        Index("ix_participants_started_finished", "has_started", "has_finished"),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    # Внешний ключ на пользователя.
    # NULL допустим для бумажных анкет: их вводит наборщик, аккаунта у
    # участника может не быть.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"),
        nullable=True,
    )

    # Внешний ключ на маршрут.
    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id"),
        nullable=False,
    )

    form_id: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    has_started: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    has_finished: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    # Фактическое время первого старта и финиша (NULL — ещё не было).
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    surname: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    middle_name: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    date_of_birth: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    gender: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    phone_number: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    email: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # Объект пользователя, которому принадлежит участие.
    # Для бумажных анкет пользователя нет.
    user: Mapped["User | None"] = relationship(
        back_populates="participants",
    )

    # Объект маршрута, к которому относится участие.
    route: Mapped["Route"] = relationship(
        back_populates="participants",
    )

    # Карты, связанные с участником.
    maps: Mapped[list["Map"]] = relationship(
        back_populates="participant",
        cascade="all, delete-orphan",
    )

    # Отметки о прохождении контрольных пунктов.
    checkpoint_passes: Mapped[list["CheckpointPass"]] = relationship(
        back_populates="participant",
        cascade="all, delete-orphan",
    )

    payment_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="unpaid"
    )


class CheckpointPass(Base):
    """Отметка о прохождении участником контрольного пункта (Schema: Checkpoint_Pass)."""

    __tablename__ = "checkpoint_passes"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    # В схеме БД физические имена колонок — "checkpoint" и "participant".
    checkpoint_id: Mapped[int] = mapped_column(
        "checkpoint",
        ForeignKey("checkpoints.id"),
        nullable=False,
    )

    participant_id: Mapped[int] = mapped_column(
        "participant",
        ForeignKey("participants.id"),
        nullable=False
    )

    # Момент прохождения пункта; в схеме тип TEXT, поэтому храним ISO-строку.
    passed_at: Mapped[datetime] = mapped_column(
        DateTime, 
        default=datetime.utcnow, 
        nullable=False
    )

    # Контрольный пункт, который был пройден.
    checkpoint: Mapped["Checkpoint"] = relationship(
        back_populates="passes",
    )

    # Участник, которому принадлежит отметка.
    participant: Mapped["Participant"] = relationship(
        back_populates="checkpoint_passes",
    )


class Map(Base):
    """Карта, связанная с участником."""

    __tablename__ = "maps"
    __table_args__ = (
        # Одна карта на участника. NULL (непривязанные карты) не считаются.
        Index(
            "uq_maps_participant_id",
            "participant_id",
            unique=True,
            sqlite_where=text("participant_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    # Внешний ключ на участника.
    participant_id: Mapped[int] = mapped_column(
        ForeignKey("participants.id"),
        nullable=True,
    )

    # Баркод карты (INTEGER в схеме).
    barcode: Mapped[str] = mapped_column(
        String,
        nullable=True,
        unique=True
    )

    # Участник, которому принадлежит карта.
    participant: Mapped["Participant"] = relationship(
        back_populates="maps",
    )


class CheckpointAssignment(Base):
    """Назначение контрольного пункта маркеру.

    Маркер (роль ``marker``) может сканировать карты только на тех КП,
    которые ему назначил организатор или администратор.
    """

    # Историческое имя таблицы сохранено для совместимости с миграцией.
    __tablename__ = "marker_assignments"
    __table_args__ = (
        UniqueConstraint("user_id", "checkpoint_id", name="uq_marker_checkpoint"),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    checkpoint_id: Mapped[int] = mapped_column(
        ForeignKey("checkpoints.id"),
        nullable=False,
        index=True,
    )

    user: Mapped["User"] = relationship(back_populates="marker_assignments")
    checkpoint: Mapped["Checkpoint"] = relationship(back_populates="marker_assignments")


# Совместимый алиас: старые импорты MarkerAssignment продолжают работать.
MarkerAssignment = CheckpointAssignment


class CheckpointPositions(Base):
    """Связь контрольного пункта и маршрута с порядковым номером пункта на маршруте."""

    __tablename__ = "checkpoint_positions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    checkpoint_id: Mapped[int] = mapped_column(
        ForeignKey("checkpoints.id"),
        nullable=False,
    )

    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id"),
        nullable=False,
    )

    # Порядковый номер контрольного пункта на данном маршруте.
    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    checkpoint: Mapped["Checkpoint"] = relationship(
        back_populates="positions",
    )

    route: Mapped["Route"] = relationship(
        back_populates="checkpoint_positions",
    )
