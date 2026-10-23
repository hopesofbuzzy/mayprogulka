
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


class User(Base):
    """Пользователь системы."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    username: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    role: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # Храним хеш пароля, а не сам пароль.
    password: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    auth_type: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # Один пользователь может иметь несколько записей об участии.
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="user",
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

    # Один маршрут может иметь множество участников.
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="route",
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

    # Участник, которому принадлежит карта.
    participant: Mapped["Participant"] = relationship(
        back_populates="maps",
    )
