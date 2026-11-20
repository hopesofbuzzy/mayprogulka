from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class RegistrarFormItem(BaseModel):
    """Анкета участника на экране регистратора."""

    model_config = ConfigDict(from_attributes=True)

    participant_id: int
    form_id: str
    surname: str
    name: str
    middle_name: Optional[str] = None
    date_of_birth: date
    gender: str
    phone_number: str
    email: str
    route_id: int
    route_name: str
    route_year: int
    payment_status: str
    has_started: bool
    has_finished: bool
    map_barcode: Optional[str] = None


class RegistrarFormListResponse(BaseModel):
    forms: list[RegistrarFormItem]
    total: int
    limit: int
    offset: int = 0


class IssueCardRequest(BaseModel):
    """Выдача карты и старт участника."""

    participant_id: int
    barcode: Optional[str] = None


class IssueCardResponse(BaseModel):
    status: str
    participant_id: int
    form_id: str
    barcode: Optional[str] = None
    started_at: Optional[datetime] = None
    message: str
