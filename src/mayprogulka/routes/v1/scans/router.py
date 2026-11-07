from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db
from database.models import User
from mayprogulka.routes.v1.auth.service import require_role, get_current_user
from mayprogulka.models.scans import (
    ScanRequest,
    ScanResponse,
    BatchScanRequest,
    BatchScanResponse,
    SelfScanRequest,
    SelfScanResponse,
    UploadFileResponse,
)
from .service import ScanService

router = APIRouter(prefix="/scans", tags=["scans"])


# ==================== СКАНИРОВАНИЕ ОРГАНИЗАТОРОМ ====================

@router.post("", response_model=ScanResponse)
async def scan_single(
    data: ScanRequest,
    current_user: User = Depends(require_role("organizer")),
    db: AsyncSession = Depends(get_db),
):
    """
    Одиночное сканирование участника на КП организатором.
    Основной эндпоинт для волонтёров на контрольных пунктах.
    """
    return await ScanService.scan_single(db, data.barcode, data.checkpoint_id)


@router.post("/batch", response_model=BatchScanResponse)
async def scan_batch(
    data: BatchScanRequest,
    current_user: User = Depends(require_role("organizer")),
    db: AsyncSession = Depends(get_db),
):
    """
    Пакетное сканирование (массовое чтение).
    Критически важен для скорости: обрабатывает массив barcode'ов одной транзакцией.
    """
    return await ScanService.scan_batch(db, data)


@router.post("/upload-file", response_model=UploadFileResponse)
async def upload_scan_file(
    checkpoint_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_role("organizer")),
    db: AsyncSession = Depends(get_db),
):
    """
    Загрузка файла со списком штрих-кодов (офлайн-синхронизация).
    Файл должен быть текстовым, по одному barcode на строку.
    """
    # Проверяем тип файла
    if file.content_type not in ["text/plain", "application/octet-stream"]:
        raise HTTPException(
            status_code=400,
            detail="Файл должен быть текстовым (.txt)"
        )
    
    # Читаем содержимое
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Файл должен быть в кодировке UTF-8")
    
    # Парсим barcode'и (по одному на строку, игнорируем пустые)
    barcodes = [line.strip() for line in text.splitlines() if line.strip()]
    
    if not barcodes:
        raise HTTPException(status_code=400, detail="Файл не содержит штрих-кодов")
    
    return await ScanService.scan_from_file(db, checkpoint_id, barcodes)


# ==================== САМОСТОЯТЕЛЬНАЯ ОТМЕТКА ====================

@router.post("/self", response_model=SelfScanResponse)
async def scan_self(
    data: SelfScanRequest,
    current_user: User = Depends(require_role("participant")),
    db: AsyncSession = Depends(get_db),
):
    """
    Самостоятельная отметка участника на КП по общему QR-коду.
    Участник сканирует QR-код на КП (который содержит checkpoint_id),
    приложение отправляет запрос с токеном участника.
    """
    # Находим участника текущего пользователя на нужном маршруте
    from sqlalchemy import select
    from database.models import Participant, Checkpoint
    
    # Получаем checkpoint
    result = await db.execute(
        select(Checkpoint).where(Checkpoint.id == data.checkpoint_id)
    )
    checkpoint = result.scalar_one_or_none()
    if not checkpoint:
        raise HTTPException(status_code=404, detail="КП не найден")
    
    # Находим участника этого пользователя на этом маршруте
    result = await db.execute(
        select(Participant).where(
            Participant.user_id == current_user.id,
            Participant.route_id == checkpoint.route_id,
        )
    )
    participant = result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(
            status_code=404,
            detail="Вы не зарегистрированы на маршрут этого КП"
        )
    
    return await ScanService.scan_self(db, participant.id, data.checkpoint_id)