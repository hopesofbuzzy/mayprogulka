from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.database import get_db
from mayprogulka.database.models import Checkpoint, Participant, User
from mayprogulka.database.enums import Role, role_value
from mayprogulka.routes.v1.auth.service import require_marker, require_user
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


# ==================== СКАНИРОВАНИЕ МАРКЕРОМ ====================

@router.post(
    "",
    response_model=ScanResponse,
    openapi_extra={"x-roles": ["marker", "organizer", "admin"]},
)
async def scan_single(
    data: ScanRequest,
    current_user: User = Depends(require_marker),
    db: AsyncSession = Depends(get_db),
):
    """
    Одиночное сканирование карты на КП.

    Доступно маркеру (только на назначенных ему КП) и администратору.
    """
    return await ScanService.scan_single(
        db, data.barcode, data.checkpoint_id, actor=current_user
    )


@router.post(
    "/batch",
    response_model=BatchScanResponse,
    openapi_extra={"x-roles": ["marker", "organizer", "admin"]},
)
async def scan_batch(
    data: BatchScanRequest,
    current_user: User = Depends(require_marker),
    db: AsyncSession = Depends(get_db),
):
    """
    Пакетное сканирование (массовое чтение).

    Маркер может передавать пачки штрих-кодов только со своего КП.
    """
    return await ScanService.scan_batch(db, data, actor=current_user)


@router.post(
    "/upload-file",
    response_model=UploadFileResponse,
    openapi_extra={"x-roles": ["marker", "organizer", "admin"]},
)
async def upload_scan_file(
    checkpoint_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_marker),
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
    
    return await ScanService.scan_from_file(
        db, checkpoint_id, barcodes, actor=current_user
    )


# ==================== САМОСТОЯТЕЛЬНАЯ ОТМЕТКА ====================

@router.post(
    "/self",
    response_model=SelfScanResponse,
    openapi_extra={"x-roles": ["user", "admin"]},
)
async def scan_self(
    data: SelfScanRequest,
    current_user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Самостоятельная отметка участника на КП по общему QR-коду.

    ``participant_id`` обязателен. Отметить можно только собственную
    запись участника; чужая запись — 403. До старта отметка запрещена
    (409). Администратор может отметить любую запись.
    """
    result = await db.execute(
        select(Checkpoint).where(Checkpoint.barcode == data.checkpoint_barcode)
    )
    checkpoint = result.scalar_one_or_none()
    if not checkpoint:
        raise HTTPException(status_code=404, detail="КП не найден")

    result = await db.execute(
        select(Participant).where(Participant.id == data.participant_id)
    )
    participant = result.scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=404, detail="Участник не найден")

    is_admin = role_value(current_user.role) == Role.ADMIN.value
    if participant.user_id != current_user.id and not is_admin:
        raise HTTPException(status_code=403, detail="Это чужая запись участника")

    if not participant.has_started:
        raise HTTPException(
            status_code=409,
            detail="Участник ещё не стартовал на маршруте",
        )

    return await ScanService.scan_self(
        db, participant.id, checkpoint.id
    )
