from datetime import date

from sqlalchemy import (
    String,
    Integer,
    Float,
    Boolean,
    Date,
    ForeignKey,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


# models.py
from sqlalchemy import String, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    
    # Важно: поле называется hashed_password, а не password
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[str] = mapped_column(String, default="participant")

    participants: Mapped[list["Participant"]] = relationship(back_populates="user")

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

    # Один маршрут может иметь множество участников.
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="route",
    )

    # Один маршрут может иметь множество контрольных пунктов.
    checkpoints: Mapped[list["Checkpoint"]] = relationship(
        back_populates="route",
        cascade="all, delete-orphan",
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

    # Отметки о прохождении этого пункта участниками.
    passes: Mapped[list["CheckpointPass"]] = relationship(
        back_populates="checkpoint",
        cascade="all, delete-orphan",
    )


class Participant(Base):
    """Данные участника конкретного маршрута."""

    __tablename__ = "participants"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    # Внешний ключ на пользователя.
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
    )

    # Внешний ключ на маршрут.
    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id"),
        nullable=False,
    )

    form_id: Mapped[int] = mapped_column(
        Integer,
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
    user: Mapped["User"] = relationship(
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
        nullable=False,
    )

    # Момент прохождения пункта; в схеме тип TEXT, поэтому храним ISO-строку.
    datetime: Mapped[str] = mapped_column(
        String,
        nullable=False,
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

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    # Внешний ключ на участника.
    participant_id: Mapped[int] = mapped_column(
        ForeignKey("participants.id"),
        nullable=False,
    )

    # Баркод карты (INTEGER в схеме).
    barcode: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # Участник, которому принадлежит карта.
    participant: Mapped["Participant"] = relationship(
        back_populates="maps",
    )