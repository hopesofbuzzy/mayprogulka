from datetime import date
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
