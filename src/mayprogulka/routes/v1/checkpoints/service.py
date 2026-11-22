from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, and_
from fastapi import HTTPException

from mayprogulka.database.models import (
    Checkpoint,
    CheckpointPass,
    CheckpointPositions,
    MarkerAssignment,
)
from mayprogulka.models.checkpoints import (
    CheckpointCreateRequest,
    CheckpointUpdateRequest,
    CheckpointResponse,
    BatchCheckpointCreateRequest,
)
from mayprogulka.utils.checkpoint_barcode import generate_checkpoint_barcode


class CheckpointService:
    
    @staticmethod
    async def get_by_route(db: AsyncSession, route_id: int) -> list[CheckpointResponse]:
        """Получить все КП маршрута, отсортированные по порядку прохождения."""
        result = await db.execute(
            select(Checkpoint, CheckpointPositions.position)
            .join(
                CheckpointPositions,
                and_(
                    CheckpointPositions.checkpoint_id == Checkpoint.id,
                    CheckpointPositions.route_id == route_id,
                ),
            )
            .where(Checkpoint.route_id == route_id)
            .order_by(CheckpointPositions.position)
        )
        return [
            CheckpointResponse(
                id=cp.id,
                barcode=cp.barcode,
                route_id=cp.route_id,
                name=cp.name,
                address=cp.address,
                coordinates=cp.coordinates,
                position=position,
            )
            for cp, position in result.all()
        ]
    
    @staticmethod
    async def create(
        db: AsyncSession, 
        data: CheckpointCreateRequest
    ) -> CheckpointResponse:
        """Создать один контрольный пункт."""
        cp_fields = data.model_dump(exclude={"position"})
        checkpoint = Checkpoint(**cp_fields, barcode=generate_checkpoint_barcode())
        db.add(checkpoint)
        await db.flush()

        # Инкрементное добавление номера позиции
        result = await db.execute(
            select(func.max(CheckpointPositions.position))
            .where(CheckpointPositions.route_id == data.route_id)
        )
        max_position = result.scalar_one_or_none()

        if max_position is None:
            max_position = 0

        position: int = max_position + 1

        db.add(
            CheckpointPositions(
                checkpoint_id=checkpoint.id,
                route_id=data.route_id,
                position=position,
            )
        )
        await db.commit()
        await db.refresh(checkpoint)
        return CheckpointResponse(
            id=checkpoint.id,
            barcode=checkpoint.barcode,
            route_id=checkpoint.route_id,
            name=checkpoint.name,
            address=checkpoint.address,
            coordinates=checkpoint.coordinates,
            position=position,
        )
    
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
        position = update_data.pop("position", None)
        for field, value in update_data.items():
            setattr(checkpoint, field, value)

        # Позиция КП хранится в связке с маршрутом.
        pos_result = await db.execute(
            select(CheckpointPositions).where(
                and_(
                    CheckpointPositions.checkpoint_id == checkpoint.id,
                    CheckpointPositions.route_id == checkpoint.route_id,
                )
            )
        )
        checkpoint_position = pos_result.scalar_one_or_none()
        if position is not None:
            if checkpoint_position is None:
                checkpoint_position = CheckpointPositions(
                    checkpoint_id=checkpoint.id,
                    route_id=checkpoint.route_id,
                    position=position,
                )
                db.add(checkpoint_position)
            else:
                checkpoint_position.position = position
        else:
            position = -1
        
        await db.commit()
        await db.refresh(checkpoint)
        if checkpoint_position is not None:
            await db.refresh(checkpoint_position)
        return CheckpointResponse(
            id=checkpoint.id,
            barcode=checkpoint.barcode,
            route_id=checkpoint.route_id,
            name=checkpoint.name,
            address=checkpoint.address,
            coordinates=checkpoint.coordinates,
            position=position,
        )
    
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
        passes_count = passes_count_result.scalar() or 0

        if passes_count > 0:
            raise HTTPException(
                status_code=403,
                detail="Нельзя удалить КП, по которому уже есть отметки участников"
            )

        # Снимаем назначения маркерам, чтобы не оставлять висячие записи.
        await db.execute(
            delete(MarkerAssignment).where(
                MarkerAssignment.checkpoint_id == checkpoint_id
            )
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
        positions = []

        # Инкрементное добавление номера позиции
        result = await db.execute(
            select(func.max(CheckpointPositions.position))
            .where(CheckpointPositions.route_id == data.route_id)
        )
        max_position = result.scalar_one_or_none()

        if max_position is None:
            max_position = 0
        position = max_position + 1
        
        for idx, cp_data in enumerate(data.checkpoints):
            try:
                # route_id берётся из data.route_id, position — в таблицу связей.
                cp_dict = cp_data.model_dump(exclude={'route_id', 'position'})
                checkpoint = Checkpoint(route_id=data.route_id, barcode=generate_checkpoint_barcode(), **cp_dict)
                valid_checkpoints.append(checkpoint)
                positions.append((checkpoint, position))
                position += 1
            except Exception as e:
                errors.append({"index": idx, "error": f"Ошибка валидации: {str(e)}"})

        if valid_checkpoints:
            db.add_all(valid_checkpoints)
            try:
                await db.flush()
                db.add_all(
                    CheckpointPositions(
                        checkpoint_id=checkpoint.id,
                        route_id=data.route_id,
                        position=position,
                    )
                    for checkpoint, position in positions
                )
                await db.commit()
                created_count = len(valid_checkpoints)
            except Exception as e:
                await db.rollback()
                errors.append({"index": -1, "error": f"Ошибка базы данных: {str(e)}"})
                created_count = 0
        
        return {"created_count": created_count, "errors": errors}