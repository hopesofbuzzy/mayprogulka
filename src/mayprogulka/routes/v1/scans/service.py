from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from fastapi import HTTPException
from datetime import datetime

from database.models import Map, Participant, Checkpoint, CheckpointPass, Route
from mayprogulka.models.scans import (
    ScanResponse,
    BatchScanRequest,
    BatchScanResponse,
    BatchScanError,
    BatchScanItem,
    SelfScanResponse,
)


class ScanService:

    @staticmethod
    async def _find_participant_by_barcode(
        db: AsyncSession,
        barcode: str
    ) -> tuple[Map, Participant]:
        """
        Поиск участника по barcode карты.
        Возвращает (Map, Participant) или выбрасывает 404.
        """
        result = await db.execute(
            select(Map, Participant)
            .join(Participant, Map.participant_id == Participant.id)
            .where(Map.barcode == barcode)
        )
        row = result.one_or_none()
        
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Карта с barcode '{barcode}' не найдена или не привязана"
            )
        
        return row
    
    @staticmethod
    async def _check_already_passed(
        db: AsyncSession,
        participant_id: int,
        checkpoint_id: int
    ) -> bool:
        """Проверка, прошёл ли участник уже этот КП."""
        result = await db.execute(
            select(CheckpointPass.id).where(
                and_(
                    CheckpointPass.participant_id == participant_id,
                    CheckpointPass.checkpoint_id == checkpoint_id,
                )
            )
        )
        return result.scalar_one_or_none() is not None
    
    @staticmethod
    async def _update_participant_status(
        db: AsyncSession,
        participant: Participant,
        checkpoint: Checkpoint
    ) -> None:
        """Обновление статусов has_started и has_finished."""
        if checkpoint.is_start and not participant.has_started:
            participant.has_started = True
        if checkpoint.is_finish and not participant.has_finished:
            participant.has_finished = True
    
    @staticmethod
    async def scan_single(
        db: AsyncSession,
        barcode: str,
        checkpoint_id: int,
        scanned_at: datetime | None = None,
    ) -> ScanResponse:
        """
        Одиночное сканирование на КП.
        Возвращает информацию о прохождении или ошибку.
        """
        # 1. Проверяем существование КП
        result = await db.execute(
            select(Checkpoint).where(Checkpoint.id == checkpoint_id)
        )
        checkpoint = result.scalar_one_or_none()
        if not checkpoint:
            raise HTTPException(status_code=404, detail="КП не найден")
        
        # 2. Ищем участника по barcode
        map_obj, participant = await ScanService._find_participant_by_barcode(db, barcode)
        
        # 3. Проверяем, не проходил ли уже
        if await ScanService._check_already_passed(db, participant.id, checkpoint_id):
            return ScanResponse(
                status="already_passed",
                barcode=barcode,
                participant_name=f"{participant.name} {participant.surname}",
                checkpoint_name=checkpoint.name,
                message="Участник уже проходил этот КП",
            )
        
        # 4. Создаём запись о прохождении
        passed_at = scanned_at or datetime.utcnow()
        checkpoint_pass = CheckpointPass(
            checkpoint_id=checkpoint_id,
            participant_id=participant.id,
            passed_at=passed_at,
        )
        db.add(checkpoint_pass)
        
        # 5. Обновляем статусы участника
        await ScanService._update_participant_status(db, participant, checkpoint)
        
        await db.commit()
        
        return ScanResponse(
            status="success",
            barcode=barcode,
            participant_name=f"{participant.name} {participant.surname}",
            checkpoint_name=checkpoint.name,
            passed_at=passed_at,
            message="Прохождение успешно записано",
        )
    
    @staticmethod
    async def scan_batch(
        db: AsyncSession,
        data: BatchScanRequest,
    ) -> BatchScanResponse:
        """
        Пакетное сканирование. Обрабатывает массив barcode'ов одной транзакцией.
        Критически важен для скорости на КП!
        """
        processed = 0
        already_passed = 0
        errors = []
        
        # Проверяем существование КП один раз
        result = await db.execute(
            select(Checkpoint).where(Checkpoint.id == data.checkpoint_id)
        )
        checkpoint = result.scalar_one_or_none()
        if not checkpoint:
            raise HTTPException(status_code=404, detail="КП не найден")
        
        # Обрабатываем каждый barcode
        for scan_item in data.scans:
            try:
                # Ищем участника
                map_obj, participant = await ScanService._find_participant_by_barcode(
                    db, scan_item.barcode
                )
                
                # Проверяем дубликат
                if await ScanService._check_already_passed(
                    db, participant.id, data.checkpoint_id
                ):
                    already_passed += 1
                    continue
                
                # Создаём запись
                passed_at = scan_item.timestamp or datetime.utcnow()
                checkpoint_pass = CheckpointPass(
                    checkpoint_id=data.checkpoint_id,
                    participant_id=participant.id,
                    passed_at=passed_at,
                )
                db.add(checkpoint_pass)
                
                # Обновляем статусы
                await ScanService._update_participant_status(
                    db, participant, checkpoint
                )
                
                processed += 1
                
            except HTTPException as e:
                errors.append(BatchScanError(
                    barcode=scan_item.barcode,
                    error=str(e.detail),
                ))
            except Exception as e:
                errors.append(BatchScanError(
                    barcode=scan_item.barcode,
                    error=f"Неизвестная ошибка: {str(e)}",
                ))
        
        # Один коммит на весь батч
        await db.commit()
        
        return BatchScanResponse(
            processed=processed,
            already_passed=already_passed,
            errors=errors,
        )
    
    @staticmethod
    async def scan_self(
        db: AsyncSession,
        participant_id: int,
        checkpoint_id: int,
    ) -> SelfScanResponse:
        """
        Самостоятельная отметка участника по QR-коду КП.
        Участник авторизован, checkpoint_id берётся из QR.
        """
        # 1. Проверяем КП
        result = await db.execute(
            select(Checkpoint).where(Checkpoint.id == checkpoint_id)
        )
        checkpoint = result.scalar_one_or_none()
        if not checkpoint:
            raise HTTPException(status_code=404, detail="КП не найден")
        
        # 2. Проверяем, что участник зарегистрирован на маршрут этого КП
        result = await db.execute(
            select(Participant).where(Participant.id == participant_id)
        )
        participant = result.scalar_one_or_none()
        if not participant:
            raise HTTPException(status_code=404, detail="Участник не найден")
        
        if participant.route_id != checkpoint.route_id:
            raise HTTPException(
                status_code=400,
                detail="Участник не зарегистрирован на маршрут этого КП"
            )
        
        # 3. Проверяем дубликат
        if await ScanService._check_already_passed(db, participant_id, checkpoint_id):
            return SelfScanResponse(
                status="already_passed",
                checkpoint_name=checkpoint.name,
                message="Вы уже проходили этот КП",
            )
        
        # 4. Создаём запись
        checkpoint_pass = CheckpointPass(
            checkpoint_id=checkpoint_id,
            participant_id=participant_id,
            passed_at=datetime.utcnow(),
        )
        db.add(checkpoint_pass)
        
        # 5. Обновляем статусы
        await ScanService._update_participant_status(db, participant, checkpoint)
        
        await db.commit()
        
        return SelfScanResponse(
            status="success",
            checkpoint_name=checkpoint.name,
            passed_at=checkpoint_pass.passed_at,
            message="Прохождение успешно записано",
        )
    
    @staticmethod
    async def scan_from_file(
        db: AsyncSession,
        checkpoint_id: int,
        barcodes: list[str],
    ) -> dict:
        """
        Обработка файла со списком штрих-кодов (офлайн-синхронизация).
        Логика идентична batch, но входные данные проще.
        """
        batch_data = BatchScanRequest(
            checkpoint_id=checkpoint_id,
            scans=[BatchScanItem(barcode=b) for b in barcodes],
        )
        result = await ScanService.scan_batch(db, batch_data)
        return {
            "processed": result.processed,
            "already_passed": result.already_passed,
            "errors": [e.model_dump() for e in result.errors],
        }