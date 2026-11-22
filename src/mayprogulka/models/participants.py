from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional


class ParticipantData(BaseModel):
    surname: str
    name: str
    middle_name: Optional[str] = None
    route_id: int
    date_of_birth: date
    gender: str = Field(..., pattern="^(male|female)$")
    email: str
    phone_number: str


class ParticipantRegisterRequest(BaseModel):
    participants: list[ParticipantData]


class ParticipantItem(BaseModel):
    id: int
    form_id: str
    surname: str
    name: str
    payment_status: str

    class Config:
        from_attributes = True


class ParticipantRegisterResponse(BaseModel):
    registration_id: int
    participants: list[ParticipantItem]


class ParticipantListItem(BaseModel):
    id: int
    form_id: str
    surname: str
    name: str
    route_name: str
    payment_status: str
    has_started: bool
    has_finished: bool
    map_barcode: Optional[str] = None

    class Config:
        from_attributes = True


class ParticipantListResponse(BaseModel):
    participants: list[ParticipantListItem]
    total: int = 0
    limit: int = 50
    offset: int = 0


class ParticipantDetail(BaseModel):
    """Полная карточка участника для владельца/организатора/админа."""

    id: int
    form_id: str
    user_id: Optional[int] = None
    route_id: int
    route_name: str
    surname: str
    name: str
    middle_name: Optional[str] = None
    date_of_birth: date
    gender: str
    phone_number: str
    email: str
    payment_status: str
    has_started: bool
    has_finished: bool
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    map_barcode: Optional[str] = None
    # Ссылка на PDF появляется только после оплаты.
    form_pdf_url: Optional[str] = None


class ParticipantUpdateRequest(BaseModel):
    """Правка анкеты участника. После старта правка запрещена (409)."""

    surname: Optional[str] = None
    name: Optional[str] = None
    middle_name: Optional[str] = None
    date_of_birth: Optional[date] = None
    gender: Optional[str] = Field(default=None, pattern="^(male|female)$")
    phone_number: Optional[str] = None
    email: Optional[str] = None
    route_id: Optional[int] = None


class PaymentRequest(BaseModel):
    payment_method: str = Field(default="card", pattern="^(card|sbp)$")


class PaymentResponse(BaseModel):
    status: str  # success, pending, failed
    payment_id: str
    form_pdf_url: Optional[str] = None


class ParticipantPassItem(BaseModel):
    """Отметка о прохождении КП, видимая участнику в личном кабинете."""

    checkpoint_id: int
    checkpoint_name: str
    position: int
    route_id: int
    address: str
    passed_at: datetime


class ParticipantPassListResponse(BaseModel):
    participant_id: int
    passes: list[ParticipantPassItem]
