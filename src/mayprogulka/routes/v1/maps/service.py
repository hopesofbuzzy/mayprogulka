from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException

from database.models import Map, Participant, Route
from mayprogulka.models.maps import (
    MapCreateRequest,
    MapResponse,
    BatchMapCreateRequest,
    MapMatchRequest,
    MapMatchResponse,
    MapInfoResponse,
)


class MapService:
    
    @staticmethod
    async def create(
        db: AsyncSession,
        data: MapCreateRequest
    ) -> MapResponse:
        """Создать карту. participant_id опционален."""
        # Проверяем уникальность barcode
        existing_map = await db.execute(
            select(Map).where(Map.barcode == data.barcode)
        )
        if existing_map.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail=f"Карта с barcode '{data.barcode}' уже существует"
            )
        
        # Если participant_id указан, проверяем существование участника
        if data.participant_id is not None:
            result = await db.execute(
                select(Participant).where(Participant.id == data.participant_id)
            )
            if not result.scalar_one_or_none():
                raise HTTPException(status_code=404, detail="Участник не найден")
        
        # Создаем карту
        map_obj = Map(**data.model_dump())
        db.add(map_obj)
        await db.commit()
        await db.refresh(map_obj)
        
        return MapResponse.from_map(map_obj)
    
    @staticmethod
    async def create_batch(
        db: AsyncSession,
        data: BatchMapCreateRequest
    ) -> dict:
        """
        Массовое создание карт (только barcode, без привязки к участникам).
        Это типичный сценарий: напечатали 1000 стикеров, загрузили их в систему.
        """
        created_count = 0
        valid_maps = []
        
        for idx, barcode in enumerate(data.barcodes):
            try:
                # Проверяем уникальность
                existing_map = await db.execute(
                    select(Map).where(Map.barcode == barcode)
                )
                if existing_map.scalar_one_or_none():
                    raise HTTPException(status_code=400, detail=f"Карта с barcode '{barcode}' уже существует")
                    # errors.append({
                    #     "index": idx,
                    #     "barcode": barcode,
                    #     "error": f"Карта с barcode '{barcode}' уже существует"
                    # })
                    # continue
                
                # Создаем карту без привязки
                map_obj = Map(barcode=barcode, participant_id=None)
                valid_maps.append(map_obj)
                
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Ошибка анализа кода: {str(e)}")
        
        # Сохраняем все валидные карты одной транзакцией
        if valid_maps:
            db.add_all(valid_maps)
            try:
                await db.commit()
                created_count = len(valid_maps)
            except Exception as e:
                await db.rollback()
                raise HTTPException(status_code=500, detail=f"Ошибка базы данных: {str(e)}")
        
        return {"created_count": created_count}
    
    
    
    @staticmethod
    async def get_by_barcode(
        db: AsyncSession,
        barcode: str
    ) -> MapInfoResponse:
        """Получить информацию о карте. Работает даже если карта не привязана."""
        # Ищем карту
        result = await db.execute(
            select(Map).where(Map.barcode == barcode)
        )
        map_obj = result.scalar_one_or_none()
        
        if not map_obj:
            raise HTTPException(status_code=404, detail="Карта не найдена")
        
        # Если карта не привязана — возвращаем базовую информацию
        if map_obj.participant_id is None:
            return MapInfoResponse(
                id=map_obj.id,
                barcode=map_obj.barcode,
                participant_id=None,
                is_linked=False,
            )
        
        # Если привязана — загружаем данные участника и маршрута
        result = await db.execute(
            select(Participant, Route)
            .join(Route, Participant.route_id == Route.id)
            .where(Participant.id == map_obj.participant_id)
        )
        row = result.one_or_none()
        
        if not row:
            # На случай, если участник удален
            return MapInfoResponse(
                id=map_obj.id,
                barcode=map_obj.barcode,
                participant_id=map_obj.participant_id,
                is_linked=True,
            )
        
        participant, route = row
        
        return MapInfoResponse(
            id=map_obj.id,
            barcode=map_obj.barcode,
            participant_id=participant.id,
            is_linked=True,
            participant_name=participant.name,
            participant_surname=participant.surname,
            route_name=route.name,
            has_started=participant.has_started,
            has_finished=participant.has_finished,
            payment_status=participant.payment_status,
        )
    
