from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class ScanRequest(BaseModel):
    """Одиночное сканирование на КП."""
    barcode: str
    checkpoint_id: int


class ScanResponse(BaseModel):
    """Результат одиночного сканирования."""
    status: str  # "success", "already_passed", "error"
    barcode: str
    participant_name: Optional[str] = None
    checkpoint_name: Optional[str] = None
    passed_at: Optional[datetime] = None
    message: str


class BatchScanItem(BaseModel):
    """Элемент пакетного сканирования."""
    barcode: str
    timestamp: Optional[datetime] = None  # Время сканирования на устройстве


class BatchScanRequest(BaseModel):
    """Пакетное сканирование."""
    checkpoint_id: int
    scans: list[BatchScanItem]


class BatchScanError(BaseModel):
    """Ошибка обработки одного сканирования."""
    barcode: str
    error: str


class BatchScanResponse(BaseModel):
    """Результат пакетного сканирования."""
    processed: int
    already_passed: int
    errors: list[BatchScanError]


class SelfScanRequest(BaseModel):
    """Самостоятельная отметка участника."""
    checkpoint_id: int


class SelfScanResponse(BaseModel):
    """Результат самостоятельной отметки."""
    status: str
    checkpoint_name: Optional[str] = None
    passed_at: Optional[datetime] = None
    message: str


class UploadFileResponse(BaseModel):
    """Результат загрузки файла со сканированиями."""
    processed: int
    already_passed: int
    errors: list[BatchScanError]