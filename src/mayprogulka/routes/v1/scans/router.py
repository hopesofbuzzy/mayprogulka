from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mayprogulka.database.database import get_db
from mayprogulka.database.models import Checkpoint, Participant, User
from mayprogulka.routes.v1.auth.service import get_current_user, require_marker
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

@router.post("", response_model=ScanResponse)
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


@router.post("/batch", response_model=BatchScanResponse)
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


@router.post("/upload-file", response_model=UploadFileResponse)
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

@router.post("/self", response_model=SelfScanResponse)
async def scan_self(
    data: SelfScanRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Самостоятельная отметка участника на КП по общему QR-коду.

    Отметить можно только собственную запись участника (или запись
    близкого, зарегистрированного этим же аккаунтом). Чужие карты
    сканировать нельзя. Если на маршруте несколько записей аккаунта,
    нужно указать participant_id или form_id.
    """
    result = await db.execute(
        select(Checkpoint).where(Checkpoint.id == data.checkpoint_id)
    )
    checkpoint = result.scalar_one_or_none()
    if not checkpoint:
        raise HTTPException(status_code=404, detail="КП не найден")

    conditions = [
        Participant.user_id == current_user.id,
        Participant.route_id == checkpoint.route_id,
    ]
    if data.participant_id is not None:
        conditions.append(Participant.id == data.participant_id)
    if data.form_id is not None:
        conditions.append(Participant.form_id == data.form_id)

    result = await db.execute(select(Participant).where(*conditions))
    participants = result.scalars().all()

    if not participants:
        raise HTTPException(
            status_code=404,
            detail="Вы не зарегистрированы на маршрут этого КП",
        )
    if len(participants) > 1:
        raise HTTPException(
            status_code=400,
            detail="На этом маршруте несколько ваших участников. Укажите participant_id или form_id",
        )

    return await ScanService.scan_self(
        db, participants[0].id, data.checkpoint_id
    )
