from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from fastapi import HTTPException

from database.models import Checkpoint, CheckpointPass
from mayprogulka.models.checkpoints import (
    CheckpointCreateRequest,
    CheckpointUpdateRequest,
    CheckpointResponse,
    BatchCheckpointCreateRequest,
)


class CheckpointService:
    
    @staticmethod
    async def get_by_route(db: AsyncSession, route_id: int) -> list[CheckpointResponse]:
        """Получить все КП маршрута, отсортированные по порядку прохождения."""
        result = await db.execute(
            select(Checkpoint)
            .where(Checkpoint.route_id == route_id)
            .order_by(Checkpoint.order)
        )
        checkpoints = result.scalars().all()
        return [
            CheckpointResponse.model_validate(cp, from_attributes=True)
            for cp in checkpoints
        ]
    
    @staticmethod
    async def create(
        db: AsyncSession, 
        data: CheckpointCreateRequest
    ) -> CheckpointResponse:
        """Создать один контрольный пункт."""
        checkpoint = Checkpoint(**data.model_dump())
        db.add(checkpoint)
        await db.commit()
        await db.refresh(checkpoint)
        return CheckpointResponse.model_validate(checkpoint, from_attributes=True)
    
    @staticmethod
    async def update(
        db: AsyncSession,
        checkpoint_id: int,
        data: CheckpointUpdateRequest
    ) -> CheckpointResponse:
        """Обновить данные контрольного пункта."""
        result = await db.execute(
            select(Checkpoint).where(Checkpoint.id == checkpoint_id)
        )
        checkpoint = result.scalar_one_or_none()
        
        if not checkpoint:
            raise HTTPException(status_code=404, detail="КП не найден")
        
        # Обновляем только переданные поля
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(checkpoint, field, value)
        
        await db.commit()
        await db.refresh(checkpoint)
        return CheckpointResponse.model_validate(checkpoint, from_attributes=True)
    
    @staticmethod
    async def delete(db: AsyncSession, checkpoint_id: int) -> None:
        """
        Удалить КП. 
        Запрещено, если по этому КП уже есть отметки участников.
        """
        result = await db.execute(
            select(Checkpoint).where(Checkpoint.id == checkpoint_id)
        )
        checkpoint = result.scalar_one_or_none()
        
        if not checkpoint:
            raise HTTPException(status_code=404, detail="КП не найден")
        
        # Проверяем, есть ли уже прохождения через этот КП
        passes_count_result = await db.execute(
            select(func.count(CheckpointPass.id))
            .where(CheckpointPass.checkpoint_id == checkpoint_id)
        )
        passes_count = passes_count_result.scalar()

        if not passes_count:
            raise HTTPException(status_code=404, detail="Количество пропусков не обнаружено")
        
        if passes_count > 0:
            raise HTTPException(
                status_code=403,
                detail="Нельзя удалить КП, по которому уже есть отметки участников"
            )
        
        await db.delete(checkpoint)
        await db.commit()
    
    @staticmethod
    async def create_batch(
        db: AsyncSession,
        data: BatchCheckpointCreateRequest
    ) -> dict:
        """
        Массовое создание КП для маршрута.
        Обрабатывает частичные ошибки: валидные КП создаются, невалидные попадают в errors.
        """
        created_count = 0
        errors = []
        valid_checkpoints = []
        
        for idx, cp_data in enumerate(data.checkpoints):
            try:
                # Исключаем route_id из cp_data, так как он берётся из data.route_id
                cp_dict = cp_data.model_dump(exclude={'route_id'})
                checkpoint = Checkpoint(route_id=data.route_id, **cp_dict)
                valid_checkpoints.append(checkpoint)
            except Exception as e:
                errors.append({"index": idx, "error": f"Ошибка валидации: {str(e)}"})
        
        if valid_checkpoints:
            db.add_all(valid_checkpoints)
            try:
                await db.commit()
                created_count = len(valid_checkpoints)
            except Exception as e:
                await db.rollback()
                errors.append({"index": -1, "error": f"Ошибка базы данных: {str(e)}"})
                created_count = 0
        
        return {"created_count": created_count, "errors": errors}