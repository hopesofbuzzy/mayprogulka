from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import date


class PaperFormRequest(BaseModel):
    """Ввод данных с бумажной анкеты на старте."""
    route_id: int
    surname: str
    name: str
    middle_name: Optional[str] = None
    date_of_birth: date
    gender: str
    phone_number: str
    email: str


class PaperFormResponse(BaseModel):
    """Результат создания участника с бумажной анкеты."""
    participant_id: int
    form_id: str
    payment_status: str


class MatchRequest(BaseModel):
    """Сопоставление карты с участником."""
    barcode: str
    form_id: str


class MatchResponse(BaseModel):
    """Результат сопоставления."""
    status: str
    barcode: str
    participant_id: int
    participant_name: str
    message: str


class UnlinkedMapResponse(BaseModel):
    """Непривязанная карта."""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    barcode: str
    participant_id: Optional[int] = None


class UnlinkedMapListResponse(BaseModel):
    """Список непривязанных карт."""
    maps: list[UnlinkedMapResponse]