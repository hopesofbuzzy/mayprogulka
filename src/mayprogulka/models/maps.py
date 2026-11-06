from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class MapCreateRequest(BaseModel):
    """Создание карты. participant_id опционален (привязка происходит позже)."""
    barcode: str
    participant_id: Optional[int] = None  # <-- ИЗМЕНЕНО: стало опциональным


class MapResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    participant_id: Optional[int] = None  # <-- ИЗМЕНЕНО
    barcode: str
    is_linked: bool  # Удобное поле для фронта: привязана ли карта
    
    @classmethod
    def from_map(cls, map_obj):
        """Конвертация из ORM-объекта с вычислением is_linked."""
        return cls(
            id=map_obj.id,
            participant_id=map_obj.participant_id,
            barcode=map_obj.barcode,
            is_linked=map_obj.participant_id is not None,
        )


class MapListResponse(BaseModel):
    maps: list[MapResponse]


class BatchMapCreateRequest(BaseModel):
    barcodes: list[str]  # Упрощено: просто список barcode для массового создания


class BatchMapResponse(BaseModel):
    created_count: int


class MapMatchRequest(BaseModel):
    """Запрос на сопоставление карты с участником."""
    barcode: str
    form_id: str  # Номер анкеты участника


class MapMatchResponse(BaseModel):
    """Результат сопоставления."""
    status: str  # "success" или "error"
    barcode: str
    participant_id: int
    participant_name: str
    message: str


class MapInfoResponse(BaseModel):
    """Подробная информация о карте."""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    barcode: str
    participant_id: Optional[int] = None
    is_linked: bool
    
    # Данные участника (если карта привязана)
    participant_name: Optional[str] = None
    participant_surname: Optional[str] = None
    route_name: Optional[str] = None
    has_started: Optional[bool] = None
    has_finished: Optional[bool] = None
    payment_status: Optional[str] = None