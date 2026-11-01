from pydantic import BaseModel, Field
from datetime import date
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
    map_barcode: Optional[int] = None

    class Config:
        from_attributes = True


class ParticipantListResponse(BaseModel):
    participants: list[ParticipantListItem]


class PaymentRequest(BaseModel):
    payment_method: str = Field(default="card", pattern="^(card|sbp)$")


class PaymentResponse(BaseModel):
    status: str  # success, pending, failed
    payment_id: str
    form_pdf_url: Optional[str] = None