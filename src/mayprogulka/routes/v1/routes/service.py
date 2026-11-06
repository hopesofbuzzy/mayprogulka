from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException, UploadFile
import os
import uuid
from datetime import datetime
from typing import Optional

from database.models import Route


class RouteService:
    @staticmethod
    async def get_all_routes(db: AsyncSession) -> list[Route]:
        """Получить список всех маршрутов."""
        result = await db.execute(
            select(Route).order_by(Route.year.desc(), Route.name)
        )
        return list(result.scalars().all())

    @staticmethod
    async def get_route_by_id(db: AsyncSession, route_id: int) -> Route:
        """Получить маршрут по ID."""
        result = await db.execute(select(Route).where(Route.id == route_id))
        route = result.scalar_one_or_none()
        if not route:
            raise HTTPException(status_code=404, detail="Маршрут не найден")
        return route

    @staticmethod
    async def create_route(
        db: AsyncSession,
        year: int,
        name: str,
        distance: float,
        description: Optional[str] = None,
        is_active: bool = True,
    ) -> Route:
        """Создать новый маршрут."""
        route = Route(
            year=year,
            name=name,
            distance=distance,
            description=description,
            is_active=is_active,
        )
        db.add(route)
        await db.commit()
        await db.refresh(route)
        return route

    @staticmethod
    async def update_route(
        db: AsyncSession,
        route_id: int,
        update_data: dict,
    ) -> Route:
        """Обновить данные маршрута."""
        route = await RouteService.get_route_by_id(db, route_id)
        
        for field, value in update_data.items():
            if value is not None:
                setattr(route, field, value)
        
        await db.commit()
        await db.refresh(route)
        return route

    @staticmethod
    async def delete_route(db: AsyncSession, route_id: int) -> None:
        """Удалить или архивировать маршрут."""
        route = await RouteService.get_route_by_id(db, route_id)
        
        # Проверяем, есть ли участники на этом маршруте
        from sqlalchemy import func
        from database.models import Participant
        
        result = await db.execute(
            select(func.count(Participant.id)).where(Participant.route_id == route_id)
        )
        participants_count = result.scalar()
        
        if (type(participants_count) is int and participants_count > 0):
            # Архивируем вместо удаления
            route.is_active = False
            await db.commit()
        else:
            # Удаляем, если нет участников
            await db.delete(route)
            await db.commit()

    @staticmethod
    async def upload_map_file(
        db: AsyncSession,
        route_id: int,
        file: UploadFile,
    ) -> str:
        """Загрузить файл карты маршрута."""
        route = await RouteService.get_route_by_id(db, route_id)
        
        # Валидация типа файла
        allowed_types = ["image/jpeg", "image/png", "application/geo+json", "application/json"]
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"Недопустимый тип файла. Разрешены: JPG, PNG, GeoJSON"
            )

        if file.filename is None:
            raise HTTPException(
                status_code=400,
                detail=f"Отсутствует имя файла!"
            )
        
        # Создаем директорию для файлов, если её нет
        upload_dir = "static/maps"
        os.makedirs(upload_dir, exist_ok=True)
        
        # Генерируем уникальное имя файла
        file_ext = os.path.splitext(file.filename)[1]
        unique_filename = f"route_{route_id}_{uuid.uuid4().hex[:8]}{file_ext}"
        file_path = os.path.join(upload_dir, unique_filename)
        
        # Сохраняем файл
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        # Формируем URL (в продакшене это будет полный URL к файлу)
        map_url = f"/static/maps/{unique_filename}"
        
        # Обновляем маршрут
        route.map_url = map_url
        await db.commit()
        
        return map_url